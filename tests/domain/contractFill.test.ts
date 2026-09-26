import { contractRefFor, fillFromContract, referenceLine } from '../../src/domain/contractFill';
import { planItems } from '../../src/domain/contractTerms';
import { newDraft } from '../../src/domain/draft';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleContract, sampleAddendum } from '../contractFixtures';

const draft = () => newDraft(DEFAULT_SETTINGS, '2026-09-26');
const monthly = (amount: number) => ({ type: 'periodic' as const, every: 'month' as const, amount, first: '2026-10', last: '2026-12' });

describe('fillFromContract', () => {
  it('instalment fill', () => {
    const k = sampleContract();
    const item = planItems(k)[0];
    const d = fillFromContract(draft(), k, { record: k, parent: null, item });
    expect(d.lines).toEqual([{ nameVi: 'Đợt 1 – Tạm ứng – 50% giá trị hợp đồng', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 10000000, details: ['Website'] }]);
    expect([d.vatRate, d.dueDate, d.customerId, d.customer.name, d.contractRef?.itemKey]).toEqual([8, '2026-10-06', 'c1', 'Công ty CP Hoa Sen Xanh', 'i1']);
    const byAmount = sampleContract({ plan: { type: 'instalments', items: [{ id: 'x', name: 'Đợt 1', share: { amount: 20000000 }, due: { on: 'signing' }, ready: false, readyOn: null }] } });
    expect(fillFromContract(draft(), byAmount, { record: byAmount, parent: null, item: planItems(byAmount)[0] }).lines[0].nameVi).toBe('Đợt 1');
  });
  it('period fill uses the contract lines when the amount matches', () => {
    const k = sampleContract({ plan: monthly(20000000) });
    const d = fillFromContract(draft(), k, { record: k, parent: null, item: planItems(k)[0] });
    expect(d.lines).toEqual([{ ...k.lines[0], details: ['Kỳ tháng 10/2026 / Period 10/2026'] }]);
    expect(d.contractRef?.itemKey).toBe('2026-10');
  });
  it('period fill with a different amount uses one line', () => {
    const k = sampleContract({ plan: monthly(800000) });
    const d = fillFromContract(draft(), k, { record: k, parent: null, item: planItems(k)[1] });
    expect(d.lines).toEqual([{ nameVi: 'Hợp đồng thiết kế website', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 800000, details: ['Kỳ tháng 11/2026 / Period 11/2026'] }]);
  });
  it('per use and Other', () => {
    const k = sampleContract({ lines: [{ nameVi: 'Giờ tư vấn', nameEn: 'Consulting hour', unitVi: 'giờ', unitEn: 'hour', qty: 10, unitPrice: 500000, details: [] }], plan: { type: 'perUse' } });
    const d = fillFromContract(draft(), k, { record: k, parent: null, item: null });
    expect(d.lines).toEqual([{ ...k.lines[0], qty: 1 }]);
    expect(d.contractRef?.itemKey).toBeNull();
  });
  it('addendum uses the parent customer and records both numbers', () => {
    const parent = sampleContract();
    const add = sampleAddendum({ customer: { ...parent.customer, name: 'ignored' } });
    const d = fillFromContract(draft(), add, { record: add, parent, item: null });
    expect(d.customer.name).toBe('Công ty CP Hoa Sen Xanh');
    expect(contractRefFor(add, parent, null)).toEqual({
      contractId: 'a1', itemKey: null, number: 'PL01', signedDate: '2026-10-01', parentNumber: '12/2026/HĐDV-SM', parentSignedDate: '2026-09-15',
    });
  });
});

describe('referenceLine', () => {
  it('for a contract and for an addendum', () => {
    const parent = sampleContract();
    expect(referenceLine(contractRefFor(parent, null, null))).toEqual({
      vi: 'Căn cứ Hợp đồng số 12/2026/HĐDV-SM ký ngày 15/09/2026', en: 'Under Contract No. 12/2026/HĐDV-SM dated 15/09/2026',
    });
    expect(referenceLine(contractRefFor(sampleAddendum(), parent, null))).toEqual({
      vi: 'Căn cứ Hợp đồng số 12/2026/HĐDV-SM ký ngày 15/09/2026 và Phụ lục số 01 ký ngày 01/10/2026',
      en: 'Under Contract No. 12/2026/HĐDV-SM dated 15/09/2026 and Addendum No. 01 dated 01/10/2026',
    });
  });
});
