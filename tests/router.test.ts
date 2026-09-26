import { parseRoute, routeToHash } from '../src/router';

describe('router', () => {
  it.each([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/bills/new', { name: 'newBill' }],
    ['#/bills/abc', { name: 'bill', id: 'abc' }],
    ['#/bills/abc/edit', { name: 'editBill', id: 'abc' }],
    ['#/bills/abc/duplicate', { name: 'duplicateBill', id: 'abc' }],
    ['#/customers', { name: 'customers' }],
    ['#/services', { name: 'services' }],
    ['#/settings', { name: 'settings' }],
    ['#/backup', { name: 'backup' }],
    ['#/contracts', { name: 'contracts' }],
    ['#/contracts/new', { name: 'newContract' }],
    ['#/contracts/k1', { name: 'contract', id: 'k1' }],
    ['#/contracts/k1/edit', { name: 'editContract', id: 'k1' }],
    ['#/contracts/k1/addendum', { name: 'newAddendum', parentId: 'k1' }],
    ['#/bills/new/contract/k1', { name: 'newBillFromContract', contractId: 'k1', itemKey: null }],
    ['#/bills/new/contract/k1/2026-10', { name: 'newBillFromContract', contractId: 'k1', itemKey: '2026-10' }],
    ['#/nonsense', { name: 'home' }],
  ])('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
  it('round-trips', () => {
    expect(parseRoute(routeToHash({ name: 'editBill', id: 'x1' }))).toEqual({ name: 'editBill', id: 'x1' });
  });
});

describe('contract routes', () => {
  it('round-trip', () => {
    for (const r of [
      { name: 'newAddendum', parentId: 'k1' }, { name: 'editContract', id: 'k1' },
      { name: 'newBillFromContract', contractId: 'k1', itemKey: 'i1' }, { name: 'newBillFromContract', contractId: 'k1', itemKey: null },
    ] as const) expect(parseRoute(routeToHash(r))).toEqual(r);
  });
});
