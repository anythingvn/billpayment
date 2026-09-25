import type { Bill, BillLine, Customer, CustomerSnapshot, Service, Settings } from './types';
import { addDays } from './format';

export type DraftBill = Omit<Bill, 'id' | 'number' | 'status' | 'paidDate' | 'createdAt' | 'updatedAt'> & {
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
  };
}

export function setCustomer(d: DraftBill, c: Customer): DraftBill {
  const { name, address, taxId, contactPerson, email, phone } = c;
  return { ...d, customerId: c.id, customer: { name, address, taxId, contactPerson, email, phone } };
}

export function addServiceLine(d: DraftBill, s: Service): DraftBill {
  const line: BillLine = { nameVi: s.nameVi, nameEn: s.nameEn, unitVi: s.unitVi, unitEn: s.unitEn, qty: 1, unitPrice: s.unitPrice };
  return { ...d, lines: [...d.lines, line] };
}

export function addCustomLine(d: DraftBill): DraftBill {
  const line: BillLine = { nameVi: '', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 0 };
  return { ...d, lines: [...d.lines, line] };
}

export function updateLine(d: DraftBill, index: number, patch: Partial<BillLine>): DraftBill {
  return { ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) };
}

export function removeLine(d: DraftBill, index: number): DraftBill {
  return { ...d, lines: d.lines.filter((_, i) => i !== index) };
}

export function setBillDate(d: DraftBill, billDate: string, paymentDays: number): DraftBill {
  return { ...d, billDate, dueDate: addDays(billDate, paymentDays) };
}

export function draftFromBill(b: Bill): DraftBill {
  return {
    id: b.id, number: b.number, billDate: b.billDate, dueDate: b.dueDate, customerId: b.customerId,
    customer: { ...b.customer }, lines: b.lines.map((l) => ({ ...l })), vatRate: b.vatRate,
  };
}

export function duplicateAsDraft(b: Bill, settings: Settings, today: string): DraftBill {
  return {
    ...draftFromBill(b), id: null, number: null, billDate: today, dueDate: addDays(today, settings.defaultPaymentDays),
  };
}
