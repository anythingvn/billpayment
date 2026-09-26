import { buildReport, reportPresets, reportFileName, periodName } from '../../src/domain/report';
import { DEFAULT_SETTINGS, type Bill, type VatRate } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const s = { ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH SAO MAI', taxId: '0312345678' };
const line = (unitPrice = 1000000) => ({ nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice, details: [] });
let n = 0;
const bill = (over: Partial<Bill>): Bill => {
  n++;
  return sampleBill({ id: `b${n}`, number: `TT-2026-${String(n).padStart(4, '0')}`, status: 'sent', lines: [line()], ...over });
};
const paid = (paidDate: string, over: Partial<Bill> = {}) => bill({ status: 'paid', billDate: '2026-09-01', paidDate, ...over });
const report = (bills: Bill[], from = '2026-09-01', to = '2026-09-30') => buildReport(bills, from, to, s, '2026-10-02');
const numbers = (list: { number: string }[]) => list.map((b) => b.number);

describe('buildReport', () => {
  it('edges are inclusive', () => {
    const a = paid('2026-09-01'), b = paid('2026-09-30'), c = paid('2026-10-01');
    const r = report([a, b, c]);
    expect(numbers(r.paid)).toEqual([a.number, b.number]);
    expect(numbers(r.owedBills)).toEqual([c.number]);
  });

  it('paid in the period but issued earlier', () => {
    const b = paid('2026-09-05', { billDate: '2026-08-20' });
    const r = report([b]);
    expect(numbers(r.paid)).toEqual([b.number]);
    expect(r.billedBills).toEqual([]);
  });

  it('drafts and cancelled never count', () => {
    const r = report([
      bill({ status: 'draft', billDate: '2026-09-10' }),
      bill({ status: 'cancelled', billDate: '2026-09-10', paidDate: '2026-09-12' }),
    ]);
    expect([r.paid, r.billedBills, r.owedBills]).toEqual([[], [], []]);
    expect([r.received, r.billed, r.owed]).toEqual([0, { count: 0, total: 0 }, { count: 0, total: 0 }]);
  });

  it('one VAT row per rate, No VAT separate from 0%', () => {
    const rates: VatRate[] = ['none', 0, 8, 8];
    const r = report(rates.map((vatRate) => paid('2026-09-10', { vatRate })));
    expect(r.vat).toEqual([
      { rate: 'none', count: 1, beforeVat: 1000000, vat: 0, total: 1000000 },
      { rate: 0, count: 1, beforeVat: 1000000, vat: 0, total: 1000000 },
      { rate: 8, count: 2, beforeVat: 2000000, vat: 160000, total: 2160000 },
    ]);
    expect(r.vatTotal).toEqual({ count: 4, beforeVat: 4000000, vat: 160000, total: 4160000 });
    expect(r.received).toBe(4160000);
  });

  it('owed at end and days overdue', () => {
    const late = bill({ billDate: '2026-09-10', dueDate: '2026-09-20' });
    const notDue = bill({ billDate: '2026-09-25', dueDate: '2026-10-05' });
    const paidLater = paid('2026-10-02', { billDate: '2026-09-15', dueDate: '2026-09-25' });
    const r = report([late, notDue, paidLater]);
    expect(r.owedBills.map((b) => [b.number, b.daysOverdue])).toEqual([[late.number, 10], [paidLater.number, 5], [notDue.number, 0]]);
    expect(r.owed).toEqual({ count: 3, total: 3 * 1080000 });
    expect(r.billed).toEqual({ count: 3, total: 3 * 1080000 });
  });

  it('days overdue stop at today when the period has not ended', () => {
    const late = bill({ billDate: '2026-09-10', dueDate: '2026-09-20' });
    const r = buildReport([late], '2026-01-01', '2026-12-31', s, '2026-09-26');
    expect(r.owedBills.map((b) => b.daysOverdue)).toEqual([6]);
    const due = bill({ billDate: '2026-09-25', dueDate: '2026-10-05' });
    expect(buildReport([due], '2026-09-01', '2026-12-31', s, '2026-09-26').owedBills[0].daysOverdue).toBe(0);
  });
  it('undone payment counts as owed', () => {
    const b = bill({ status: 'sent', paidDate: null, billDate: '2026-09-05' });
    expect(numbers(report([b]).owedBills)).toEqual([b.number]);
  });

  it('contract column', () => {
    const ref = { contractId: 'k', itemKey: null, number: '12/2026/HĐDV-SM', signedDate: '2026-09-15', parentNumber: null, parentSignedDate: null };
    const r = report([
      paid('2026-09-10', { contractRef: ref }),
      paid('2026-09-11', { contractRef: { ...ref, number: 'PL01', parentNumber: '12/2026/HĐDV-SM', parentSignedDate: '2026-09-15' } }),
      paid('2026-09-12'),
    ]);
    expect(r.paid.map((b) => b.contract)).toEqual(['12/2026/HĐDV-SM', 'PL01 · 12/2026/HĐDV-SM', '']);
  });

  it('rows carry the bill details', () => {
    const b = paid('2026-09-05', { billDate: '2026-08-28', customer: { ...sampleBill().customer, taxId: '0109876543' } });
    expect(report([b]).paid[0]).toEqual({
      number: b.number, billDate: '2026-08-28', dueDate: b.dueDate, paidDate: '2026-09-05',
      customer: 'Công ty CP Hoa Sen Xanh', customerTaxId: '0109876543', contract: '', status: 'paid',
      vatRate: 8, beforeVat: 1000000, vat: 80000, total: 1080000, daysOverdue: 0,
    });
  });

  it('sorting', () => {
    const b1 = paid('2026-09-20', { billDate: '2026-09-02', dueDate: '2026-09-12' });
    const b2 = paid('2026-09-10', { billDate: '2026-09-05', dueDate: '2026-09-15' });
    const b3 = bill({ billDate: '2026-09-01', dueDate: '2026-09-25' });
    const r = report([b1, b2, b3]);
    expect(numbers(r.paid)).toEqual([b2.number, b1.number]);
    expect(numbers(r.billedBills)).toEqual([b3.number, b1.number, b2.number]);
  });

  it('heading details', () => {
    const r = report([]);
    expect([r.from, r.to, r.madeOn, r.business]).toEqual(['2026-09-01', '2026-09-30', '2026-10-02', { name: 'CÔNG TY TNHH SAO MAI', taxId: '0312345678' }]);
    expect(r.vat).toEqual([]);
    expect(r.vatTotal).toEqual({ count: 0, beforeVat: 0, vat: 0, total: 0 });
  });
});

describe('reportPresets', () => {
  const range = (today: string) => Object.fromEntries(reportPresets(today).map((p) => [p.key, [p.from, p.to]]));
  it('presets across a year', () => {
    expect(range('2026-01-15')).toEqual({
      thisMonth: ['2026-01-01', '2026-01-31'], lastMonth: ['2025-12-01', '2025-12-31'],
      thisQuarter: ['2026-01-01', '2026-03-31'], lastQuarter: ['2025-10-01', '2025-12-31'], thisYear: ['2026-01-01', '2026-12-31'],
    });
    expect(range('2026-03-10').thisMonth).toEqual(['2026-03-01', '2026-03-31']);
    expect(range('2028-03-10').lastMonth).toEqual(['2028-02-01', '2028-02-29']);
    expect(reportPresets('2026-03-10').map((p) => p.label)).toEqual(['This month', 'Last month', 'This quarter', 'Last quarter', 'This year']);
  });
});

describe('reportFileName', () => {
  it('file names', () => {
    expect(reportFileName('2026-09-01', '2026-09-30')).toBe('Báo cáo 2026-09.xlsx');
    expect(reportFileName('2026-07-01', '2026-09-30')).toBe('Báo cáo 2026-Q3.xlsx');
    expect(reportFileName('2026-01-01', '2026-12-31')).toBe('Báo cáo 2026.xlsx');
    expect(reportFileName('2026-09-01', '2026-10-15')).toBe('Báo cáo 2026-09-01 – 2026-10-15.xlsx');
    expect(reportFileName('2026-02-01', '2026-02-28')).toBe('Báo cáo 2026-02.xlsx');
    expect(reportFileName('2026-09-02', '2026-09-30')).toBe('Báo cáo 2026-09-02 – 2026-09-30.xlsx');
  });
});

describe('periodName', () => {
  it('names a period', () => {
    expect(periodName('2026-09-01', '2026-09-30')).toBe('2026-09');
    expect(periodName('2026-07-01', '2026-09-30')).toBe('2026-Q3');
    expect(periodName('2026-01-01', '2026-12-31')).toBe('2026');
    expect(periodName('2026-01-01', '2026-09-26')).toBe('2026-01-01 – 2026-09-26');
  });
});
