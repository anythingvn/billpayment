import type { BillLine, Contract, Instalment, PeriodicPlan } from './types';
import { computeTotals } from './money';
import { formatVnd } from './format';

export const valueBeforeVat = (c: Pick<Contract, 'lines'>): number => computeTotals(c.lines, 'none').subtotal;

/**
 * Value before VAT of what the plan bills: amount × number of periods for a periodic plan
 * (its service lines describe one period), otherwise the service lines.
 */
export function planValueBeforeVat(c: Pick<Contract, 'lines' | 'plan'>): number {
  return c.plan.type === 'periodic' ? c.plan.amount * periodKeys(c.plan).length : valueBeforeVat(c);
}

/** Contract value including VAT (same maths as bills). */
export function contractValue(c: Pick<Contract, 'lines' | 'vatRate' | 'plan'>): number {
  if (c.plan.type !== 'periodic') return computeTotals(c.lines, c.vatRate).total;
  const line: BillLine = { nameVi: '', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: planValueBeforeVat(c), details: [] };
  return computeTotals([line], c.vatRate).total;
}

const whole = (v: number, min: number) => Number.isInteger(v) && v >= min;

/** Checks every contract save (draft too) so nothing is stored that can't be shown or backed up. */
export function contractSaveErrors(c: Contract): string[] {
  const errs: string[] = [];
  c.lines.forEach((l, i) => {
    if (!whole(l.qty, 1)) errs.push(`Line ${i + 1}: Quantity must be a whole number of at least 1`);
    if (!whole(l.unitPrice, 0)) errs.push(`Line ${i + 1}: Unit price must be a whole number of at least 0`);
  });
  if (!whole(c.paymentDays, 0)) errs.push('Payment days must be a whole number of at least 0');
  if (c.plan.type === 'periodic' && !whole(c.plan.amount, 0)) errs.push('The amount per period must be a whole number of at least 0');
  if (c.plan.type === 'instalments') {
    c.plan.items.forEach((i, n) => {
      if ('percent' in i.share) {
        if (!Number.isFinite(i.share.percent) || i.share.percent < 0) errs.push(`Instalment ${n + 1}: the percentage must be a number of at least 0`);
      } else if (!whole(i.share.amount, 0)) errs.push(`Instalment ${n + 1}: the amount must be a whole number of at least 0`);
    });
  }
  return errs;
}

/**
 * Amount (before VAT) of each instalment. Percent shares are rounded to the đồng;
 * the last instalment takes the rounding difference when all shares are percents
 * or the shares add up to the base, so the instalments total the base exactly.
 */
export function instalmentAmounts(items: Instalment[], base: number): number[] {
  const raw = items.map((i) => ('percent' in i.share ? Math.round((base * i.share.percent) / 100) : i.share.amount));
  if (raw.length === 0) return raw;
  const intended = items.reduce((sum, i) => sum + ('percent' in i.share ? (base * i.share.percent) / 100 : i.share.amount), 0);
  if (Math.abs(intended - base) < 1) {
    const others = raw.slice(0, -1).reduce((a, b) => a + b, 0);
    raw[raw.length - 1] = base - others;
  }
  return raw;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Period keys YYYY-MM from first to last, stepping one month or one quarter. */
export function periodKeys(p: PeriodicPlan): string[] {
  const step = p.every === 'quarter' ? 3 : 1;
  const [fy, fm] = p.first.split('-').map(Number);
  const keys: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const m0 = fm - 1 + i * step;
    const key = `${fy + Math.floor(m0 / 12)}-${pad((m0 % 12) + 1)}`;
    if (key > p.last) break;
    keys.push(key);
  }
  return keys;
}

export function periodLabel(key: string, every: 'month' | 'quarter'): { vi: string; en: string } {
  const [y, m] = key.split('-');
  if (every === 'quarter') {
    const q = Math.floor((Number(m) - 1) / 3) + 1;
    return { vi: `Quý ${q}/${y}`, en: `Quarter ${q}/${y}` };
  }
  return { vi: `Kỳ tháng ${m}/${y}`, en: `Period ${m}/${y}` };
}

/** Problems that block activating a contract or addendum; `parent` is needed for addenda. */
export function planErrors(c: Contract, parent?: Contract | null): string[] {
  const errs: string[] = [];
  if (c.endDate && c.endDate < c.startDate) errs.push('The end date is before the start date');
  const plan = c.plan;
  if (plan.type === 'instalments') {
    const base = valueBeforeVat(c);
    if (plan.items.length === 0) errs.push('Add at least one instalment');
    else if (plan.items.every((i) => 'percent' in i.share)) {
      const total = plan.items.reduce((s, i) => s + ('percent' in i.share ? i.share.percent : 0), 0);
      if (Math.abs(total - 100) > 0.001) errs.push(`Instalments add up to ${Math.round(total * 1000) / 1000}%, not 100%`);
    } else {
      const total = plan.items.reduce((s, i) => s + ('percent' in i.share ? (base * i.share.percent) / 100 : i.share.amount), 0);
      if (Math.abs(total - base) >= 1) errs.push(`Instalments add up to ${formatVnd(Math.round(total))} ₫, not ${formatVnd(base)} ₫`);
    }
    plan.items.forEach((i, n) => {
      if (!i.name.trim()) errs.push(`Instalment ${n + 1} needs a name`);
      if (i.due.on === 'date' && !i.due.date) errs.push(`Instalment ${n + 1} needs a due date`);
    });
  } else if (plan.type === 'periodic') {
    if (plan.first > plan.last) errs.push('The first period is after the last one');
    if (!Number.isInteger(plan.amount) || plan.amount <= 0) errs.push('Enter the amount per period');
  }
  if (c.kind === 'addendum' && c.effect === 'changesTerms') {
    if (!c.effectiveDate) errs.push('Choose the date the new terms apply from');
    else if (parent && (c.effectiveDate < parent.startDate || (parent.endDate !== null && c.effectiveDate > parent.endDate))) {
      errs.push("The effective date is outside the contract's dates");
    }
  }
  return errs;
}

/** Next addendum number PLnn within a contract. */
export function nextAddendumNumber(siblings: Pick<Contract, 'number'>[]): string {
  const used = siblings.map((s) => /^PL(\d+)$/i.exec(s.number.trim())?.[1]).filter(Boolean).map(Number);
  return `PL${pad((used.length ? Math.max(...used) : 0) + 1)}`;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export function isDuplicateNumber(all: Pick<Contract, 'id' | 'number'>[], number: string, selfId: string | null): boolean {
  return all.some((c) => c.id !== selfId && norm(c.number) === norm(number));
}
