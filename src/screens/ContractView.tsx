import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate, routeToHash } from '../router';
import { deleteContract, getContract, listBills, listContracts, putContract, templateFor } from '../storage/db';
import { driveConfigured, isUploading, onDriveChange, prepareDrive, saveDocxToDrive } from '../drive/service';
import { buildContractDocx } from '../docs/documents';
import { downloadBlob } from '../docs/download';
import { DriveStatusText, formatDateTime } from '../ui/DriveStatusLine';
import type { Bill, Contract, ContractStatus } from '../domain/types';
import { contractItems, contractSummary, linkedBills, type ItemRow } from '../domain/contractTerms';
import { contractValue } from '../domain/contractPlan';
import { computeTotals } from '../domain/money';
import { formatDateVn, formatVnd, todayIso } from '../domain/format';
import { ContractStatusBadge } from './Contracts';
import { StatusBadge } from './Home';
import { Authorship } from '../ui/Authorship';
import { useWrite } from '../ui/useOnline';
import { isHandled } from '../storage/errors';
import { useCan } from '../ui/useCan';

const EFFECT_LABEL = { addsWork: 'Adds work', changesTerms: 'Changes terms' } as const;

export function ContractView({ id }: { id: string }) {
  const { db, settings } = useApp();
  const w = useWrite();
  const can = useCan();
  const [contract, setContract] = useState<Contract | null | undefined>(undefined);
  const [hasTemplate, setHasTemplate] = useState({ contract: false, addendum: false });
  const [busy, setBusy] = useState('');
  const [addenda, setAddenda] = useState<Contract[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const c = await getContract(db, id);
    // An addendum's page is its contract's page.
    if (c?.parentId) return navigate({ name: 'contract', id: c.parentId });
    setAddenda((await listContracts(db)).filter((x) => x.parentId === id));
    setBills(await listBills(db));
    setHasTemplate({ contract: !!(await templateFor(db, 'contract', c?.templateId)), addendum: !!(await templateFor(db, 'addendum')) });
    setContract(c ?? null);
  };
  useEffect(() => { load(); }, [id]);
  // Reload when a Drive upload of this contract or one of its addenda starts or finishes.
  useEffect(() => onDriveChange(() => { load(); }), [id]);
  useEffect(() => { prepareDrive(db, settings); }, [settings.googleClientId]);

  if (contract === undefined) return <p class="muted">Loading…</p>;
  if (contract === null) return <p>Contract not found. <a href="#/contracts">Back to contracts</a></p>;

  const today = todayIso();
  const sum = contractSummary(contract, addenda, bills);
  const rows = contractItems(contract, addenda, bills, today);
  const records = [contract, ...addenda];
  const numberOf = (sourceId: string) => records.find((r) => r.id === sourceId)?.number ?? '';
  const replacedBy = (row: ItemRow) => addenda
    .filter((a) => a.effect === 'changesTerms' && a.status === 'active' && a.effectiveDate && row.dueDate && a.effectiveDate <= row.dueDate)
    .sort((a, b) => b.effectiveDate!.localeCompare(a.effectiveDate!))[0]?.number ?? '';
  const linked = linkedBills(contract, addenda, bills);

  const setStatus = async (status: ContractStatus) => {
    const next = { ...contract, status, updatedAt: new Date().toISOString() };
    setContract(await putContract(db, next));
  };
  const markReady = async (row: ItemRow) => {
    const source = records.find((r) => r.id === row.sourceId);
    if (!source || source.plan.type !== 'instalments') return;
    const plan = { ...source.plan, items: source.plan.items.map((i) => (i.id === row.key ? { ...i, ready: true, readyOn: today } : i)) };
    await putContract(db, { ...source, plan, updatedAt: new Date().toISOString() });
    await load();
  };
  const setAddendumStatus = async (a: Contract, status: ContractStatus) => {
    await putContract(db, { ...a, status, updatedAt: new Date().toISOString() });
    await load();
  };
  const removeAddendum = async (a: Contract) => {
    if (!confirm(`Delete addendum ${a.number}?`)) return;
    if ((await deleteContract(db, a.id)) === 'refused') setMsg('This addendum has bills. Terminate it instead.');
    await load();
  };
  const remove = async () => {
    if (!confirm(`Delete contract ${contract.number}?`)) return;
    if ((await deleteContract(db, contract.id)) === 'refused') {
      setMsg('This contract has bills or addenda. Terminate it instead.');
      return;
    }
    navigate({ name: 'contracts' });
  };

  const downloadWord = async (c: Contract) => {
    setMsg('');
    setBusy(c.id);
    try {
      const doc = await buildContractDocx(db, c, settings);
      if (doc) downloadBlob(doc.blob, doc.fileName);
      else setMsg('Add a template in Settings → Documents');
    } catch (e) {
      if (isHandled(e)) return;
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const saveToDrive = (c: Contract) => { saveDocxToDrive(db, { type: 'contract', id: c.id }, settings).catch(() => undefined); };
  const configured = driveConfigured(settings);
  const addTemplateLink = <a href="#/settings">Add a template in Settings → Documents</a>;

  const stateCell = (row: ItemRow) => {
    switch (row.state) {
      case 'due':
        if (!can('record.edit')) return <span class="muted">Due</span>;
        return <a class="btn" href={routeToHash({ name: 'newBillFromContract', contractId: row.sourceId, itemKey: row.key })}>Create bill</a>;
      case 'waiting':
        if (!can('record.edit')) return <span class="muted">Waiting</span>;
        return <button class="btn ghost" {...w()} onClick={() => markReady(row)}>Mark ready</button>;
      case 'billed':
      case 'paid':
        return <span>{row.state === 'paid' ? 'Paid' : 'Billed'} · <a href={routeToHash({ name: 'bill', id: row.billId! })}>{row.billNumber}</a></span>;
      case 'superseded':
        return <span class="muted">Replaced by {replacedBy(row)}</span>;
      default:
        return <span class="muted">From {formatDateVn(row.dueDate!)}</span>;
    }
  };

  return (
    <div>
      <div class="page-head">
        <h2>
          <button class="btn ghost" style="margin-right:10px" onClick={() => navigate({ name: 'contracts' })}>← Contracts</button>
          {contract.number} <ContractStatusBadge status={contract.status} />
        </h2>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          {hasTemplate.contract
            ? <button class="btn ghost" disabled={busy === contract.id} onClick={() => downloadWord(contract)}>Word (.docx)</button>
            : addTemplateLink}
          {can('record.edit') && <button class="btn ghost" {...w()} onClick={() => navigate({ name: 'editContract', id: contract.id })}>Edit</button>}
          {contract.status === 'active' && can('contract.close') && <button class="btn ghost" {...w()} onClick={() => setStatus('completed')}>Mark completed</button>}
          {contract.status !== 'terminated' && can('contract.close') && <button class="btn ghost" {...w()} onClick={() => setStatus('terminated')}>Terminate</button>}
          {can('record.remove') && <button class="btn danger" {...w()} onClick={remove}>Delete</button>}
        </span>
      </div>
      {msg && <p class="errors">{msg}</p>}
      <Authorship record={contract} />
      {contract.status === 'active' && hasTemplate.contract && can('drive.record') && (
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <DriveStatusText status={contract.drive} uploading={isUploading(contract.id)} configured={configured} onSave={() => saveToDrive(contract)}
            saved={(when) => `Word saved to Drive ${when}`} notSaved={(e) => `Not saved: ${e}`} />
          {configured
            ? <button class="btn ghost" {...w(isUploading(contract.id))} onClick={() => saveToDrive(contract)}>
              {contract.drive?.fileId ? 'Update in Google Drive' : 'Save to Google Drive'}</button>
            : <a href="#/settings" class="muted">Connect Google Drive in Settings</a>}
        </div>
      )}
      <p class="muted">{contract.title} · {contract.customer.name} · signed {formatDateVn(contract.signedDate)}
        {' '}· {formatDateVn(contract.startDate)}{contract.endDate ? ` – ${formatDateVn(contract.endDate)}` : ''}</p>

      <div class="grid2" data-testid="contract-summary" style="margin-bottom:16px">
        {([['Value', sum.totalValue], ['Billed', sum.billed], ['Paid', sum.paid], ['Left', sum.left]] as const).map(([label, v]) => (
          <div key={label} class="panel" style="margin:0"><div class="muted">{label}</div><div style="font-size:20px;font-weight:700">{formatVnd(v)} ₫</div></div>
        ))}
      </div>

      <div class="panel"><h3 style="margin-top:0">Billing plan</h3>
        {rows.length === 0
          ? <p class="muted">{contract.plan.type === 'perUse' ? 'Pay per use: create bills from Bills → + New bill → Contract.' : 'No items.'}</p>
          : (
            <table class="list">
              <thead><tr><th>Item</th><th>From</th><th class="r">Amount (before VAT)</th><th>Due</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.sourceId}-${r.key}`} style={r.state === 'superseded' ? 'opacity:.55' : ''}>
                    <td>{r.label.vi}{r.label.en && <span class="muted"> / {r.label.en}</span>}</td>
                    <td>{r.sourceId === contract.id ? 'Contract' : numberOf(r.sourceId)}</td>
                    <td class="r">{formatVnd(r.amount)}</td>
                    <td>{r.dueDate ? formatDateVn(r.dueDate) : 'On acceptance'}</td>
                    <td>{stateCell(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <div class="panel"><h3 style="margin-top:0">Bills</h3>
        <table class="list">
          <thead><tr><th>No.</th><th>Date</th><th>For</th><th class="r">Total</th><th>Status</th></tr></thead>
          <tbody>
            {linked.map((b) => (
              <tr key={b.id} class="click" onClick={() => navigate({ name: 'bill', id: b.id })}>
                <td>{b.number}</td>
                <td>{formatDateVn(b.billDate)}</td>
                <td>{b.contractRef!.contractId === contract.id ? 'Contract' : numberOf(b.contractRef!.contractId)}</td>
                <td class="r">{formatVnd(computeTotals(b.lines, b.vatRate).total)}</td>
                <td><StatusBadge bill={b} today={today} /></td>
              </tr>
            ))}
            {linked.length === 0 && <tr><td colSpan={5} class="muted">No bills yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="page-head" style="margin-bottom:8px"><h3 style="margin:0">Addenda</h3>
          {can('record.edit') && <button class="btn ghost" {...w()} onClick={() => navigate({ name: 'newAddendum', parentId: contract.id })}>+ New addendum</button>}</div>
        <table class="list">
          <thead><tr><th>No.</th><th>Effect</th><th>Signed</th><th>Effective</th><th class="r">Value</th><th>Status</th><th /></tr></thead>
          <tbody>
            {addenda.map((a) => (
              <tr key={a.id}>
                <td>{a.number}</td>
                <td>{a.effect ? EFFECT_LABEL[a.effect] : ''}</td>
                <td>{formatDateVn(a.signedDate)}</td>
                <td>{a.effectiveDate ? formatDateVn(a.effectiveDate) : '—'}</td>
                <td class="r">{formatVnd(contractValue(a))}</td>
                <td><ContractStatusBadge status={a.status} /></td>
                <td style="white-space:nowrap">
                  {hasTemplate.addendum
                    ? <button class="btn ghost" disabled={busy === a.id} onClick={() => downloadWord(a)}>Word</button>
                    : addTemplateLink}
                  {a.status === 'active' && hasTemplate.addendum && configured && can('drive.record') && <> · <button class="btn ghost" {...w(isUploading(a.id))}
                    title={a.drive?.error ? `Not saved: ${a.drive.error}` : a.drive?.savedAt ? `Word saved to Drive ${formatDateTime(a.drive.savedAt)}` : undefined}
                    style={a.drive?.error ? 'color:var(--danger)' : ''}
                    onClick={() => saveToDrive(a)}>{isUploading(a.id) ? 'Uploading…' : a.drive?.error ? 'Retry Drive' : a.drive?.fileId ? 'Update in Drive' : 'Save to Drive'}</button></>}
                  {can('record.edit') && <>{' · '}<a href={routeToHash({ name: 'editContract', id: a.id })}>Edit</a></>}
                  {a.status !== 'terminated' && can('contract.close') && <> · <button class="btn ghost" {...w()} onClick={() => setAddendumStatus(a, 'terminated')}>Terminate</button></>}
                  {a.status === 'draft' && can('record.remove') && <> · <button class="btn ghost" {...w()} onClick={() => removeAddendum(a)}>Delete</button></>}
                </td>
              </tr>
            ))}
            {addenda.length === 0 && <tr><td colSpan={7} class="muted">No addenda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
