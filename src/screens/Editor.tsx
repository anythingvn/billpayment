import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate, setNavigationGuard } from '../router';
import type { AppDb } from '../storage/db';
import { getBill, listCustomers, listServices, newId, putBill, putCustomer } from '../storage/db';
import { allocateBillNumber } from '../storage/numbering';
import type { Bill, BillStatus, Customer, Service, Settings, VatRate } from '../domain/types';
import { VAT_RATES } from '../domain/types';
import {
  addCustomLine, addServiceLine, draftFromBill, duplicateAsDraft, newDraft, removeLine, setBillDate, setCustomer, updateLine,
  type DraftBill,
} from '../domain/draft';
import { dateErrors, exportBlockers, lineErrors, type Blocker } from '../domain/validate';
import { computeTotals } from '../domain/money';
import { formatVnd, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { qrToDataUrl, useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { CustomerForm, emptyCustomer } from './Customers';

export type EditorMode = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string };
type Step = 1 | 2 | 3;

export async function saveDraftBill(db: AppDb, d: DraftBill, settings: Settings, status: BillStatus): Promise<Bill> {
  const now = new Date().toISOString();
  const existing = d.id ? await getBill(db, d.id) : undefined;
  const bill: Bill = {
    ...d,
    id: d.id ?? newId(),
    number: d.number ?? (await allocateBillNumber(db, settings.numberPrefix, d.billDate)),
    status,
    paidDate: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await putBill(db, bill);
  return bill;
}

export function Editor({ mode }: { mode: EditorMode }) {
  const { db, settings } = useApp();
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [saved, setSaved] = useState('');
  const [step, setStep] = useState<Step>(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState('');
  const [exportQr, setExportQr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCustomers((await listCustomers(db)).filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
      setServices((await listServices(db)).filter((s) => !s.archived).sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')));
      let d: DraftBill;
      if (mode.kind === 'new') d = newDraft(settings, todayIso());
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
    setError('');
    try {
      const bill = await saveDraftBill(db, draft, settings, status);
      setNavigationGuard(null);
      setSaved(JSON.stringify(draftFromBill(bill)));
      setDraft(draftFromBill(bill));
      return bill;
    } catch (e) {
      setError(`Could not save: ${String(e)}. Make a backup and check that the browser is not in private mode.`);
      return null;
    }
  };

  const saveDraftOnly = async () => {
    if (await save('draft')) navigate({ name: 'home' });
  };

  const saveAndExport = async () => {
    const bill = await save('sent');
    if (!bill) return;
    // Build the QR now so the printed page never misses it, then let the preview re-render.
    const payload = billQrPayload(draftFromBill(bill), settings);
    setExportQr(payload ? await qrToDataUrl(payload) : null);
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
      {step === 2 && <ServicesStep draft={draft} services={services} settings={settings} onChange={setDraft} />}
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
          <button class="btn ghost" onClick={saveDraftOnly}>Save draft</button>{' '}
          {step < 3
            ? <button class="btn" onClick={() => setStep((step + 1) as Step)}>Next →</button>
            : <button class="btn" disabled={blockers.length > 0} onClick={saveAndExport}>Save &amp; export PDF</button>}
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
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const shown = customers.filter((c) => `${c.name} ${c.taxId}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div class="panel">
      <div class="page-head">
        <input class="field" placeholder="Search customers…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px" />
        <button class="btn ghost" onClick={() => setAdding(true)}>+ New customer</button>
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

function ServicesStep({ draft, services, settings, onChange }: {
  draft: DraftBill; services: Service[]; settings: Settings; onChange(d: DraftBill): void;
}) {
  const t = computeTotals(draft.lines, draft.vatRate);
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  return (
    <div class="panel">
      <p class="muted">Customer: <b>{draft.customer.name || '— not chosen —'}</b></p>
      <table class="list">
        <thead><tr><th>Service (VI / EN)</th><th>Unit (VI / EN)</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th><th /></tr></thead>
        <tbody>
          {draft.lines.map((l, i) => {
            const errs = lineErrors(l);
            return (
              <tr key={i}>
                <td>
                  <input value={l.nameVi} placeholder="Tên dịch vụ" onInput={(e) => onChange(updateLine(draft, i, { nameVi: e.currentTarget.value }))} />
                  <input value={l.nameEn} placeholder="Service name" onInput={(e) => onChange(updateLine(draft, i, { nameEn: e.currentTarget.value }))} />
                  {errs.map((er) => <div key={er} style="color:var(--danger);font-size:12px">{er}</div>)}
                </td>
                <td>
                  <input size={8} value={l.unitVi} placeholder="tháng" onInput={(e) => onChange(updateLine(draft, i, { unitVi: e.currentTarget.value }))} />
                  <input size={8} value={l.unitEn} placeholder="month" onInput={(e) => onChange(updateLine(draft, i, { unitEn: e.currentTarget.value }))} />
                </td>
                <td class="r"><input type="number" min={1} step={1} style="width:70px" value={l.qty} onInput={(e) => onChange(updateLine(draft, i, { qty: num(e.currentTarget.value) }))} /></td>
                <td class="r"><input type="number" min={0} step={1000} style="width:130px" value={l.unitPrice} onInput={(e) => onChange(updateLine(draft, i, { unitPrice: num(e.currentTarget.value) }))} /></td>
                <td class="r">{errs.length ? '—' : formatVnd(t.lineAmounts[i])}</td>
                <td><button class="btn ghost" title="Remove line" onClick={() => onChange(removeLine(draft, i))}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style="display:flex;gap:8px;flex-wrap:wrap">
        <select value="" onChange={(e) => {
          const s = services.find((x) => x.id === e.currentTarget.value);
          if (s) onChange(addServiceLine(draft, s));
          e.currentTarget.value = '';
        }}>
          <option value="">+ From saved services…</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.nameVi} — {formatVnd(s.unitPrice)}</option>)}
        </select>
        <button class="btn ghost" onClick={() => onChange(addCustomLine(draft))}>+ Custom line</button>
      </p>
      <div class="grid2">
        <label class="field">Bill date
          <input type="date" value={draft.billDate} onInput={(e) => e.currentTarget.value && onChange(setBillDate(draft, e.currentTarget.value, settings.defaultPaymentDays))} />
        </label>
        <label class="field">Due date
          <input type="date" value={draft.dueDate} onInput={(e) => e.currentTarget.value && onChange({ ...draft, dueDate: e.currentTarget.value })} />
          {dateErrors(draft.billDate, draft.dueDate).map((er) => <span key={er} style="color:var(--danger)">{er}</span>)}
        </label>
        <label class="field">VAT
          <select value={String(draft.vatRate)} onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ ...draft, vatRate: (v === 'none' ? 'none' : Number(v)) as VatRate });
          }}>
            {VAT_RATES.map((r) => <option key={String(r)} value={String(r)}>{r === 'none' ? 'Not applicable' : `${r}%`}</option>)}
          </select>
        </label>
      </div>
      <p class="r">
        Subtotal <b>{formatVnd(t.subtotal)}</b>
        {t.vatApplies && <> · VAT {draft.vatRate}% <b>{formatVnd(t.vat)}</b></>}
        {' '}· Total <b style="font-size:18px">{formatVnd(t.total)} ₫</b>
      </p>
    </div>
  );
}
