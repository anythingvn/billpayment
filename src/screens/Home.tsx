import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { listBills } from '../storage/db';
import { lastBackupAt, needsBackupReminder } from '../storage/backup';
import type { Bill } from '../domain/types';
import { homeSummary } from '../domain/summary';
import { displayStatus } from '../domain/status';
import { computeTotals } from '../domain/money';
import { formatDateVn, formatVnd, todayIso } from '../domain/format';

const LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' } as const;
type Filter = 'all' | keyof typeof LABEL;

export function StatusBadge({ bill, today }: { bill: Bill; today: string }) {
  const s = displayStatus(bill, today);
  return <span class={`badge ${s}`}>{LABEL[s]}</span>;
}

export function Home() {
  const { db } = useApp();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [remind, setRemind] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const today = todayIso();

  useEffect(() => {
    (async () => {
      setBills(await listBills(db));
      setRemind(needsBackupReminder(await lastBackupAt(db), new Date().toISOString()));
    })();
  }, []);

  if (!bills) return <p class="muted">Loading…</p>;
  const sum = homeSummary(bills, today);
  const needle = q.trim().toLowerCase();
  const shown = bills.filter(
    (b) => (filter === 'all' || displayStatus(b, today) === filter) &&
      (!needle || b.number.toLowerCase().includes(needle) || b.customer.name.toLowerCase().includes(needle)),
  );

  return (
    <div>
      {remind && (
        <div class="banner">
          <span>You haven't backed up in the last 7 days. A backup protects your bills if browser data is cleared.</span>
          <button class="btn" onClick={() => navigate({ name: 'backup' })}>Back up now</button>
        </div>
      )}
      <div class="page-head"><h2>Bills</h2><button class="btn" onClick={() => navigate({ name: 'newBill' })}>+ New bill</button></div>
      <div class="grid2" style="margin-bottom:16px">
        <Kpi label="Unpaid" stat={sum.unpaid} />
        <Kpi label="Overdue" stat={sum.overdue} color="var(--danger)" />
        <Kpi label="Paid this month" stat={sum.paidThisMonth} color="var(--ok)" />
      </div>
      <div class="page-head">
        <input placeholder="Search number or customer…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px" />
        <select value={filter} onChange={(e) => setFilter(e.currentTarget.value as Filter)}>
          <option value="all">All statuses</option>
          {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <table class="list">
        <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th>Due</th><th class="r">Total</th><th>Status</th></tr></thead>
        <tbody>
          {shown.map((b) => (
            <tr key={b.id} class="click" onClick={() => navigate({ name: 'bill', id: b.id })}>
              <td>{b.number}</td>
              <td>{b.customer.name}</td>
              <td>{formatDateVn(b.billDate)}</td>
              <td>{formatDateVn(b.dueDate)}</td>
              <td class="r">{formatVnd(computeTotals(b.lines, b.vatRate).total)}</td>
              <td><StatusBadge bill={b} today={today} /></td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr><td colSpan={6} class="muted">{bills.length === 0 ? 'No bills yet. Start with “+ New bill”.' : 'No bills match.'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, stat, color }: { label: string; stat: { amount: number; count: number }; color?: string }) {
  return (
    <div class="panel" style="margin:0">
      <div class="muted">{label}</div>
      <div style={`font-size:22px;font-weight:700;color:${color ?? 'inherit'}`}>{formatVnd(stat.amount)} ₫</div>
      <div class="muted">{stat.count} bill{stat.count === 1 ? '' : 's'}</div>
    </div>
  );
}
