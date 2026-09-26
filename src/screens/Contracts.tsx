import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { listBills, listContracts } from '../storage/db';
import type { Bill, Contract, ContractStatus } from '../domain/types';
import { contractSummary } from '../domain/contractTerms';
import { formatDateVn, formatVnd } from '../domain/format';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Draft', active: 'Active', completed: 'Completed', terminated: 'Terminated',
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const cls = status === 'active' ? 'sent' : status === 'completed' ? 'paid' : status === 'terminated' ? 'cancelled' : 'draft';
  return <span class={`badge ${cls}`}>{CONTRACT_STATUS_LABEL[status]}</span>;
}

export function Contracts() {
  const { db } = useApp();
  const [all, setAll] = useState<Contract[] | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [status, setStatus] = useState<'all' | ContractStatus>('all');
  const [q, setQ] = useState('');
  useEffect(() => {
    (async () => {
      setBills(await listBills(db));
      setAll(await listContracts(db));
    })();
  }, []);
  if (!all) return <p class="muted">Loading…</p>;

  const addenda = all.filter((c) => c.kind === 'addendum');
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter((c) => c.kind === 'contract')
    .filter((c) => status === 'all' || c.status === status)
    .filter((c) => !needle || [c.number, c.customer.name, c.title].some((t) => t.toLowerCase().includes(needle)))
    .sort((a, b) => b.signedDate.localeCompare(a.signedDate) || b.number.localeCompare(a.number));

  return (
    <div>
      <div class="page-head"><h2>Contracts</h2><button class="btn" onClick={() => navigate({ name: 'newContract' })}>+ New contract</button></div>
      <div class="page-head">
        <input placeholder="Search number, customer or title…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px" />
        <label class="muted">Status{' '}
          <select value={status} onChange={(e) => setStatus(e.currentTarget.value as 'all' | ContractStatus)}>
            <option value="all">All</option>
            {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <table class="list">
        <thead><tr><th>No.</th><th>Customer</th><th>Title</th><th>Signed</th><th>Status</th><th class="r">Value</th><th class="r">Billed</th><th class="r">Paid</th></tr></thead>
        <tbody>
          {shown.map((c) => {
            const sum = contractSummary(c, addenda, bills);
            return (
              <tr key={c.id} class="click" onClick={() => navigate({ name: 'contract', id: c.id })}>
                <td>{c.number}</td>
                <td>{c.customer.name}</td>
                <td>{c.title}</td>
                <td>{formatDateVn(c.signedDate)}</td>
                <td><ContractStatusBadge status={c.status} /></td>
                <td class="r">{formatVnd(sum.totalValue)}</td>
                <td class="r">{formatVnd(sum.billed)}</td>
                <td class="r">{formatVnd(sum.paid)}</td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr><td colSpan={8} class="muted">{all.length === 0 ? 'No contracts yet. Start with “+ New contract”.' : 'No contracts match.'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
