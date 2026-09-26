import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate, setNavigationGuard } from '../router';
import type { AppDb } from '../storage/db';
import { getBill, getContract, listBills, listContracts, listCustomers, listServices, newId, putBill, putCustomer, templateFor } from '../storage/db';
import { allocateBillNumber } from '../storage/numbering';
import type { Bill, BillStatus, Contract, Customer, Service, Settings, VatRate } from '../domain/types';
import { VAT_RATES } from '../domain/types';
import { cleanDraft, draftFromBill, duplicateAsDraft, newDraft, setBillDate, setCustomer, type DraftBill } from '../domain/draft';
import { dateErrors, draftSaveErrors, exportBlockers, type Blocker } from '../domain/validate';
import { formatDateVn, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { qrToDataUrl, useQrDataUrl } from '../ui/useQrDataUrl';
import { bankByBin } from '../domain/banks';
import { driveConfigured, prepareDrive, saveBillToDrive, saveDocxToDrive } from '../drive/service';
import type { BankAccount } from '../domain/types';
import { printBill } from '../ui/print';
import { CustomerForm, emptyCustomer } from './Customers';
import { LinesEditor } from '../ui/LinesEditor';
import { businessSnapshot } from '../domain/settings';
import { applicableTerms, contractItems } from '../domain/contractTerms';
import { contractRefFor, fillFromContract } from '../domain/contractFill';
import { useWrite } from '../ui/useOnline';
import { isHandled } from '../storage/errors';

export type EditorMode =
  | { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string }
  | { kind: 'fromContract'; contractId: string; itemKey: string | null };

/**
 * Links a draft to a contract/addendum (and optionally one plan item) and fills it in from the contract.
 * With no item, the terms that apply on the bill date are used ("Other").
 */
export function applyContract(d: DraftBill, contracts: Contract[], bills: Bill[], recordId: string, itemKey: string | null): DraftBill {
  const record = contracts.find((c) => c.id === recordId);
  if (!record) return d;
  const parent = record.parentId ? contracts.find((c) => c.id === record.parentId) ?? null : null;
  const top = parent ?? record;
  const addenda = contracts.filter((c) => c.parentId === top.id);
  const item = itemKey ? contractItems(top, addenda, bills, d.billDate).find((r) => r.sourceId === record.id && r.key === itemKey) ?? null : null;
  const terms = item || record.kind === 'addendum' ? record : applicableTerms(top, addenda, d.billDate);
  return fillFromContract(d, terms, { record, parent, item });
}
type Step = 1 | 2 | 3;


export async function saveDraftBill(db: AppDb, d: DraftBill, settings: Settings, status: BillStatus): Promise<Bill> {
  const invalid = draftSaveErrors(d);
  if (invalid.length) throw new Error(invalid.join('; '));
  if (d.contractRef) {
    const ref = d.contractRef;
    if (ref.itemKey && (await listBills(db)).some((b) => b.id !== d.id && b.status !== 'cancelled'
      && b.contractRef?.contractId === ref.contractId && b.contractRef.itemKey === ref.itemKey)) {
      throw new Error('This contract item is already billed');
    }
    // Refresh the copied contract number and dates as they are now.
    const record = await getContract(db, ref.contractId);
    if (record) {
      const parent = record.parentId ? (await getContract(db, record.parentId)) ?? null : null;
      d = { ...d, contractRef: contractRefFor(record, parent, ref.itemKey) };
    }
  }
  const now = new Date().toISOString();
  const existing = d.id ? await getBill(db, d.id) : undefined;
  // A draft moved to another year gets a number from that year (the old number is not reused).
  const keepNumber = d.number && d.number.split('-').at(-2) === d.billDate.slice(0, 4);
  const { business: _draftCopy, ...clean } = cleanDraft(d);
  const bill: Bill = {
    ...clean,
    id: d.id ?? newId(),
    number: keepNumber ? d.number! : await allocateBillNumber(db, settings.numberPrefix, d.billDate),
    status,
    // Sent bills keep the business details they were sent with.
    ...(status === 'sent' && { business: businessSnapshot(settings) }),
    paidDate: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(d.version !== undefined && { version: d.version }),
  };
  // The saved record (on a server: with its new version).
  return putBill(db, bill);
}

export function Editor({ mode }: { mode: EditorMode }) {
  const { db, settings: shared, user } = useApp();
  // On a server, "Prepared by" on new bills is the signed-in person (saved on the bill when it is sent).
  const settings = useMemo(() => (user ? { ...shared, preparedBy: user.displayName } : shared), [shared, user]);
  const w = useWrite();
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [saved, setSaved] = useState('');
  const [step, setStep] = useState<Step>(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [allBills, setAllBills] = useState<Bill[]>([]);
  const [error, setError] = useState('');
  const [exportQr, setExportQr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { prepareDrive(db, settings); }, [settings.googleClientId]);
  const savingRef = useRef(false);

  useEffect(() => {
    (async () => {
      setCustomers((await listCustomers(db)).filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
      setServices((await listServices(db)).filter((s) => !s.archived).sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')));
      let d: DraftBill;
      const cs = await listContracts(db);
      const bs = await listBills(db);
      setContracts(cs);
      setAllBills(bs);
      if (mode.kind === 'new') d = newDraft(settings, todayIso());
      else if (mode.kind === 'fromContract') {
        d = applyContract(newDraft(settings, todayIso()), cs, bs, mode.contractId, mode.itemKey);
        setStep(2);
      }
      else {
        const b = await getBill(db, mode.id);
        if (!b) return navigate({ name: 'home' });
        if (mode.kind === 'edit' && b.status !== 'draft') return navigate({ name: 'bill', id: b.id });
        d = mode.kind === 'edit' ? draftFromBill(b) : duplicateAsDraft(b, settings, todayIso());
        if (mode.kind === 'duplicate') setStep(2);
      }
      setDraft(d);
      // A duplicate counts as unsaved from the start; a new or edited bill only after a change.
      setSaved(mode.kind === 'duplicate' ? '' : JSON.stringify(d));
    })();
  }, []);

  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  useEffect(() => {
    if (!dirty) {
      setNavigationGuard(null);
      return;
    }
    setNavigationGuard(() => confirm('You have unsaved changes. Leave without saving?'));
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); setNavigationGuard(null); };
  }, [dirty]);

  const blockers = useMemo(() => (draft ? exportBlockers(draft, settings) : []), [draft, settings]);
  const qr = useQrDataUrl(draft ? billQrPayload(draft, settings) : null);

  if (!draft) return <p class="muted">Loading…</p>;

  const save = async (status: BillStatus) => {
    // Ignore a second click while a save is running, so one bill never gets two numbers.
    if (savingRef.current) return null;
    setError('');
    const invalid = draftSaveErrors(draft);
    if (invalid.length) {
      setError(invalid.join(' · '));
      setStep(2);
      return null;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const bill = await saveDraftBill(db, draft, settings, status);
      setNavigationGuard(null);
      setSaved(JSON.stringify(draftFromBill(bill)));
      setDraft(draftFromBill(bill));
      return bill;
    } catch (e) {
      if (isHandled(e)) return null;
      setError(`Could not save: ${String(e)}. Make a backup and check that the browser is not in private mode.`);
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveDraftOnly = async () => {
    if (await save('draft')) navigate({ name: 'home' });
  };

  const saveAndExport = async () => {
    const bill = await save('sent');
    if (!bill) return;
    // Start the Drive upload right away (still inside the click, so Google's permission window may open);
    // it runs in the background and never blocks or undoes the export.
    if (driveConfigured(settings) && settings.driveAutoUpload) {
      saveBillToDrive(db, bill.id, settings).catch(() => undefined);
      // The Word document follows in the same queue; without a bill template it is skipped silently.
      templateFor(db, 'bill').then((t) => t && saveDocxToDrive(db, { type: 'bill', id: bill.id }, settings)).catch(() => undefined);
    }
    // Build the QR now so the printed page never misses it, then let the preview re-render.
    const payload = billQrPayload(draftFromBill(bill), settings);
    try {
      setExportQr(payload ? await qrToDataUrl(payload) : null);
    } catch {
      setError('The bill was saved as Sent, but the QR code could not be created. Open the bill and use Export PDF to try again.');
      return;
    }
    requestAnimationFrame(() => setTimeout(() => {
      printBill(pdfFileName(bill.number, bill.customer.name));
      navigate({ name: 'bill', id: bill.id });
    }, 0));
  };

  const goTo = (b: Blocker) => (b.target === 'settings' ? navigate({ name: 'settings' }) : setStep(b.target === 'customer' ? 1 : 2));
  const title = mode.kind === 'edit' ? `Edit draft ${draft.number ?? ''}` : 'New bill';

  return (
    <div>
      <div class="page-head no-print"><h2>{title}</h2></div>
      <Steps step={step} onStep={setStep} />
      {error && <p class="errors no-print">{error}</p>}
      {step === 1 && <BillOptions draft={draft} settings={settings} contracts={contracts} bills={allBills} onChange={setDraft} />}
      {step === 1 && (
        <CustomerStep
          draft={draft}
          customers={customers}
          onPick={(c) => { setDraft(setCustomer(draft, c)); setStep(2); }}
          onCreate={async (c) => {
            await putCustomer(db, c);
            setCustomers([...customers, c].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
            setDraft(setCustomer(draft, c));
            setStep(2);
          }}
        />
      )}
      {step === 2 && <ServicesStep draft={draft} services={services} onChange={setDraft} />}
      {step === 3 && (
        <div>
          {blockers.length > 0 && (
            <div class="errors no-print">
              <b>Before exporting:</b>
              <ul>{blockers.map((b, i) => <li key={i}><button onClick={() => goTo(b)}>{b.message}</button></li>)}</ul>
            </div>
          )}
          <div class="preview-wrap"><BillPage bill={draft} settings={settings} qrDataUrl={exportQr ?? qr} /></div>
          {!draft.number && <p class="muted no-print">The bill number and QR code appear after saving.</p>}
        </div>
      )}
      <div class="page-head no-print" style="margin-top:16px">
        <button class="btn ghost" disabled={step === 1} onClick={() => setStep((step - 1) as Step)}>← Back</button>
        <span>
          <button class="btn ghost" {...w(saving)} onClick={saveDraftOnly}>Save draft</button>{' '}
          {step < 3
            ? <button class="btn" onClick={() => setStep((step + 1) as Step)}>Next →</button>
            : <button class="btn" {...w(saving || blockers.length > 0)} onClick={saveAndExport}>Save &amp; export PDF</button>}
        </span>
      </div>
    </div>
  );
}

function Steps({ step, onStep }: { step: Step; onStep(s: Step): void }) {
  const labels = ['1 · Customer', '2 · Services', '3 · Review & export'];
  return (
    <div class="no-print" style="display:flex;gap:6px;margin-bottom:16px">
      {labels.map((l, i) => (
        <button key={l} class={step === i + 1 ? 'btn' : 'btn ghost'} style="flex:1" onClick={() => onStep((i + 1) as Step)}>{l}</button>
      ))}
    </div>
  );
}

function CustomerStep({ draft, customers, onPick, onCreate }: {
  draft: DraftBill; customers: Customer[]; onPick(c: Customer): void; onCreate(c: Customer): void;
}) {
  const w = useWrite();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const shown = customers.filter((c) => `${c.name} ${c.taxId}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div class="panel">
      <div class="page-head">
        <input class="field" placeholder="Search customers…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px" />
        <button class="btn ghost" {...w()} onClick={() => setAdding(true)}>+ New customer</button>
      </div>
      {adding && <CustomerForm value={emptyCustomer()} onSave={(c) => { setAdding(false); onCreate(c); }} onCancel={() => setAdding(false)} />}
      <table class="list">
        <tbody>
          {shown.map((c) => (
            <tr key={c.id} class="click" onClick={() => onPick(c)}>
              <td>{draft.customerId === c.id ? '● ' : ''}<b>{c.name}</b></td>
              <td class="muted">{c.taxId}</td>
              <td class="muted">{c.address}</td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td class="muted">No matching customers. Add one with “+ New customer”.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ServicesStep({ draft, services, onChange }: {
  draft: DraftBill; services: Service[]; onChange(d: DraftBill): void;
}) {
  return (
    <div class="panel">
      <p class="muted">Customer: <b>{draft.customer.name || '— not chosen —'}</b></p>
      <LinesEditor lines={draft.lines} vatRate={draft.vatRate} services={services} onChange={(lines) => onChange({ ...draft, lines })} />
      <div class="grid2">
        <label class="field">Bill date
          <input type="date" value={draft.billDate} onInput={(e) => e.currentTarget.value && onChange(setBillDate(draft, e.currentTarget.value))} />
        </label>
        <label class="field">Due date
          <input type="date" value={draft.dueDate} onInput={(e) => e.currentTarget.value && onChange({ ...draft, dueDate: e.currentTarget.value })} />
          {dateErrors(draft.billDate, draft.dueDate).map((er) => <span key={er} style="color:var(--danger)">{er}</span>)}
        </label>
      </div>
    </div>
  );
}

/** Step 1: per-bill VAT and footer note, starting from the Settings defaults. */
function BillOptions({ draft, settings, contracts, bills, onChange }: {
  draft: DraftBill; settings: Settings; contracts: Contract[]; bills: Bill[]; onChange(d: DraftBill): void;
}) {
  const note = draft.footerNote ?? '';
  const picked = note.trim() === '' ? 'none' : String(settings.footerNotes.indexOf(note));
  const same = (a: BankAccount, b: BankAccount) => a.bankBin === b.bankBin && a.accountNumber === b.accountNumber && a.accountHolder === b.accountHolder;
  const accPicked = draft.bankAccount
    ? (settings.bankAccounts.find((a) => same(a, draft.bankAccount!))?.id ?? 'kept')
    : (settings.bankAccounts.find((a) => a.id === settings.defaultBankAccountId)?.id ?? '');
  return (
    <div class="panel">
      <h3 style="margin-top:0">Bill options</h3>
      <div class="grid2">
        <ContractPicker draft={draft} contracts={contracts} bills={bills} onChange={onChange} />
        <label class="field">VAT
          <select value={String(draft.vatRate)} onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ ...draft, vatRate: (v === 'none' ? 'none' : Number(v)) as VatRate });
          }}>
            {VAT_RATES.map((r) => <option key={String(r)} value={String(r)}>{r === 'none' ? 'Not applicable' : `${r}%`}</option>)}
          </select>
        </label>
        <label class="field">Bank account
          <select value={accPicked} onChange={(e) => {
            const a = settings.bankAccounts.find((x) => x.id === e.currentTarget.value);
            if (a) onChange({ ...draft, bankAccount: { bankBin: a.bankBin, accountNumber: a.accountNumber, accountHolder: a.accountHolder } });
          }}>
            {settings.bankAccounts.length === 0 && <option value="">No account yet (add one in Settings)</option>}
            {accPicked === 'kept' && draft.bankAccount && <option value="kept">{accountLabel(draft.bankAccount)} (saved on this bill)</option>}
            {settings.bankAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
          </select>
        </label>
        <label class="field">Footer note
          <select value={picked} onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === 'custom') return;
            onChange({ ...draft, footerNote: v === 'none' ? '' : settings.footerNotes[Number(v)] });
          }}>
            <option value="none">None</option>
            {settings.footerNotes.map((n, i) => <option key={i} value={String(i)}>{n.length > 60 ? `${n.slice(0, 60)}…` : n}</option>)}
            {picked === '-1' && <option value="-1">Custom (edited below)</option>}
          </select>
        </label>
      </div>
      <label class="field" style="margin-top:8px">Footer text on this bill (leave empty for none)
        <textarea rows={2} value={note} onInput={(e) => onChange({ ...draft, footerNote: e.currentTarget.value })} />
      </label>
    </div>
  );
}

function accountLabel(a: BankAccount): string {
  const bank = bankByBin(a.bankBin)?.shortName ?? 'Bank?';
  return `${bank} – ${a.accountNumber}${a.accountHolder ? ` (${a.accountHolder})` : ''}`;
}

/** Bill options → Contract and Contract item: links the bill to a contract (or addendum) and fills it in. */
function ContractPicker({ draft, contracts, bills, onChange }: {
  draft: DraftBill; contracts: Contract[]; bills: Bill[]; onChange(d: DraftBill): void;
}) {
  const active = contracts.filter((c) => c.status === 'active' && (!draft.customerId || c.customerId === draft.customerId));
  if (active.length === 0 && !draft.contractRef) return null;
  const ref = draft.contractRef;
  const record = ref ? contracts.find((c) => c.id === ref.contractId) : undefined;
  const top = record?.parentId ? contracts.find((c) => c.id === record.parentId) : record;
  const rows = record && top
    ? contractItems(top, contracts.filter((c) => c.parentId === top.id), bills.filter((b) => b.id !== draft.id), draft.billDate)
      .filter((r) => r.sourceId === record.id && (r.state === 'due' || r.state === 'notDue' || r.state === 'waiting' || r.key === ref?.itemKey))
    : [];
  const label = (c: Contract) => (c.kind === 'addendum'
    ? `${contracts.find((p) => p.id === c.parentId)?.number ?? ''} · ${c.number}`
    : `${c.number} · ${c.customer.name}`);
  return (
    <>
      <label class="field">Contract
        <select value={ref?.contractId ?? ''} onChange={(e) => {
          const id = e.currentTarget.value;
          if (!id) {
            const { contractRef: _removed, ...rest } = draft;
            onChange(rest);
          } else onChange(applyContract(draft, contracts, bills, id, null));
        }}>
          <option value="">— None —</option>
          {record && !active.includes(record) && <option value={record.id}>{label(record)}</option>}
          {active.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
        </select>
      </label>
      {ref && (
        <label class="field">Contract item
          <select value={ref.itemKey ?? ''} onChange={(e) => onChange(applyContract(draft, contracts, bills, ref.contractId, e.currentTarget.value || null))}>
            {rows.map((r) => (
              <option key={r.key} value={r.key} disabled={r.state === 'waiting'}>
                {r.label.vi}{r.state === 'waiting' ? ' (not ready)' : r.state === 'notDue' && r.dueDate ? ` (from ${formatDateVn(r.dueDate)})` : ''}
              </option>
            ))}
            <option value="">Other (no specific item)</option>
          </select>
        </label>
      )}
    </>
  );
}
