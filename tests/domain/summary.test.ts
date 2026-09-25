import { homeSummary } from '../../src/domain/summary';
import { sampleBill } from '../fixtures';

describe('homeSummary', () => {
  it('sums unpaid, overdue and paid-this-month using bill totals', () => {
    const bills = [
      sampleBill({ id: '1', status: 'sent', dueDate: '2026-10-05' }), // 5.400.000 incl. 8% VAT, not overdue
      sampleBill({ id: '2', status: 'sent', dueDate: '2026-09-11' }), // overdue
      sampleBill({ id: '3', status: 'paid', paidDate: '2026-09-02' }),
      sampleBill({ id: '4', status: 'paid', paidDate: '2026-08-30' }), // last month
      sampleBill({ id: '5', status: 'draft' }),
      sampleBill({ id: '6', status: 'cancelled' }),
    ];
    const s = homeSummary(bills, '2026-09-25');
    expect(s.unpaid).toEqual({ amount: 10800000, count: 2 });
    expect(s.overdue).toEqual({ amount: 5400000, count: 1 });
    expect(s.paidThisMonth).toEqual({ amount: 5400000, count: 1 });
  });
});
