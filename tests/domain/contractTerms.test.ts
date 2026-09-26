import { planItems, contractItems, applicableTerms, dueItems, needsBillingReminder, contractSummary, linkedBills } from '../../src/domain/contractTerms';
import type { Bill, BillStatus, Contract } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';

let n = 0;
/** A bill of 10.000.000 + 8% = 10.800.000 linked to a contract item. */
function billFor(itemKey: string | null, status: BillStatus = 'sent', contractId = 'k1'): Bill {
  n++;
  return sampleBill({
    id: `b${n}`, number: `TT-2026-${String(n).padStart(4, '0')}`, status,
    lines: [{ nameVi: 'x', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 10000000, details: [] }],
    contractRef: { contractId, itemKey, number: '12/2026/HĐDV-SM', signedDate: '2026-09-15', parentNumber: null, parentSignedDate: null },
  });
}
const stateOf = (rows: { key: string; state: string }[], key: string) => rows.find((r) => r.key === key)?.state;
const monthly = (first: string, last: string, amount: number) => ({ type: 'periodic' as const, every: 'month' as const, amount, first, last });

describe('instalment states', () => {
  it('waiting, due, billed, paid, and billable again after cancel', () => {
    const k = sampleContract();
    let rows = contractItems(k, [], [], '2026-09-20');
    expect([stateOf(rows, 'i1'), stateOf(rows, 'i2')]).toEqual(['due', 'waiting']);
    const items = (k.plan as Extract<Contract['plan'], { type: 'instalments' }>).items;
    const ready = sampleContract({ plan: { type: 'instalments', items: [items[0], { ...items[1], ready: true, readyOn: '2026-10-01' }] } });
    rows = contractItems(ready, [], [], '2026-10-02');
    expect(rows.find((r) => r.key === 'i2')).toMatchObject({ state: 'due', dueDate: '2026-10-01' });
    const draft = billFor('i1', 'draft');
    rows = contractItems(k, [], [draft], '2026-09-20');
    expect(rows.find((r) => r.key === 'i1')).toMatchObject({ state: 'billed', billId: draft.id, billNumber: draft.number });
    expect(stateOf(contractItems(k, [], [billFor('i1', 'paid')], '2026-09-20'), 'i1')).toBe('paid');
    expect(stateOf(contractItems(k, [], [billFor('i1', 'cancelled')], '2026-09-20'), 'i1')).toBe('due');
  });
  it('dated instalment is notDue before its date', () => {
    const k = sampleContract({ plan: { type: 'instalments', items: [
      { id: 'd', name: 'Đợt 1', share: { percent: 100 }, due: { on: 'date', date: '2026-12-01' }, ready: false, readyOn: null },
    ] } });
    expect(stateOf(contractItems(k, [], [], '2026-11-30'), 'd')).toBe('notDue');
    expect(stateOf(contractItems(k, [], [], '2026-12-01'), 'd')).toBe('due');
  });
  it('instalment amounts and labels', () => {
    const items = planItems(sampleContract());
    expect(items.map((i) => [i.key, i.amount, i.label.vi, i.sourceId])).toEqual([
      ['i1', 10000000, 'Đợt 1 – Tạm ứng', 'k1'], ['i2', 10000000, 'Đợt 2 – Nghiệm thu', 'k1'],
    ]);
  });
});

describe('periods', () => {
  it('first period is due from the contract start', () => {
    const k = sampleContract({ startDate: '2026-10-15', plan: monthly('2026-10', '2026-12', 1000000) });
    expect(planItems(k).map((i) => [i.key, i.dueDate, i.label.vi])).toEqual([
      ['2026-10', '2026-10-15', 'Kỳ tháng 10/2026'], ['2026-11', '2026-11-01', 'Kỳ tháng 11/2026'], ['2026-12', '2026-12-01', 'Kỳ tháng 12/2026'],
    ]);
  });
});

describe('changes terms', () => {
  const k = () => sampleContract({ startDate: '2026-10-01', plan: monthly('2026-10', '2027-03', 1000000) });
  const change = (over: Partial<Contract> = {}) => sampleAddendum({
    id: 'a2', number: 'PL02', effect: 'changesTerms', effectiveDate: '2027-01-01', startDate: '2027-01-01',
    plan: monthly('2027-01', '2027-06', 1200000), ...over,
  });
  it('from an effective date', () => {
    const rows = contractItems(k(), [change()], [], '2027-02-15');
    const fromContract = rows.filter((r) => r.sourceId === 'k1');
    expect(fromContract.filter((r) => r.state === 'superseded').map((r) => r.key)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(rows.filter((r) => r.sourceId === 'a2').map((r) => [r.key, r.amount])).toEqual([
      ['2027-01', 1200000], ['2027-02', 1200000], ['2027-03', 1200000], ['2027-04', 1200000], ['2027-05', 1200000], ['2027-06', 1200000],
    ]);
    expect(applicableTerms(k(), [change()], '2027-02-01').id).toBe('a2');
    expect(applicableTerms(k(), [change()], '2026-12-01').id).toBe('k1');
    expect(applicableTerms(k(), [change({ status: 'draft' })], '2027-02-01').id).toBe('k1');
  });
  it('the latest effective change wins', () => {
    const later = change({ id: 'a3', number: 'PL03', effectiveDate: '2027-03-01' });
    expect(applicableTerms(k(), [change(), later], '2027-04-01').id).toBe('a3');
    expect(applicableTerms(k(), [change(), later], '2027-02-01').id).toBe('a2');
  });
  it('billed items are never superseded', () => {
    const bill = billFor('2027-01', 'sent', 'k1');
    const rows = contractItems(k(), [change()], [bill], '2027-02-15');
    expect(rows.find((r) => r.sourceId === 'k1' && r.key === '2027-01')?.state).toBe('billed');
  });
});

describe('due list, reminder, totals', () => {
  it('adds-work addenda add items; draft or terminated contracts give no due items', () => {
    const add = sampleAddendum({ plan: { type: 'instalments', items: [
      { id: 'x1', name: 'App', share: { percent: 100 }, due: { on: 'signing' }, ready: false, readyOn: null },
    ] } });
    const rows = contractItems(sampleContract(), [add], [], '2026-10-05');
    expect(rows.find((r) => r.key === 'x1')).toMatchObject({ state: 'due', sourceId: 'a1', amount: 5000000 });
    expect(dueItems([sampleContract({ status: 'draft' }), sampleContract({ id: 'k2', status: 'terminated' })], [], '2026-10-05')).toEqual([]);
  });
  it('due items across contracts, sorted by due date', () => {
    const early = sampleContract({ id: 'k2', number: '1/2026/HĐDV', signedDate: '2026-09-01' });
    const due = dueItems([sampleContract(), early], [], '2026-10-05');
    expect(due.map((d) => [d.contract.id, d.key, d.dueDate])).toEqual([['k2', 'i1', '2026-09-01'], ['k1', 'i1', '2026-09-15']]);
  });
  it('reminder after 3 days', () => {
    expect(needsBillingReminder([{ dueDate: '2026-09-15' }], '2026-09-18')).toBe(false);
    expect(needsBillingReminder([{ dueDate: '2026-09-15' }], '2026-09-19')).toBe(true);
    expect(needsBillingReminder([], '2026-09-19')).toBe(false);
  });
  it('summary', () => {
    const add = sampleAddendum(); // 5.000.000 + 8% = 5.400.000
    const bills = [billFor('i1', 'sent'), billFor('i2', 'paid'), billFor(null, 'cancelled'), sampleBill({ id: 'other' })];
    expect(contractSummary(sampleContract(), [add], bills)).toEqual({ value: 21600000, totalValue: 27000000, billed: 21600000, paid: 10800000, left: 16200000 });
    expect(linkedBills(sampleContract(), [add], bills).map((b) => b.id)).toEqual(bills.slice(0, 3).map((b) => b.id));
    const over = [billFor(null, 'paid'), billFor(null, 'paid'), billFor(null, 'paid')];
    expect(contractSummary(sampleContract(), [], over).left).toBe(0);
  });
  it('a changes-terms addendum replaces the superseded part of the value', () => {
    const k = sampleContract({ startDate: '2026-10-01', vatRate: 'none', lines: [{ nameVi: 'Bảo trì', nameEn: '', unitVi: '', unitEn: '', qty: 6, unitPrice: 1000000, details: [] }], plan: monthly('2026-10', '2027-03', 1000000) });
    const ch = sampleAddendum({ id: 'a2', effect: 'changesTerms', effectiveDate: '2027-01-01', startDate: '2027-01-01', vatRate: 'none', plan: monthly('2027-01', '2027-06', 1200000) });
    // 6.000.000 − 3 superseded × 1.000.000 + 6 × 1.200.000 = 10.200.000
    expect(contractSummary(k, [ch], []).totalValue).toBe(10200000);
  });
});
