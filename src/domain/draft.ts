import type { Bill, BillLine, Customer, CustomerSnapshot, Service, Settings } from './types';
import { addDays, daysBetween } from './format';
import { defaultBankAccount, defaultFooterText } from './settings';

export type DraftBill = Omit<Bill, 'id' | 'number' | 'status' | 'paidDate' | 'createdAt' | 'updatedAt' | 'drive'> & {
  id: string | null;
  number: string | null;
};

const EMPTY_CUSTOMER: CustomerSnapshot = { name: '', address: '', taxId: '', contactPerson: '', email: '', phone: '' };

export function newDraft(settings: Settings, today: string): DraftBill {
  return {
    id: null,
    number: null,
    billDate: today,
    dueDate: addDays(today, settings.defaultPaymentDays),
    customerId: '',
    customer: { ...EMPTY_CUSTOMER },
    lines: [],
    vatRate: settings.defaultVatRate,
    footerNote: defaultFooterText(settings),
    ...(defaultBankAccount(settings) && { bankAccount: defaultBankAccount(settings) }),
  };
}

export function setCustomer(d: DraftBill, c: Customer): DraftBill {
  const { name, address, taxId, contactPerson, email, phone } = c;
  return { ...d, customerId: c.id, customer: { name, address, taxId, contactPerson, email, phone } };
}

export function addServiceLine(d: DraftBill, s: Service): DraftBill {
  const line: BillLine = { nameVi: s.nameVi, nameEn: s.nameEn, unitVi: s.unitVi, unitEn: s.unitEn, qty: 1, unitPrice: s.unitPrice, details: [] };
  return { ...d, lines: [...d.lines, line] };
}

export function addCustomLine(d: DraftBill): DraftBill {
  const line: BillLine = { nameVi: '', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 0, details: [] };
  return { ...d, lines: [...d.lines, line] };
}

export function updateLine(d: DraftBill, index: number, patch: Partial<BillLine>): DraftBill {
  return { ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) };
}

export function removeLine(d: DraftBill, index: number): DraftBill {
  return { ...d, lines: d.lines.filter((_, i) => i !== index) };
}

/** Moves the bill date and keeps the same number of days until the due date. */
export function setBillDate(d: DraftBill, billDate: string): DraftBill {
  return { ...d, billDate, dueDate: addDays(billDate, daysBetween(d.billDate, d.dueDate)) };
}

export function draftFromBill(b: Bill): DraftBill {
  return {
    id: b.id, number: b.number, billDate: b.billDate, dueDate: b.dueDate, customerId: b.customerId,
    customer: { ...b.customer }, lines: b.lines.map((l) => ({ ...l, details: [...(l.details ?? [])] })), vatRate: b.vatRate,
    ...(b.footerNote !== undefined && { footerNote: b.footerNote }),
    ...(b.bankAccount && { bankAccount: { ...b.bankAccount } }),
    ...(b.business && { business: { ...b.business } }),
    ...(b.contractRef && { contractRef: { ...b.contractRef } }),
    // On a server, the version this draft was loaded at (so a save can't overwrite someone else's change).
    ...(b.version !== undefined && { version: b.version }),
  };
}

export function duplicateAsDraft(b: Bill, settings: Settings, today: string): DraftBill {
  // A new bill prints today's business details, so the old bill's copy is not carried over.
  const { business: _old, ...rest } = draftFromBill(b);
  return {
    ...rest, id: null, number: null, billDate: today, dueDate: addDays(today, settings.defaultPaymentDays),
    // Same contract, but not the same plan item (that one is already billed).
    ...(rest.contractRef && { contractRef: { ...rest.contractRef, itemKey: null } }),
  };
}

/** Raw lines from the editor's details box; blanks are kept so pressing Enter works while typing. */
export function splitDetails(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/** Tidies a draft before saving: trims detail lines and drops blank ones. */
export function cleanDraft(d: DraftBill): DraftBill {
  return {
    ...d,
    lines: d.lines.map((l) => ({ ...l, details: (l.details ?? []).map((t) => t.trim()).filter(Boolean) })),
    ...(d.footerNote !== undefined && { footerNote: d.footerNote.trim() }),
  };
}
