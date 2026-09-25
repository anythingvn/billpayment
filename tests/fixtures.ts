import type { Bill } from '../src/domain/types';

export const sampleBill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1', number: 'TT-2026-0012', status: 'draft', billDate: '2026-09-25', dueDate: '2026-10-05',
  paidDate: null, customerId: 'c1',
  customer: { name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '' },
  lines: [{ nameVi: 'Thiết kế logo', nameEn: 'Logo design', unitVi: '', unitEn: '', qty: 1, unitPrice: 5000000 }],
  vatRate: 8, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', ...over,
});
