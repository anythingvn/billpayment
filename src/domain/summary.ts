import type { Bill } from './types';
import { computeTotals } from './money';
import { isOverdue } from './status';

export interface Stat {
  amount: number;
  count: number;
}

export function homeSummary(bills: Bill[], today: string) {
  const unpaid: Stat = { amount: 0, count: 0 };
  const overdue: Stat = { amount: 0, count: 0 };
  const paidThisMonth: Stat = { amount: 0, count: 0 };
  const month = today.slice(0, 7);
  for (const b of bills) {
    const total = computeTotals(b.lines, b.vatRate).total;
    if (b.status === 'sent') {
      unpaid.amount += total;
      unpaid.count++;
      if (isOverdue(b, today)) {
        overdue.amount += total;
        overdue.count++;
      }
    } else if (b.status === 'paid' && b.paidDate?.slice(0, 7) === month) {
      paidThisMonth.amount += total;
      paidThisMonth.count++;
    }
  }
  return { unpaid, overdue, paidThisMonth };
}
