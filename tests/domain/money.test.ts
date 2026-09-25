import { computeTotals } from '../../src/domain/money';
import type { BillLine } from '../../src/domain/types';

const line = (qty: number, unitPrice: number): BillLine => ({
  nameVi: 'x', nameEn: 'x', unitVi: '', unitEn: '', qty, unitPrice,
});

describe('computeTotals', () => {
  it('matches the spec example with 8% VAT', () => {
    const t = computeTotals([line(1, 5000000), line(1, 12000000), line(3, 800000)], 8);
    expect(t.lineAmounts).toEqual([5000000, 12000000, 2400000]);
    expect(t.subtotal).toBe(19400000);
    expect(t.vat).toBe(1552000);
    expect(t.total).toBe(20952000);
    expect(t.vatApplies).toBe(true);
  });
  it('rounds VAT half up to the nearest dong', () => {
    expect(computeTotals([line(1, 12345)], 5).vat).toBe(617); // 617.25
    expect(computeTotals([line(1, 30)], 5).vat).toBe(2); // 1.5
  });
  it('has no VAT when not applicable', () => {
    const t = computeTotals([line(2, 1000)], 'none');
    expect(t.vat).toBe(0);
    expect(t.total).toBe(2000);
    expect(t.vatApplies).toBe(false);
  });
  it('treats 0% as applicable (row printed) with zero VAT', () => {
    const t = computeTotals([line(2, 1000)], 0);
    expect(t.vat).toBe(0);
    expect(t.vatApplies).toBe(true);
  });
  it('handles no lines', () => {
    expect(computeTotals([], 10).total).toBe(0);
  });
});
