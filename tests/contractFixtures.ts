import type { Contract } from '../src/domain/types';
import { sampleBill } from './fixtures';

/** An active contract: website 20.000.000 + 8% VAT, two 50% instalments (on signing, on acceptance). */
export const sampleContract = (over: Partial<Contract> = {}): Contract => ({
  id: 'k1', kind: 'contract', parentId: null, effect: null, effectiveDate: null,
  number: '12/2026/HĐDV-SM', title: 'Hợp đồng thiết kế website', status: 'active',
  signedDate: '2026-09-15', startDate: '2026-09-15', endDate: '2027-09-14',
  customerId: 'c1', customer: { ...sampleBill().customer }, business: null,
  lines: [{ nameVi: 'Website', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 20000000, details: [] }],
  vatRate: 8,
  plan: {
    type: 'instalments',
    items: [
      { id: 'i1', name: 'Đợt 1 – Tạm ứng', share: { percent: 50 }, due: { on: 'signing' }, ready: false, readyOn: null },
      { id: 'i2', name: 'Đợt 2 – Nghiệm thu', share: { percent: 50 }, due: { on: 'acceptance' }, ready: false, readyOn: null },
    ],
  },
  paymentTerms: '', paymentDays: 10,
  createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
  ...over,
});

/** An active "adds work" addendum PL01 of k1, pay per use. */
export const sampleAddendum = (over: Partial<Contract> = {}): Contract => sampleContract({
  id: 'a1', kind: 'addendum', parentId: 'k1', effect: 'addsWork', number: 'PL01', title: 'Phụ lục 01',
  signedDate: '2026-10-01', startDate: '2026-10-01', plan: { type: 'perUse' },
  lines: [{ nameVi: 'Ứng dụng di động', nameEn: 'Mobile app', unitVi: '', unitEn: '', qty: 1, unitPrice: 5000000, details: [] }],
  ...over,
});
