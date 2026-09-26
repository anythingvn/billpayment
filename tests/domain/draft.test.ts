import {
  newDraft, setCustomer, addServiceLine, addCustomLine, updateLine, removeLine, setBillDate, draftFromBill, duplicateAsDraft,
} from '../../src/domain/draft';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const service = { id: 's1', nameVi: 'Bảo trì website', nameEn: 'Website maintenance', unitVi: 'tháng', unitEn: 'month', unitPrice: 800000, archived: false };
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: '', email: '', phone: '', archived: false };

describe('draft helpers', () => {
  it('starts with settings defaults', () => {
    const d = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    expect(d).toMatchObject({ id: null, number: null, billDate: '2026-09-25', dueDate: '2026-10-05', vatRate: 8, lines: [], customerId: '' });
  });
  it('copies a customer snapshot without id or archived flag', () => {
    const d = setCustomer(newDraft(DEFAULT_SETTINGS, '2026-09-25'), customer);
    expect(d.customerId).toBe('c1');
    expect(d.customer).toEqual({ name: 'Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: '', email: '', phone: '' });
  });
  it('adds, updates and removes lines immutably', () => {
    const d0 = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    const d1 = addServiceLine(d0, service);
    expect(d0.lines).toHaveLength(0);
    expect(d1.lines[0]).toEqual({ nameVi: 'Bảo trì website', nameEn: 'Website maintenance', unitVi: 'tháng', unitEn: 'month', qty: 1, unitPrice: 800000, details: [] });
    const d2 = updateLine(addCustomLine(d1), 0, { qty: 3 });
    expect(d2.lines[0].qty).toBe(3);
    expect(d2.lines[1].nameVi).toBe('');
    expect(removeLine(d2, 0).lines).toHaveLength(1);
  });
  it('moves the due date with the bill date', () => {
    expect(setBillDate(newDraft(DEFAULT_SETTINGS, '2026-09-25'), '2026-12-28').dueDate).toBe('2027-01-07');
  });
  it('round-trips a stored bill and duplicates as a fresh draft', () => {
    const b = sampleBill({ status: 'sent' });
    expect(draftFromBill(b)).toMatchObject({ id: 'b1', number: 'TT-2026-0012', lines: b.lines });
    const dup = duplicateAsDraft(b, DEFAULT_SETTINGS, '2026-11-01');
    expect(dup).toMatchObject({ id: null, number: null, billDate: '2026-11-01', dueDate: '2026-11-11', customerId: 'c1', lines: b.lines });
    expect(dup.lines).not.toBe(b.lines);
  });
});

describe('service detail lines', () => {
  it('starts new lines with no details', () => {
    const d = addCustomLine(addServiceLine(newDraft(DEFAULT_SETTINGS, '2026-09-25'), service));
    expect(d.lines.map((l) => l.details)).toEqual([[], []]);
  });
  it('splits the details box into raw lines while typing (keeps blanks so Enter works)', async () => {
    const { splitDetails } = await import('../../src/domain/draft');
    expect(splitDetails('Trang chủ\n')).toEqual(['Trang chủ', '']);
    expect(splitDetails('')).toEqual([]);
  });
  it('cleans details when saving: trims and drops blank lines', async () => {
    const { cleanDraft } = await import('../../src/domain/draft');
    const d = updateLine(addCustomLine(newDraft(DEFAULT_SETTINGS, '2026-09-25')), 0, { details: ['  Trang chủ / Home ', '', '   ', 'Tên miền 1 năm'] });
    expect(cleanDraft(d).lines[0].details).toEqual(['Trang chủ / Home', 'Tên miền 1 năm']);
  });
  it('copies details when opening or duplicating a bill, and treats old lines without details as empty', () => {
    const b = sampleBill({ lines: [{ ...sampleBill().lines[0], details: ['A', 'B'] }] });
    const dup = duplicateAsDraft(b, DEFAULT_SETTINGS, '2026-11-01');
    expect(dup.lines[0].details).toEqual(['A', 'B']);
    expect(dup.lines[0].details).not.toBe(b.lines[0].details);
    const { details: _omit, ...oldLine } = sampleBill().lines[0];
    const old = sampleBill({ lines: [oldLine as never] });
    expect(draftFromBill(old).lines[0].details).toEqual([]);
  });
});

describe('per-bill VAT and footer note', () => {
  it('starts a new bill with the default VAT and default footer note', () => {
    const s = { ...DEFAULT_SETTINGS, defaultVatRate: 10 as const, footerNotes: ['A', 'B'], defaultFooterIndex: 1 };
    expect(newDraft(s, '2026-09-26')).toMatchObject({ vatRate: 10, footerNote: 'B' });
    expect(newDraft({ ...s, defaultFooterIndex: -1 }, '2026-09-26').footerNote).toBe('');
  });
  it('keeps the footer note when opening or duplicating a bill', () => {
    const b = sampleBill({ footerNote: 'Giá đã gồm VAT / Price includes VAT' });
    expect(draftFromBill(b).footerNote).toBe('Giá đã gồm VAT / Price includes VAT');
    expect(duplicateAsDraft(b, DEFAULT_SETTINGS, '2026-11-01').footerNote).toBe('Giá đã gồm VAT / Price includes VAT');
  });
});

describe('bank account per bill', () => {
  const s = {
    ...DEFAULT_SETTINGS,
    bankAccounts: [
      { id: 'a1', bankBin: '970436', accountNumber: '111', accountHolder: 'A' },
      { id: 'a2', bankBin: '970422', accountNumber: '222', accountHolder: 'B' },
    ],
    defaultBankAccountId: 'a2',
  };
  it('starts a new bill with a copy of the default account', () => {
    expect(newDraft(s, '2026-09-26').bankAccount).toEqual({ bankBin: '970422', accountNumber: '222', accountHolder: 'B' });
    expect(newDraft({ ...s, bankAccounts: [], defaultBankAccountId: '' }, '2026-09-26').bankAccount).toBeUndefined();
  });
  it('keeps the account when opening or duplicating a bill', () => {
    const b = sampleBill({ bankAccount: { bankBin: '970436', accountNumber: '111', accountHolder: 'A' } });
    expect(draftFromBill(b).bankAccount).toEqual(b.bankAccount);
    expect(duplicateAsDraft(b, s, '2026-11-01').bankAccount).toEqual(b.bankAccount);
  });
});

describe('deferred fixes: drafts', () => {
  it('keeps a custom gap between bill date and due date when the bill date changes', () => {
    const d = { ...newDraft(DEFAULT_SETTINGS, '2026-09-25'), dueDate: '2026-10-15' }; // 20 days
    expect(setBillDate(d, '2026-10-01').dueDate).toBe('2026-10-21');
  });
  it("a duplicate uses the current business details, not the old bill's copy", () => {
    const b = sampleBill({ status: 'sent', business: { businessName: 'Old name', taxId: '', address: '', phone: '', email: '', logoDataUrl: null, preparedBy: '' } });
    expect(draftFromBill(b).business?.businessName).toBe('Old name');
    expect(duplicateAsDraft(b, DEFAULT_SETTINGS, '2026-11-01').business).toBeUndefined();
  });
});
