import type { Bill, Customer } from './types';
import { computeTotals } from './money';
import { periodName } from './report';
import { safeName } from '../drive/paths';

/** One bill on a statement: a details row (billed and/or paid in the period) or an unpaid row. */
export interface StatementRow {
  number: string;
  billDate: string;
  dueDate: string;
  paidDate: string | null;
  contract: string;
  total: number;
  /** The total when billed in the period, else null. */
  billed: number | null;
  /** The total when paid in the period, else null. */
  paid: number | null;
  /** Sort date of a details row: the bill date if billed in the period, else the payment date. */
  date: string;
  /** Days past the due date at min(to, today); 0 when not overdue. */
  daysOverdue: number;
}

export interface Statement {
  customer: Customer;
  from: string;
  to: string;
  today: string;
  /** "ĐC-20261231-6543" */
  number: string;
  /** Payment reference for the QR, e.g. "DC202612316543" (letters and digits only). */
  reference: string;
  /** The date the customer is asked to confirm by (today + 10 days). */
  confirmBy: string;
  opening: number;
  billed: number;
  paid: number;
  closing: number;
  details: StatementRow[];
  unpaid: StatementRow[];
}

const DAY = 86400000;
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Letters without accents, upper case ("Đức" → "DUC"). */
const plain = (s: string) => s.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Last 4 digits of the tax ID; else the first letters of up to 4 name words (no accents); else "KH". */
export function statementCode(customer: Pick<Customer, 'name' | 'taxId'>): string {
  const digits = customer.taxId.replace(/\D/g, '');
  if (digits) return digits.slice(-4);
  const initials = plain(customer.name).split(/\s+/).map((w) => w.replace(/[^A-Z0-9]/g, '')[0] ?? '').join('').slice(0, 4);
  return initials || 'KH';
}

/** The customer's statement for [from, to]: balances, details, unpaid bills. Drafts and cancelled bills never count. */
export function buildStatement(bills: Bill[], customer: Customer, from: string, to: string, today: string): Statement {
  const asOf = today < to ? today : to;
  const own = bills.filter((b) => b.customerId === customer.id && (b.status === 'sent' || b.status === 'paid'));
  const rows = own.map((b): StatementRow & { owedAtStart: boolean; owedAtEnd: boolean } => {
    const total = computeTotals(b.lines, b.vatRate).total;
    const billedIn = b.billDate >= from && b.billDate <= to;
    const paidIn = b.paidDate !== null && b.paidDate >= from && b.paidDate <= to;
    const ref = b.contractRef;
    return {
      number: b.number, billDate: b.billDate, dueDate: b.dueDate, paidDate: b.paidDate, total,
      contract: !ref ? '' : ref.parentNumber ? `${ref.number} · ${ref.parentNumber}` : ref.number,
      billed: billedIn ? total : null, paid: paidIn ? total : null,
      date: billedIn ? b.billDate : (b.paidDate ?? b.billDate),
      daysOverdue: Math.max(0, Math.round((utc(asOf) - utc(b.dueDate)) / DAY)),
      owedAtStart: b.billDate < from && (b.paidDate === null || b.paidDate >= from),
      owedAtEnd: b.billDate <= to && (b.paidDate === null || b.paidDate > to),
    };
  });
  const sum = (list: { total: number }[]) => list.reduce((a, r) => a + r.total, 0);
  const strip = ({ owedAtStart: _s, owedAtEnd: _e, ...r }: (typeof rows)[number]): StatementRow => r;
  const cmp = (a: string, b: string) => a.localeCompare(b);
  const opening = sum(rows.filter((r) => r.owedAtStart));
  const billed = sum(rows.filter((r) => r.billed !== null));
  const paid = sum(rows.filter((r) => r.paid !== null));
  const code = statementCode(customer);
  const ymd = to.replace(/-/g, '');
  return {
    customer, from, to, today,
    number: `ĐC-${ymd}-${code}`, reference: `DC${ymd}${code}`, confirmBy: iso(utc(today) + 10 * DAY),
    opening, billed, paid, closing: opening + billed - paid,
    details: rows.filter((r) => r.billed !== null || r.paid !== null).sort((a, b) => cmp(a.date, b.date) || cmp(a.number, b.number)).map(strip),
    unpaid: rows.filter((r) => r.owedAtEnd).sort((a, b) => cmp(a.dueDate, b.dueDate) || cmp(a.number, b.number)).map(strip),
  };
}

export interface StatementPreset {
  key: 'thisYear' | 'lastYear' | 'thisQuarter' | 'lastQuarter' | 'allTime';
  label: string;
  from: string;
  to: string;
}

/** Period shortcuts; current periods end today. `customerBills`: this customer's bills (for All time). */
export function statementPresets(today: string, customerBills: Bill[]): StatementPreset[] {
  const [y, m] = today.split('-').map(Number);
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const lastQ = new Date(Date.UTC(y, qStart - 4, 1));
  const qy = lastQ.getUTCFullYear(), qm = lastQ.getUTCMonth() + 1;
  const start = (yy: number, mm: number) => iso(Date.UTC(yy, mm - 1, 1));
  const earliest = customerBills.map((b) => b.billDate).sort()[0];
  return [
    { key: 'thisYear', label: 'This year', from: `${y}-01-01`, to: today },
    { key: 'lastYear', label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
    { key: 'thisQuarter', label: 'This quarter', from: start(y, qStart), to: today },
    { key: 'lastQuarter', label: 'Last quarter', from: start(qy, qm), to: iso(Date.UTC(qy, qm + 2, 0)) },
    { key: 'allTime', label: 'All time', from: earliest && earliest < today ? earliest : today, to: today },
  ];
}

/** "Đối chiếu <customer> <period>" (no extension). */
export const statementFileBase = (customerName: string, from: string, to: string): string =>
  `Đối chiếu ${safeName(customerName)} ${periodName(from, to)}`;
