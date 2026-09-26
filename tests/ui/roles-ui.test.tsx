import 'fake-indexeddb/auto';
import { render, screen, cleanup, within } from '@testing-library/preact';
import { App } from '../../src/app';
import type { AuthApi, SessionUser } from '../../src/storage/authApi';
import type { Role } from '../../src/storage/roles';
import { openAppDb, putSettings, putCustomer, type AppDb } from '../../src/storage/db';
import { ForbiddenError } from '../../src/storage/errors';
import { DEFAULT_SETTINGS } from '../../src/domain/types';

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

