import {
  valueBeforeVat, contractValue, instalmentAmounts, periodKeys, periodLabel, planErrors, nextAddendumNumber, isDuplicateNumber,
} from '../../src/domain/contractPlan';
import type { Instalment } from '../../src/domain/types';
import { sampleContract, sampleAddendum } from '../contractFixtures';

const inst = (share: Instalment['share'], id = Math.random().toString()): Instalment =>
  ({ id, name: id, share, due: { on: 'signing' }, ready: false, readyOn: null });

describe('contract values', () => {
  it('values', () => {
    expect(valueBeforeVat(sampleContract())).toBe(20000000);
    expect(contractValue(sampleContract())).toBe(21600000);
  });
});

describe('instalment amounts', () => {
  it('percent instalments', () => {
    expect(instalmentAmounts([inst({ percent: 50 }), inst({ percent: 50 })], 20000000)).toEqual([10000000, 10000000]);
  });
  it('rounding difference goes to the last instalment', () => {
    const a = instalmentAmounts([inst({ percent: 33.33 }), inst({ percent: 33.33 }), inst({ percent: 33.34 })], 10000001);
    expect(a).toEqual([3333000, 3333000, 3334001]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(10000001);
  });
  it('amount and mixed shares', () => {
    expect(instalmentAmounts([inst({ amount: 5000000 }), inst({ percent: 75 })], 20000000)).toEqual([5000000, 15000000]);
  });
});

describe('periods', () => {
  it('monthly and quarterly periods', () => {
    expect(periodKeys({ type: 'periodic', every: 'month', amount: 1, first: '2026-10', last: '2027-01' })).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(periodKeys({ type: 'periodic', every: 'quarter', amount: 1, first: '2026-10', last: '2027-06' })).toEqual(['2026-10', '2027-01', '2027-04']);
  });
  it('period labels', () => {
    expect(periodLabel('2026-10', 'month')).toEqual({ vi: 'Kỳ tháng 10/2026', en: 'Period 10/2026' });
    expect(periodLabel('2026-10', 'quarter')).toEqual({ vi: 'Quý 4/2026', en: 'Quarter 4/2026' });
  });
});

describe('planErrors', () => {
  const withItems = (items: Instalment[]) => sampleContract({ plan: { type: 'instalments', items } });
  it('accepts a balanced plan', () => {
    expect(planErrors(sampleContract())).toEqual([]);
  });
  it('percent and amount totals', () => {
    expect(planErrors(withItems([inst({ percent: 50 }), inst({ percent: 40 })]))).toContain('Instalments add up to 90%, not 100%');
    expect(planErrors(withItems([inst({ amount: 10000000 }), inst({ amount: 9000000 })]))).toContain('Instalments add up to 19.000.000 ₫, not 20.000.000 ₫');
  });
  it('periods and dates', () => {
    expect(planErrors(sampleContract({ plan: { type: 'periodic', every: 'month', amount: 1, first: '2027-01', last: '2026-12' } })))
      .toContain('The first period is after the last one');
    expect(planErrors(sampleContract({ startDate: '2026-10-01', endDate: '2026-09-01' }))).toContain('The end date is before the start date');
  });
  it('effective date outside the parent', () => {
    const add = sampleAddendum({ effect: 'changesTerms', effectiveDate: '2028-01-01' });
    expect(planErrors(add, sampleContract())).toContain("The effective date is outside the contract's dates");
    expect(planErrors({ ...add, effectiveDate: '2027-01-01' }, sampleContract())).toEqual([]);
    expect(planErrors({ ...add, effectiveDate: null }, sampleContract())).toContain('Choose the date the new terms apply from');
  });
});

describe('numbers', () => {
  it('addendum numbers', () => {
    expect(nextAddendumNumber([])).toBe('PL01');
    expect(nextAddendumNumber([{ number: 'PL01' }, { number: 'PL02' }])).toBe('PL03');
    expect(nextAddendumNumber([{ number: 'PL01' }, { number: 'custom' }])).toBe('PL02');
  });
  it('duplicate numbers', () => {
    const all = [{ id: 'k1', number: '12/2026/HĐDV-SM' }];
    expect(isDuplicateNumber(all, ' 12/2026/hđdv-sm ', null)).toBe(true);
    expect(isDuplicateNumber(all, '12/2026/HĐDV-SM', 'k1')).toBe(false);
    expect(isDuplicateNumber(all, '13/2026/HĐDV-SM', null)).toBe(false);
  });
});
