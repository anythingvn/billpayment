import { VAT_RATES, type Bill, type Settings, type VatRate } from './types';
import { computeTotals } from './money';

/** One bill as the accountant report shows it. */
export interface ReportBill {
  number: string;
  billDate: string;
  dueDate: string;
  paidDate: string | null;
  customer: string;
  customerTaxId: string;
  /** '' | '12/2026/HĐDV-SM' | 'PL01 · 12/2026/HĐDV-SM' */
  contract: string;
  status: 'sent' | 'paid';
  vatRate: VatRate;
  beforeVat: number;
  vat: number;
  total: number;
  /** Days past the due date at the end of the period; 0 when not overdue. */
  daysOverdue: number;
}

export interface VatRow { rate: VatRate; count: number; beforeVat: number; vat: number; total: number }

export interface Report {
  from: string;
  to: string;
  madeOn: string;
  business: { name: string; taxId: string };
  /** Bills paid in the period, one row per VAT rate that has bills, in VAT_RATES order. */
  vat: VatRow[];
  vatTotal: Omit<VatRow, 'rate'>;
  received: number;
  billed: { count: number; total: number };
  owed: { count: number; total: number };
  paid: ReportBill[];
  billedBills: ReportBill[];
  owedBills: ReportBill[];
}

const DAY = 86400000;
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Last day of a month (month 1–12, may be 0 or 13 to roll the year). */
const monthEnd = (y: number, m: number) => iso(Date.UTC(y, m, 0));
const monthStart = (y: number, m: number) => iso(Date.UTC(y, m - 1, 1));

function toRow(b: Bill, to: string): ReportBill {
  const t = computeTotals(b.lines, b.vatRate);
  const ref = b.contractRef;
  return {
    number: b.number, billDate: b.billDate, dueDate: b.dueDate, paidDate: b.paidDate,
    customer: b.customer.name, customerTaxId: b.customer.taxId,
    contract: !ref ? '' : ref.parentNumber ? `${ref.number} · ${ref.parentNumber}` : ref.number,
    status: b.status === 'paid' ? 'paid' : 'sent',
    vatRate: b.vatRate, beforeVat: t.subtotal, vat: t.vat, total: t.total,
    daysOverdue: Math.max(0, Math.round((utc(to) - utc(b.dueDate)) / DAY)),
  };
}

const by = (...keys: (keyof ReportBill)[]) => (a: ReportBill, b: ReportBill) => {
  for (const k of keys) {
    const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''));
    if (c) return c;
  }
  return 0;
};
const sum = (rows: ReportBill[]) => ({ count: rows.length, total: rows.reduce((a, r) => a + r.total, 0) });

/** The accountant report for bills in [from, to] (inclusive). Drafts and cancelled bills never count. */
export function buildReport(bills: Bill[], from: string, to: string, s: Settings, madeOn: string): Report {
  const rows = bills.filter((b) => b.status === 'sent' || b.status === 'paid').map((b) => toRow(b, to));
  const paid = rows.filter((r) => r.paidDate !== null && r.paidDate >= from && r.paidDate <= to).sort(by('paidDate', 'number'));
  const billedBills = rows.filter((r) => r.billDate >= from && r.billDate <= to).sort(by('billDate', 'number'));
  const owedBills = rows.filter((r) => r.billDate <= to && (r.paidDate === null || r.paidDate > to)).sort(by('dueDate', 'number'));

  const vat = VAT_RATES.map((rate): VatRow => {
    const list = paid.filter((r) => r.vatRate === rate);
    return {
      rate, count: list.length,
      beforeVat: list.reduce((a, r) => a + r.beforeVat, 0), vat: list.reduce((a, r) => a + r.vat, 0), total: list.reduce((a, r) => a + r.total, 0),
    };
  }).filter((r) => r.count > 0);
  const vatTotal = {
    count: paid.length,
    beforeVat: vat.reduce((a, r) => a + r.beforeVat, 0), vat: vat.reduce((a, r) => a + r.vat, 0), total: vat.reduce((a, r) => a + r.total, 0),
  };
  return {
    from, to, madeOn, business: { name: s.businessName, taxId: s.taxId },
    vat, vatTotal, received: vatTotal.total, billed: sum(billedBills), owed: sum(owedBills),
    paid, billedBills, owedBills,
  };
}

export const vatLabel = (rate: VatRate): string => (rate === 'none' ? 'Không chịu thuế / No VAT' : `${rate}%`);

export interface ReportPreset {
  key: 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear';
  label: string;
  from: string;
  to: string;
}

/** Date shortcuts for the Reports screen, relative to today (YYYY-MM-DD). */
export function reportPresets(today: string): ReportPreset[] {
  const [y, m] = today.split('-').map(Number);
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const last = new Date(Date.UTC(y, m - 2, 1));
  const lastQ = new Date(Date.UTC(y, qStart - 4, 1));
  const ly = last.getUTCFullYear(), lm = last.getUTCMonth() + 1;
  const qy = lastQ.getUTCFullYear(), qm = lastQ.getUTCMonth() + 1;
  return [
    { key: 'thisMonth', label: 'This month', from: monthStart(y, m), to: monthEnd(y, m) },
    { key: 'lastMonth', label: 'Last month', from: monthStart(ly, lm), to: monthEnd(ly, lm) },
    { key: 'thisQuarter', label: 'This quarter', from: monthStart(y, qStart), to: monthEnd(y, qStart + 2) },
    { key: 'lastQuarter', label: 'Last quarter', from: monthStart(qy, qm), to: monthEnd(qy, qm + 2) },
    { key: 'thisYear', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

/** "Báo cáo 2026-09.xlsx" (a month), "Báo cáo 2026-Q3.xlsx" (a quarter), "Báo cáo 2026.xlsx" (a year), else the dates. */
export function reportFileName(from: string, to: string): string {
  const [y, m, d] = from.split('-').map(Number);
  const [ty] = to.split('-').map(Number);
  if (d === 1 && ty === y) {
    if (m === 1 && to === `${y}-12-31`) return `Báo cáo ${y}.xlsx`;
    if (to === monthEnd(y, m)) return `Báo cáo ${from.slice(0, 7)}.xlsx`;
    if ((m - 1) % 3 === 0 && to === monthEnd(y, m + 2)) return `Báo cáo ${y}-Q${(m - 1) / 3 + 1}.xlsx`;
  }
  return `Báo cáo ${from} – ${to}.xlsx`;
}
