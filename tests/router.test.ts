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
    ['#/nonsense', { name: 'home' }],
  ])('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
  it('round-trips', () => {
    expect(parseRoute(routeToHash({ name: 'editBill', id: 'x1' }))).toEqual({ name: 'editBill', id: 'x1' });
  });
});
