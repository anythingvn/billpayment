import type { Bill, BillStatus } from './types';

const ALLOWED: Record<BillStatus, BillStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['paid', 'cancelled'],
  paid: ['sent'],
  cancelled: [],
};

export function canTransition(from: BillStatus, to: BillStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function applyStatus(bill: Bill, to: BillStatus, today: string, nowIso: string): Bill {
  if (!canTransition(bill.status, to)) {
    throw new Error(`Cannot change a ${bill.status} bill to ${to}`);
  }
  return { ...bill, status: to, paidDate: to === 'paid' ? today : null, updatedAt: nowIso };
}

export function isOverdue(bill: Bill, today: string): boolean {
  return bill.status === 'sent' && today > bill.dueDate;
}

export function displayStatus(bill: Bill, today: string): BillStatus | 'overdue' {
  return isOverdue(bill, today) ? 'overdue' : bill.status;
}

export function isLocked(bill: Bill): boolean {
  return bill.status !== 'draft';
}
