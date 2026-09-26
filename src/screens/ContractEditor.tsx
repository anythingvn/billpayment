import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { getContract, listContracts, listCustomers, listServices, listTemplates, newId, putContract } from '../storage/db';
import { driveConfigured, prepareDrive, saveDocxToDrive } from '../drive/service';
import { allocateContractNumber, peekContractNumber } from '../storage/contractNumbering';
import type { Contract, Customer, DocTemplate, Instalment, Plan, Service, VatRate } from '../domain/types';
import { VAT_RATES } from '../domain/types';
import { contractSaveErrors, contractValue, isDuplicateNumber, nextAddendumNumber, planErrors } from '../domain/contractPlan';
import { lineErrors } from '../domain/validate';
import { businessSnapshot } from '../domain/settings';
import { formatVnd, todayIso } from '../domain/format';
import { LinesEditor } from '../ui/LinesEditor';

export type ContractEditorMode = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'addendum'; parentId: string };

const EMPTY_CUSTOMER = { name: '', address: '', taxId: '', contactPerson: '', email: '', phone: '' };

function blankContract(s: { defaultVatRate: VatRate; defaultPaymentDays: number }, today: string): Contract {
  return {
    id: newId(), kind: 'contract', parentId: null, effect: null, effectiveDate: null, number: '', title: '', status: 'draft',
    signedDate: today, startDate: today, endDate: null, customerId: '', customer: { ...EMPTY_CUSTOMER }, business: null,
    lines: [], vatRate: s.defaultVatRate, plan: { type: 'perUse' }, paymentTerms: '', paymentDays: s.defaultPaymentDays, templateId: null,
    createdAt: '', updatedAt: '',
  };
}

const monthOf = (date: string) => date.slice(0, 7);

function defaultPlan(type: Plan['type'], c: Contract): Plan {
  if (type === 'instalments') return { type, items: [] };
  if (type === 'periodic') {
    return { type, every: 'month', amount: 0, first: monthOf(c.startDate), last: monthOf(c.endDate ?? c.startDate) };
  }
  return { type: 'perUse' };
}

export function ContractEditor({ mode }: { mode: ContractEditorMode }) {
  const { db, settings } = useApp();
  const [c, setC] = useState<Contract | null>(null);
  const [saved, setSaved] = useState<Contract | null>(null);
  const [parent, setParent] = useState<Contract | null>(null);
  const [all, setAll] = useState<Contract[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [suggested, setSuggested] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [hasAddendumTemplate, setHasAddendumTemplate] = useState(false);

  // Load Google's sign-in script early so the upload after Save & activate can open its window from the click.
  useEffect(() => { prepareDrive(db, settings); }, [settings.googleClientId]);
  useEffect(() => {
    (async () => {
      const contracts = await listContracts(db);
      setAll(contracts);
      setCustomers((await listCustomers(db)).filter((x) => !x.archived).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
      setServices((await listServices(db)).filter((x) => !x.archived));
      const docTemplates = await listTemplates(db);
      setTemplates(docTemplates.filter((t) => t.kind === 'contract').sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)));
      setHasAddendumTemplate(docTemplates.some((t) => t.kind === 'addendum'));
      if (mode.kind === 'edit') {
        const existing = await getContract(db, mode.id);
        if (!existing) return navigate({ name: 'contracts' });
        if (existing.parentId) setParent((await getContract(db, existing.parentId)) ?? null);
        setC(existing);
        setSaved(existing);
        return;
      }
      const draft = blankContract(settings, todayIso());
      if (mode.kind === 'addendum') {
        const p = await getContract(db, mode.parentId);
        if (!p) return navigate({ name: 'contracts' });
        setParent(p);
        const siblings = contracts.filter((x) => x.parentId === p.id);
        setC({
          ...draft, kind: 'addendum', parentId: p.id, effect: 'addsWork', number: nextAddendumNumber(siblings),
          customerId: p.customerId, customer: { ...p.customer }, vatRate: p.vatRate, paymentDays: p.paymentDays, endDate: p.endDate,
        });
        return;
      }
      const number = await peekContractNumber(db, settings, draft.signedDate);
      setSuggested(number);
      setC({ ...draft, number });
    })();
  }, []);

  if (!c) return <p class="muted">Loading…</p>;
  const isAddendum = c.kind === 'addendum';
  const set = <K extends keyof Contract>(k: K, v: Contract[K]) => setC({ ...c, [k]: v });
  const duplicate = c.number.trim() !== '' && isDuplicateNumber(
    all.filter((x) => (isAddendum ? x.parentId === c.parentId : x.kind === 'contract')), c.number, c.id,
  );

  const pickCustomer = (id: string) => {
    const cust = customers.find((x) => x.id === id);
    if (!cust) return setC({ ...c, customerId: '', customer: { ...EMPTY_CUSTOMER } });
    const { name, address, taxId, contactPerson, email, phone } = cust;
    setC({ ...c, customerId: id, customer: { name, address, taxId, contactPerson, email, phone } });
  };

  const save = async (activate: boolean) => {
    const problems: string[] = [];
    if (!c.customerId) problems.push('Choose a customer');
    if (!c.number.trim()) problems.push('Enter a number');
    problems.push(...contractSaveErrors(c));
    const status = activate ? 'active' : c.status;
    if (status === 'active') {
      if (!c.title.trim()) problems.push('Enter a title');
      if (c.lines.length === 0) problems.push('Add at least one service line');
      c.lines.forEach((l, i) => {
        if (!l.nameVi.trim()) problems.push(`Line ${i + 1}: ${lineErrors(l)[0] ?? 'Service name is required'}`);
      });
      problems.push(...planErrors(c, parent));
    }
    setErrors(problems);
    if (problems.length) return;
    if (saved && saved.status !== 'draft' && JSON.stringify(saved.plan) !== JSON.stringify(c.plan)
      && !confirm('This contract is active. Consider an addendum instead. Change the plan anyway?')) return;

    const now = new Date().toISOString();
    let number = c.number.trim();
    // A new contract keeping the suggested number takes it from the counter (so it isn't handed out twice).
    if (mode.kind === 'new' && !saved && number === suggested) number = await allocateContractNumber(db, settings, c.signedDate);
    const customer = customers.find((x) => x.id === c.customerId);
    const next: Contract = {
      ...c,
      number,
      status,
      business: status === 'active' && !c.business ? businessSnapshot(settings) : c.business,
      customer: customer && (activate || c.status === 'draft')
        ? { name: customer.name, address: customer.address, taxId: customer.taxId, contactPerson: customer.contactPerson, email: customer.email, phone: customer.phone }
        : c.customer,
      // A Drive upload may have finished while the editor was open: keep its status (file id), not the copy loaded here.
      drive: (await getContract(db, c.id))?.drive ?? c.drive,
      createdAt: c.createdAt || now,
      updatedAt: now,
    };
    await putContract(db, next);
    setSaved(next);
    // Save & activate also saves the contract's or addendum's Word document to Drive (skipped silently without a template).
    if (activate && settings.driveAutoUpload && driveConfigured(settings)
      && (next.kind === 'addendum' ? hasAddendumTemplate : templates.length > 0)) {
      saveDocxToDrive(db, { type: 'contract', id: next.id }, settings).catch(() => undefined);
    }
    navigate({ name: 'contract', id: next.parentId ?? next.id });
  };

  const setPlan = (plan: Plan) => set('plan', plan);
  const setInstalment = (i: number, patch: Partial<Instalment>) => {
    if (c.plan.type !== 'instalments') return;
    setPlan({ ...c.plan, items: c.plan.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  };

  return (
    <div>
      <div class="page-head"><h2>{isAddendum ? 'Addendum' : mode.kind === 'edit' ? 'Edit contract' : 'New contract'}</h2></div>
      {errors.length > 0 && <div class="errors"><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}

      <div class="panel"><h3 style="margin-top:0">Basics</h3>
        {isAddendum && parent && <p class="muted">Phụ lục / Addendum of contract {parent.number} · {parent.customer.name}</p>}
        <div class="grid2">
          <label class="field">{isAddendum ? 'Addendum number' : 'Contract number'}
            <input value={c.number} onInput={(e) => set('number', e.currentTarget.value)} />
            {duplicate && <span style="color:var(--warning, #b45309)">Another contract already uses this number</span>}
          </label>
          {isAddendum
            ? <label class="field">Effect
                <select value={c.effect ?? 'addsWork'} onChange={(e) => set('effect', e.currentTarget.value as Contract['effect'])}>
                  <option value="addsWork">Adds work (billed separately)</option>
                  <option value="changesTerms">Changes the contract's terms from a date</option>
                </select>
              </label>
            : <label class="field">Customer
                <select value={c.customerId} onChange={(e) => pickCustomer(e.currentTarget.value)}>
                  <option value="">— Choose —</option>
                  {customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>}
          <label class="field">Title<input value={c.title} placeholder="Hợp đồng thiết kế website" onInput={(e) => set('title', e.currentTarget.value)} /></label>
          {!isAddendum && templates.length > 0 && (() => {
            const def = templates.find((t) => t.isDefault) ?? templates[0];
            return (
              <label class="field">Document template
                <select value={templates.some((t) => t.id === c.templateId) ? c.templateId! : ''} onChange={(e) => set('templateId', e.currentTarget.value || null)}>
                  <option value="">Default ({def.name})</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            );
          })()}
          <label class="field">Signing date<input type="date" value={c.signedDate} onInput={(e) => e.currentTarget.value && set('signedDate', e.currentTarget.value)} /></label>
          <label class="field">Start date<input type="date" value={c.startDate} onInput={(e) => e.currentTarget.value && set('startDate', e.currentTarget.value)} /></label>
          <label class="field">End date (optional)<input type="date" value={c.endDate ?? ''} onInput={(e) => set('endDate', e.currentTarget.value || null)} /></label>
          {isAddendum && c.effect === 'changesTerms' && (
            <label class="field">Effective date<input type="date" value={c.effectiveDate ?? ''} onInput={(e) => set('effectiveDate', e.currentTarget.value || null)} /></label>
          )}
        </div>
      </div>

      <div class="panel"><h3 style="margin-top:0">Services</h3>
        <LinesEditor lines={c.lines} vatRate={c.vatRate} services={services} onChange={(lines) => set('lines', lines)} />
        <div class="grid2">
          <label class="field">VAT
            <select value={String(c.vatRate)} onChange={(e) => {
              const v = e.currentTarget.value;
              set('vatRate', (v === 'none' ? 'none' : Number(v)) as VatRate);
            }}>
              {VAT_RATES.map((r) => <option key={String(r)} value={String(r)}>{r === 'none' ? 'Not applicable' : `${r}%`}</option>)}
            </select>
          </label>
          <div class="field">Value (incl. VAT)<div style="font-size:18px;font-weight:700">{formatVnd(contractValue(c))} ₫</div></div>
        </div>
      </div>

      <div class="panel"><h3 style="margin-top:0">Billing</h3>
        <label class="field">Billing method
          <select value={c.plan.type} onChange={(e) => setPlan(defaultPlan(e.currentTarget.value as Plan['type'], c))}>
            <option value="instalments">Instalments (đợt thanh toán)</option>
            <option value="periodic">Fixed amount per period</option>
            <option value="perUse">Pay per use</option>
          </select>
        </label>
        {c.plan.type === 'instalments' && (
          <div style="margin-top:10px">
            {c.plan.items.map((it, i) => (
              <div key={it.id} class="grid2" style="align-items:end;border-top:1px solid var(--border);padding-top:8px;margin-bottom:8px">
                <label class="field">Instalment name<input value={it.name} placeholder="Đợt 1 – Tạm ứng" onInput={(e) => setInstalment(i, { name: e.currentTarget.value })} /></label>
                <div style="display:flex;gap:6px;align-items:end">
                  <label class="field" style="flex:1">Share
                    <input type="number" min={0} value={'percent' in it.share ? it.share.percent : it.share.amount}
                      onInput={(e) => {
                        const v = Number(e.currentTarget.value);
                        setInstalment(i, { share: 'percent' in it.share ? { percent: v } : { amount: v } });
                      }} />
                  </label>
                  <select aria-label="Share type" value={'percent' in it.share ? 'percent' : 'amount'} onChange={(e) => {
                    const v = 'percent' in it.share ? it.share.percent : it.share.amount;
                    setInstalment(i, { share: e.currentTarget.value === 'percent' ? { percent: v } : { amount: v } });
                  }}>
                    <option value="percent">%</option>
                    <option value="amount">₫ (before VAT)</option>
                  </select>
                </div>
                <label class="field">Due
                  <select value={it.due.on} onChange={(e) => {
                    const on = e.currentTarget.value;
                    setInstalment(i, { due: on === 'date' ? { on: 'date', date: c.startDate } : { on: on as 'signing' | 'acceptance' } });
                  }}>
                    <option value="signing">On signing</option>
                    <option value="acceptance">On acceptance (mark ready later)</option>
                    <option value="date">On a date</option>
                  </select>
                  {it.due.on === 'date' && (
                    <input type="date" value={it.due.date} onInput={(e) => e.currentTarget.value && setInstalment(i, { due: { on: 'date', date: e.currentTarget.value } })} />
                  )}
                </label>
                <div><button class="btn ghost" onClick={() => c.plan.type === 'instalments' && setPlan({ ...c.plan, items: c.plan.items.filter((_, j) => j !== i) })}>Remove</button></div>
              </div>
            ))}
            <button class="btn ghost" onClick={() => c.plan.type === 'instalments' && setPlan({
              ...c.plan,
              items: [...c.plan.items, { id: newId(), name: '', share: { percent: 0 }, due: { on: c.plan.items.length ? 'acceptance' : 'signing' }, ready: false, readyOn: null }],
            })}>+ Add instalment</button>
          </div>
        )}
        {c.plan.type === 'periodic' && (() => {
          const p = c.plan;
          return (
            <div class="grid2" style="margin-top:10px">
              <label class="field">Every
                <select value={p.every} onChange={(e) => setPlan({ ...p, every: e.currentTarget.value as 'month' | 'quarter' })}>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                </select>
              </label>
              <label class="field">Amount per period (before VAT)
                <input type="number" min={0} step={1000} value={p.amount} onInput={(e) => setPlan({ ...p, amount: Number(e.currentTarget.value) })} />
              </label>
              <label class="field">First period<input type="month" value={p.first} onInput={(e) => e.currentTarget.value && setPlan({ ...p, first: e.currentTarget.value })} /></label>
              <label class="field">Last period<input type="month" value={p.last} onInput={(e) => e.currentTarget.value && setPlan({ ...p, last: e.currentTarget.value })} /></label>
            </div>
          );
        })()}
        {c.plan.type === 'perUse' && <p class="muted">Bills take the services and prices above; you enter the quantities on each bill.</p>}
      </div>

      <div class="panel"><h3 style="margin-top:0">Payment terms</h3>
        <div class="grid2">
          <label class="field">Payment terms text
            <input value={c.paymentTerms} placeholder="Thanh toán trong 10 ngày kể từ ngày nhận phiếu / Payment within 10 days of receipt"
              onInput={(e) => set('paymentTerms', e.currentTarget.value)} />
          </label>
          <label class="field">Payment days (bill due date)
            <input type="number" min={0} value={c.paymentDays} onInput={(e) => set('paymentDays', Number(e.currentTarget.value))} />
          </label>
        </div>
      </div>

      <div class="page-head">
        <button class="btn ghost" onClick={() => navigate(c.parentId ? { name: 'contract', id: c.parentId } : saved ? { name: 'contract', id: c.id } : { name: 'contracts' })}>Cancel</button>
        <span>
          {c.status === 'draft'
            ? <><button class="btn ghost" onClick={() => save(false)}>Save draft</button>{' '}<button class="btn" onClick={() => save(true)}>Save &amp; activate</button></>
            : <button class="btn" onClick={() => save(false)}>Save</button>}
        </span>
      </div>
    </div>
  );
}
