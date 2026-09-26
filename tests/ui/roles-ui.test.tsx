import 'fake-indexeddb/auto';
import { render, screen, cleanup, within } from '@testing-library/preact';
import { App } from '../../src/app';
import type { AuthApi, SessionUser } from '../../src/storage/authApi';
import type { Role } from '../../src/storage/roles';
import { openAppDb, putSettings, putCustomer, putBill, putContract, type AppDb } from '../../src/storage/db';
import { ForbiddenError } from '../../src/storage/errors';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';

let n = 0;
const userOf = (role: Role): SessionUser => ({ id: `u-${role}`, username: role, displayName: role, role, mustChangePassword: false });

function fakeAuth(over: Partial<AuthApi> = {}): AuthApi {
  const u = userOf('admin');
  return {
    setupNeeded: vi.fn(async () => false), setup: vi.fn(async () => u), signIn: vi.fn(async () => u), me: vi.fn(async () => u),
    signOut: vi.fn(async () => {}), changePassword: vi.fn(async () => u), importBackup: vi.fn(async () => ''),
    listUsers: vi.fn(async () => []), addUser: vi.fn(), updateUser: vi.fn(), resetPassword: vi.fn(async () => {}),
    listActivity: vi.fn(async () => []),
    ...over,
  } as AuthApi;
}

const customer = { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };

async function setup(hash: string, seed?: (db: AppDb) => Promise<void>) {
  const db = await openAppDb(`roles-ui-${n++}`);
  await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false });
  await putCustomer(db, customer);
  if (seed) await seed(db);
  location.hash = hash;
  return db;
}
/** The app signed in as `role` on a server (auth set), or the single-user app when role is null. */
async function renderAs(role: Role | null, hash = '#/', seed?: (db: AppDb) => Promise<void>, auth = fakeAuth()) {
  const db = await setup(hash, seed);
  const settings = { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false };
  render(role ? <App db={db} initialSettings={settings} user={userOf(role)} auth={auth} /> : <App db={db} initialSettings={settings} />);
  return db;
}
const nav = () => within(document.querySelector('nav')!);
afterEach(() => { cleanup(); location.hash = ''; });

describe('roles: navigation and pages', () => {
  it('single-user mode shows Reports and all buttons', async () => {
    await renderAs(null);
    expect(await screen.findByText('+ New bill')).toBeTruthy();
    expect(nav().getByText('Reports')).toBeTruthy();
  });

  it('accountant: Reports, but no Users or Activity', async () => {
    await renderAs('accountant');
    expect(await nav().findByText('Reports')).toBeTruthy();
    expect(nav().queryByText('Users')).toBeNull();
    expect(nav().queryByText('Activity')).toBeNull();
  });

  it('admin: Users and Activity', async () => {
    await renderAs('admin');
    expect(await nav().findByText('Users')).toBeTruthy();
    expect(nav().getByText('Activity')).toBeTruthy();
  });

  it('creator: no Reports; the Reports and Statement pages refuse', async () => {
    await renderAs('creator', '#/reports');
    expect(await screen.findByText("Your role can't open this page")).toBeTruthy();
    expect(nav().queryByText('Reports')).toBeNull();
    cleanup();
    await renderAs('creator', '#/customers/c1/statement');
    expect(await screen.findByText("Your role can't open this page")).toBeTruthy();
  });

  it('accountant: the editor pages refuse', async () => {
    for (const hash of ['#/bills/new', '#/bills/b1/edit', '#/bills/b1/duplicate', '#/bills/new/contract/k1', '#/contracts/new', '#/contracts/k1/edit', '#/contracts/k1/addendum']) {
      await renderAs('accountant', hash);
      expect(await screen.findByText("Your role can't open this page"), hash).toBeTruthy();
      cleanup();
    }
  });

  it('manager: Users and Activity pages refuse', async () => {
    await renderAs('manager', '#/users');
    expect(await screen.findByText("Your role can't open this page")).toBeTruthy();
  });

  it('the 403 message', () => {
    expect(new ForbiddenError().message).toBe("Your role doesn't allow this");
  });

  it('Activity shows refusals', async () => {
    const auth = fakeAuth({ listActivity: vi.fn(async () => [{ at: '2026-09-27T08:00:00.000Z', action: 'forbidden', user: 'lan', detail: { action: 'bill.cancel', kind: 'bills', id: 'b2' } }]) });
    await renderAs('admin', '#/activity', undefined, auth);
    expect(await screen.findByText('Refused: bill.cancel')).toBeTruthy();
  });
});


const business = { businessName: 'Sao Mai', taxId: '', address: '', phone: '', email: '', logo: null } as never;
const bill = (status: 'draft' | 'sent' | 'paid') => async (db: AppDb) => {
  await putBill(db, sampleBill({ id: 'b1', status, ...(status !== 'draft' && { business }), ...(status === 'paid' && { paidDate: '2026-09-26' }) }));
};
const has = (label: string) => screen.queryByRole('button', { name: label }) !== null;

describe('roles: buttons', () => {
  it('creator on a sent bill', async () => {
    await renderAs('creator', '#/bills/b1', bill('sent'));
    expect(await screen.findByText('Duplicate')).toBeTruthy();
    expect([has('Mark as paid'), has('Cancel bill')]).toEqual([false, false]);
  });

  it('creator on a draft bill', async () => {
    await renderAs('creator', '#/bills/b1', bill('draft'));
    expect(await screen.findByText('Continue in editor')).toBeTruthy();
    expect(has('Cancel bill')).toBe(false);
  });

  it('accountant on a sent bill', async () => {
    await renderAs('accountant', '#/bills/b1', bill('sent'));
    expect(await screen.findByText('Mark as paid')).toBeTruthy();
    expect([has('Duplicate'), has('Cancel bill'), has('Save to Google Drive')]).toEqual([false, false, false]);
  });

  it('accountant on a paid bill can undo', async () => {
    await renderAs('accountant', '#/bills/b1', bill('paid'));
    expect(await screen.findByText('Undo paid')).toBeTruthy();
  });

  it('manager on a sent bill sees Cancel and Drive', async () => {
    await renderAs('manager', '#/bills/b1', bill('sent'));
    expect(await screen.findByText('Cancel bill')).toBeTruthy();
    expect(has('Mark as paid')).toBe(true);
  });

  it('accountant on Home and Contracts', async () => {
    await renderAs('accountant', '#/');
    expect(await screen.findByText('Bills')).toBeTruthy();
    expect(screen.queryByText('+ New bill')).toBeNull();
    cleanup();
    await renderAs('accountant', '#/contracts');
    expect(await screen.findByRole('heading', { name: 'Contracts' })).toBeTruthy();
    expect(screen.queryByText('+ New contract')).toBeNull();
  });

  it('creator on a draft contract with a draft addendum', async () => {
    await renderAs('creator', '#/contracts/k1', async (db) => {
      await putContract(db, sampleContract({ status: 'draft' }));
      await putContract(db, sampleAddendum({ status: 'draft' }));
    });
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect([has('Terminate'), has('Delete'), has('Mark completed')]).toEqual([false, false, false]);
    expect(screen.getByText('+ New addendum')).toBeTruthy();
  });

  it('manager on a draft contract can terminate and delete', async () => {
    await renderAs('manager', '#/contracts/k1', async (db) => {
      await putContract(db, sampleContract({ status: 'draft' }));
    });
    expect(await screen.findByRole('button', { name: 'Terminate' })).toBeTruthy();
    expect(has('Delete')).toBe(true);
  });

  it('accountant on a contract: no Edit, no Create bill, no New addendum', async () => {
    await renderAs('accountant', '#/contracts/k1', async (db) => { await putContract(db, sampleContract()); });
    expect(await screen.findByText('Word (.docx)').catch(() => screen.findByText('Add a template in Settings → Documents'))).toBeTruthy();
    expect([has('Edit'), has('+ New addendum'), screen.queryByText('Create bill') !== null, has('Mark ready')]).toEqual([false, false, false, false]);
  });

  it('creator in the contract editor keeps Save & activate', async () => {
    await renderAs('creator', '#/contracts/k1/edit', async (db) => { await putContract(db, sampleContract({ status: 'draft' })); });
    expect(await screen.findByText('Save & activate')).toBeTruthy();
  });

  it('accountant on Customers and Services', async () => {
    await renderAs('accountant', '#/customers');
    expect(await screen.findByText('Statement')).toBeTruthy();
    expect([has('+ New customer'), has('Edit'), has('Delete')]).toEqual([false, false, false]);
    cleanup();
    await renderAs('accountant', '#/services', async (db) => {
      const { putService } = await import('../../src/storage/db');
      await putService(db, { id: 's1', nameVi: 'Thiết kế', nameEn: '', unitVi: '', unitEn: '', unitPrice: 1, details: [], archived: false } as never);
    });
    expect(await screen.findByText('Thiết kế')).toBeTruthy();
    expect([has('+ New service'), has('Edit'), has('Archive')]).toEqual([false, false, false]);
  });

  it('creator on Customers', async () => {
    await renderAs('creator', '#/customers');
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect([has('Delete'), has('Statement')]).toEqual([false, false]);
  });

  it('manager on Settings: read-only', async () => {
    await renderAs('manager', '#/settings');
    expect(await screen.findByText('Only an Admin can change settings')).toBeTruthy();
    expect((screen.getByLabelText('Business name (as printed)') as HTMLInputElement).matches(':disabled')).toBe(true);
    expect(has('Save')).toBe(false);
  });

  it('admin on Settings: editable', async () => {
    await renderAs('admin', '#/settings');
    const name = await screen.findByLabelText('Business name (as printed)') as HTMLInputElement;
    expect(name.matches(':disabled')).toBe(false);
    expect(screen.queryByText('Only an Admin can change settings')).toBeNull();
  });
});
