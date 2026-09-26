import { can, actionsFor, ACTIONS, type Action } from '../../src/domain/permissions';
import { ROLES } from '../../src/storage/roles';
import { sampleBill } from '../fixtures';
import { sampleContract } from '../contractFixtures';

const TABLE: Record<Action, string> = { // roles allowed: a=admin m=manager c=creator t=accountant
  'record.edit': 'amc', 'bill.send': 'amc', 'bill.pay': 'amt', 'bill.cancel': 'am', 'contract.activate': 'amc',
  'contract.close': 'am', 'record.remove': 'am', 'drive.record': 'amc', 'reports.use': 'amt', 'settings.edit': 'a', admin: 'a',
};
const letter = { admin: 'a', manager: 'm', creator: 'c', accountant: 't' } as const;

it('can() matches the spec table for every action × role', () => {
  expect([...ACTIONS].sort()).toEqual(Object.keys(TABLE).sort());
  for (const a of ACTIONS) for (const r of ROLES) expect(can(r, a), `${r} ${a}`).toBe(TABLE[a].includes(letter[r]));
});

const business = { businessName: 'Sao Mai', taxId: '', address: '', phone: '', email: '', logo: null } as never;
const draft = sampleBill();
const sent = sampleBill({ status: 'sent', business });
const paid = sampleBill({ status: 'paid', paidDate: '2026-09-30', business });

describe('actionsFor', () => {
  it('new draft bill', () => expect(actionsFor('bills', undefined, draft)).toEqual(['record.edit']));
  it('new bill created as sent, with the business snapshot', () =>
    expect(actionsFor('bills', undefined, sent)).toEqual(['record.edit', 'bill.send']));
  it('draft → sent with the business snapshot and a new updatedAt', () =>
    expect(actionsFor('bills', draft, { ...draft, status: 'sent', business, updatedAt: '2026-09-27T00:00:00.000Z' })).toEqual(['bill.send']));
  it('sent → paid', () => expect(actionsFor('bills', sent, { ...sent, status: 'paid', paidDate: '2026-09-30' })).toEqual(['bill.pay']));
  it('paid → sent', () => expect(actionsFor('bills', paid, { ...paid, status: 'sent', paidDate: null })).toEqual(['bill.pay']));
  it('sent → cancelled', () => expect(actionsFor('bills', sent, { ...sent, status: 'cancelled' })).toEqual(['bill.cancel']));
  it('draft → cancelled', () => expect(actionsFor('bills', draft, { ...draft, status: 'cancelled' })).toEqual(['bill.cancel']));
  it('sent → paid with a line changed needs an edit too', () => {
    const next = { ...sent, status: 'paid' as const, paidDate: '2026-09-30', lines: [{ ...sent.lines[0], qty: 2 }] };
    expect(actionsFor('bills', sent, next)).toEqual(['bill.pay', 'record.edit']);
  });
  it('a draft with only the footer changed', () =>
    expect(actionsFor('bills', draft, { ...draft, footerNote: 'Cảm ơn' })).toEqual(['record.edit']));
  it('no change apart from tracked and Drive fields', () =>
    expect(actionsFor('bills', sent, { ...sent, version: 3, updatedBy: 'u2', updatedAt: 'x', drive: { state: 'saved' } as never })).toEqual([]));
  it('new active contract', () =>
    expect(actionsFor('contracts', undefined, sampleContract())).toEqual(['record.edit', 'contract.activate']));
  it('contract draft → active', () => {
    const c = sampleContract({ status: 'draft' });
    expect(actionsFor('contracts', c, { ...c, status: 'active' })).toEqual(['contract.activate']);
  });
  it('contract active → completed', () => {
    const c = sampleContract();
    expect(actionsFor('contracts', c, { ...c, status: 'completed' })).toEqual(['contract.close']);
  });
  it('contract draft → terminated', () => {
    const c = sampleContract({ status: 'draft' });
    expect(actionsFor('contracts', c, { ...c, status: 'terminated' })).toEqual(['contract.close']);
  });
  const customer = { id: 'c1', name: 'Hoa Sen', archived: false };
  it('archive a customer', () => expect(actionsFor('customers', customer, { ...customer, archived: true })).toEqual(['record.remove']));
  it('unarchive a customer', () =>
    expect(actionsFor('customers', { ...customer, archived: true }, customer)).toEqual(['record.remove']));
  it('rename a customer', () => expect(actionsFor('customers', customer, { ...customer, name: 'Hoa Sen Xanh' })).toEqual(['record.edit']));
});
