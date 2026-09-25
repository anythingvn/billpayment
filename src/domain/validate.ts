import type { BillLine, Settings } from './types';
import type { DraftBill } from './draft';
import { isValidAccount } from './vietqr';

export interface Blocker {
  message: string;
  target: 'customer' | 'services' | 'settings';
}

export function lineErrors(line: BillLine): string[] {
  const errs: string[] = [];
  if (!line.nameVi.trim()) errs.push('Service name is required');
  if (!Number.isInteger(line.qty) || line.qty < 1) errs.push('Quantity must be a whole number of at least 1');
  if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) errs.push('Unit price must be a whole number of at least 0');
  return errs;
}

/** Checks that must pass even for a draft: numbers must be real whole numbers so the bill can be shown and backed up. */
export function draftSaveErrors(d: DraftBill): string[] {
  const out: string[] = [];
  d.lines.forEach((l, i) => {
    if (!Number.isInteger(l.qty) || l.qty < 1) out.push(`Line ${i + 1}: Quantity must be a whole number of at least 1`);
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) out.push(`Line ${i + 1}: Unit price must be a whole number of at least 0`);
  });
  return out;
}

export function dateErrors(billDate: string, dueDate: string): string[] {
  return dueDate < billDate ? ['Due date cannot be before the bill date'] : [];
}

export function exportBlockers(d: DraftBill, s: Settings): Blocker[] {
  const out: Blocker[] = [];
  if (!d.customerId || !d.customer.name.trim()) out.push({ message: 'Choose a customer', target: 'customer' });
  if (d.lines.length === 0) out.push({ message: 'Add at least one service line', target: 'services' });
  d.lines.forEach((l, i) => lineErrors(l).forEach((e) => out.push({ message: `Line ${i + 1}: ${e}`, target: 'services' })));
  dateErrors(d.billDate, d.dueDate).forEach((e) => out.push({ message: e, target: 'services' }));
  if (!s.businessName.trim()) out.push({ message: 'Enter your business name in Settings', target: 'settings' });
  if (!s.bankBin) out.push({ message: 'Choose your bank in Settings', target: 'settings' });
  if (!s.accountNumber.trim()) out.push({ message: 'Enter your account number in Settings', target: 'settings' });
  else if (!isValidAccount(s.accountNumber)) {
    out.push({ message: 'Account number must contain only digits (check Settings)', target: 'settings' });
  }
  return out;
}
