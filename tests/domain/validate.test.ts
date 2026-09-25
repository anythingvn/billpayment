import { exportBlockers, lineErrors, dateErrors } from '../../src/domain/validate';
import { newDraft, setCustomer, addCustomLine, updateLine } from '../../src/domain/draft';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/types';

const filledSettings: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'Sao Mai',
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
};
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };

describe('lineErrors', () => {
  it('requires a name, qty ≥ 1 and an integer price ≥ 0', () => {
    const ok = { nameVi: 'A', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 0, details: [] };
    expect(lineErrors(ok)).toEqual([]);
    expect(lineErrors({ ...ok, nameVi: '  ' })).toContain('Service name is required');
    expect(lineErrors({ ...ok, qty: 0 })).toContain('Quantity must be a whole number of at least 1');
    expect(lineErrors({ ...ok, qty: 1.5 })).toContain('Quantity must be a whole number of at least 1');
    expect(lineErrors({ ...ok, unitPrice: -1 })).toContain('Unit price must be a whole number of at least 0');
  });
});

describe('dateErrors', () => {
  it('rejects a due date before the bill date', () => {
    expect(dateErrors('2026-09-25', '2026-09-25')).toEqual([]);
    expect(dateErrors('2026-09-25', '2026-09-24')).toEqual(['Due date cannot be before the bill date']);
  });
});

describe('exportBlockers', () => {
  it('lists what is missing and where to fix it', () => {
    const d = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    expect(exportBlockers(d, DEFAULT_SETTINGS).map((b) => b.target)).toEqual([
      'customer', 'services', 'settings', 'settings',
    ]);
  });
  it('is empty for a complete draft', () => {
    let d = setCustomer(newDraft(filledSettings, '2026-09-25'), customer);
    d = updateLine(addCustomLine(d), 0, { nameVi: 'Thiết kế', qty: 1, unitPrice: 100, details: [] });
    expect(exportBlockers(d, filledSettings)).toEqual([]);
  });
  it('blocks on invalid lines and dates', () => {
    let d = setCustomer(newDraft(filledSettings, '2026-09-25'), customer);
    d = addCustomLine(d); // empty name
    d = { ...d, dueDate: '2026-09-01' };
    const msgs = exportBlockers(d, filledSettings).map((b) => b.message);
    expect(msgs).toContain('Line 1: Service name is required');
    expect(msgs).toContain('Due date cannot be before the bill date');
  });
});

describe('review fixes: numbers and account', () => {
  it('draftSaveErrors rejects non-numeric qty/price but allows an incomplete draft', async () => {
    const { draftSaveErrors } = await import('../../src/domain/validate');
    const base = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    expect(draftSaveErrors(base)).toEqual([]);
    const bad = updateLine(updateLine(addCustomLine(addCustomLine(base)), 0, { qty: NaN }), 1, { unitPrice: NaN });
    expect(draftSaveErrors(bad)).toEqual([
      'Line 1: Quantity must be a whole number of at least 1',
      'Line 2: Unit price must be a whole number of at least 0',
    ]);
  });
  it('accepts an account typed with dashes but blocks one with letters', () => {
    let d = setCustomer(newDraft(filledSettings, '2026-09-25'), customer);
    d = updateLine(addCustomLine(d), 0, { nameVi: 'A', qty: 1, unitPrice: 100, details: [] });
    const acc = (accountNumber: string) => ({ ...d, bankAccount: { bankBin: '970436', accountNumber, accountHolder: '' } });
    expect(exportBlockers(acc('0071-0001-23456'), filledSettings)).toEqual([]);
    expect(exportBlockers(acc('0071abc'), filledSettings).map((b) => b.message)).toEqual([
      'Account number must contain only digits (check Settings)',
    ]);
  });
});

describe('export checks use the bill account', () => {
  it("blocks when the bill's own account number is invalid, even if Settings is fine", () => {
    let d = setCustomer(newDraft(filledSettings, '2026-09-25'), customer);
    d = updateLine(addCustomLine(d), 0, { nameVi: 'A', qty: 1, unitPrice: 100 });
    expect(exportBlockers({ ...d, bankAccount: { bankBin: '970436', accountNumber: 'x1', accountHolder: '' } }, filledSettings).map((b) => b.message))
      .toEqual(['Account number must contain only digits (check Settings)']);
  });
  it('asks for a bank account when there is none', () => {
    let d = setCustomer(newDraft({ ...filledSettings, bankAccounts: [], defaultBankAccountId: '' }, '2026-09-25'), customer);
    d = updateLine(addCustomLine(d), 0, { nameVi: 'A', qty: 1, unitPrice: 100 });
    expect(exportBlockers(d, { ...filledSettings, bankAccounts: [], defaultBankAccountId: '' }).map((b) => b.message))
      .toEqual(['Add a bank account in Settings']);
  });
});
