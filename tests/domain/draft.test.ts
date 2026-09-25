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
    expect(d1.lines[0]).toEqual({ nameVi: 'Bảo trì website', nameEn: 'Website maintenance', unitVi: 'tháng', unitEn: 'month', qty: 1, unitPrice: 800000 });
    const d2 = updateLine(addCustomLine(d1), 0, { qty: 3 });
    expect(d2.lines[0].qty).toBe(3);
    expect(d2.lines[1].nameVi).toBe('');
    expect(removeLine(d2, 0).lines).toHaveLength(1);
  });
  it('moves the due date with the bill date', () => {
    expect(setBillDate(newDraft(DEFAULT_SETTINGS, '2026-09-25'), '2026-12-28', 10).dueDate).toBe('2027-01-07');
  });
  it('round-trips a stored bill and duplicates as a fresh draft', () => {
    const b = sampleBill({ status: 'sent' });
    expect(draftFromBill(b)).toMatchObject({ id: 'b1', number: 'TT-2026-0012', lines: b.lines });
    const dup = duplicateAsDraft(b, DEFAULT_SETTINGS, '2026-11-01');
    expect(dup).toMatchObject({ id: null, number: null, billDate: '2026-11-01', dueDate: '2026-11-11', customerId: 'c1', lines: b.lines });
    expect(dup.lines).not.toBe(b.lines);
  });
});
