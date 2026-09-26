import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';
import { ServerRoot, type AuthApi, type SessionUser } from '../../src/serverRoot';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putBill, putCustomer } from '../../src/storage/db';
import { setConnection } from '../../src/ui/useOnline';
import { ConflictError, SignInError, InvalidError, OfflineError } from '../../src/storage/errors';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { useServerDrive } from '../../src/drive/service';
import { sampleBill } from '../fixtures';

const admin: SessionUser = { id: 'u1', username: 'admin', displayName: 'Chủ Doanh Nghiệp', role: 'admin', mustChangePassword: false };
const lan: SessionUser = { id: 'u2', username: 'lan', displayName: 'Chị Lan', role: 'creator', mustChangePassword: false };
let n = 0;

function fakeAuth(over: Partial<AuthApi> = {}): AuthApi {
  return {
    setupNeeded: vi.fn(async () => false),
    setup: vi.fn(async () => admin),
    signIn: vi.fn(async () => admin),
    me: vi.fn(async () => admin),
    signOut: vi.fn(async () => {}),
    changePassword: vi.fn(async () => ({ ...admin, mustChangePassword: false })),
    importBackup: vi.fn(async () => '1 bills, 1 customers, 0 services, 0 contracts, 0 templates'),
    listUsers: vi.fn(async () => [{ ...admin, disabled: false, lastSignIn: null }, { ...lan, disabled: false, lastSignIn: null }]),
    addUser: vi.fn(async (u) => ({ ...u, id: 'u9', disabled: false, mustChangePassword: true, lastSignIn: null })),
    updateUser: vi.fn(async (id, change) => ({ ...lan, id, ...change, disabled: !!change.disabled, lastSignIn: null })),
    resetPassword: vi.fn(async () => {}),
    listActivity: vi.fn(async () => [{ at: '2026-09-26T08:00:00.000Z', action: 'signin', user: 'Chị Lan', detail: {} }]),
    ...over,
  };
}
async function root(auth: AuthApi) {
  const db = await openAppDb(`server-ui-${n++}`);
  await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false });
  location.hash = '#/';
  render(<ServerRoot auth={auth} makeStore={async () => db} />);
  return db;
}
afterEach(() => { cleanup(); location.hash = ''; setConnection('online'); });

describe('server mode', () => {
  it('setup screen when there are no users, then optional import', async () => {
    const auth = fakeAuth({ setupNeeded: vi.fn(async () => true), me: vi.fn(async () => { throw new SignInError(); }) });
    await root(auth);
    fireEvent.input(await screen.findByLabelText('Setup code (in the server log)'), { target: { value: 'CODE-1234' } });
    fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.input(screen.getByLabelText('Your name'), { target: { value: 'Chủ Doanh Nghiệp' } });
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'correct horse 1' } });
    fireEvent.input(screen.getByLabelText('Password again'), { target: { value: 'correct horse 2' } });
    fireEvent.click(screen.getByText('Create Admin'));
    expect(await screen.findByText('The passwords are different')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Password again'), { target: { value: 'correct horse 1' } });
    fireEvent.click(screen.getByText('Create Admin'));
    await waitFor(() => expect(auth.setup).toHaveBeenCalledWith({ setupCode: 'CODE-1234', username: 'admin', displayName: 'Chủ Doanh Nghiệp', password: 'correct horse 1' }));
    expect(await screen.findByText('Import your data')).toBeTruthy();
    fireEvent.click(screen.getByText('Skip — start empty'));
    expect(await screen.findByText('+ New bill')).toBeTruthy();
  });

  it('sign in: wrong password message, then Bills; must-change shows Change password', async () => {
    const auth = fakeAuth({
      me: vi.fn(async () => { throw new SignInError(); }),
      signIn: vi.fn()
        .mockRejectedValueOnce(new InvalidError(['Wrong username or password, or the account is locked for a while']))
        .mockResolvedValueOnce({ ...lan, mustChangePassword: true }),
    });
    await root(auth);
    fireEvent.input(await screen.findByLabelText('Username'), { target: { value: 'lan' } });
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'nope nope nope' } });
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText('Wrong username or password, or the account is locked for a while')).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText('Choose a new password')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'first password 1' } });
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'my new password 1' } });
    fireEvent.input(screen.getByLabelText('New password again'), { target: { value: 'my new password 1' } });
    fireEvent.click(screen.getByText('Save password'));
    await waitFor(() => expect(auth.changePassword).toHaveBeenCalledWith('first password 1', 'my new password 1'));
    expect(await screen.findByText('+ New bill')).toBeTruthy();
  });

  it('Users screen (admin only)', async () => {
    const auth = fakeAuth();
    await root(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    const row = (await screen.findByText('Chị Lan')).closest('tr')!;
    const role = within(row).getByLabelText('Role of lan') as HTMLSelectElement;
    expect([role.value, role.selectedOptions[0].text]).toEqual(['creator', 'Order Creator']);
    fireEvent.click(screen.getByText('+ Add user'));
    fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'ke.toan' } });
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Kế toán' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'accountant' } });
    fireEvent.input(screen.getByLabelText('First password'), { target: { value: 'first password 1' } });
    fireEvent.click(screen.getByText('Create user'));
    await waitFor(() => expect(auth.addUser).toHaveBeenCalledWith({ username: 'ke.toan', displayName: 'Kế toán', role: 'accountant', password: 'first password 1' }));
    vi.spyOn(window, 'prompt').mockReturnValue('reset password 1');
    fireEvent.click(within(row).getByText('Reset password'));
    await waitFor(() => expect(auth.resetPassword).toHaveBeenCalledWith('u2', 'reset password 1'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(row).getByText('Disable'));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith('u2', { disabled: true }));
  });

  it('last-admin error is shown; non-admins have no Users menu', async () => {
    const auth = fakeAuth({ updateUser: vi.fn(async () => { throw new InvalidError(['There must be at least one active Admin']); }) });
    await root(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    const row = (await screen.findByText('Chủ Doanh Nghiệp', { selector: 'td' })).closest('tr')!;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(row).getByText('Disable'));
    expect(await screen.findByText('There must be at least one active Admin')).toBeTruthy();
    cleanup();
    await root(fakeAuth({ me: vi.fn(async () => lan) }));
    await screen.findByText('+ New bill');
    expect(screen.queryByRole('button', { name: 'Users' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activity' })).toBeNull();
  });

  it('offline banner and disabled buttons; viewing still works', async () => {
    const db = await root(fakeAuth());
    await putBill(db, sampleBill({ id: 'b1', status: 'sent' }));
    await screen.findByText('+ New bill');
    setConnection('offline', '2026-09-26T08:05:00.000Z');
    expect(await screen.findByText(/^Offline — viewing only · last updated \d\d:\d\d$/)).toBeTruthy();
    const newBill = screen.getByText('+ New bill') as HTMLButtonElement;
    expect([newBill.disabled, newBill.title]).toEqual([true, 'Needs a connection']);
    location.hash = '#/bills/b1';
    expect(await screen.findByText('TT-2026-0012')).toBeTruthy();
    setConnection('online');
    await waitFor(() => expect(screen.queryByText(/^Offline — viewing only/)).toBeNull());
  });

  it('conflict message keeps the form', async () => {
    const db = await root(fakeAuth());
    await screen.findByText('+ New bill');
    db.putCustomer = vi.fn(async () => { throw new ConflictError(); });
    location.hash = '#/customers';
    fireEvent.click(await screen.findByText('+ New customer'));
    fireEvent.input(screen.getByLabelText(/^Name/), { target: { value: 'Công ty Mới' } });
    fireEvent.click(screen.getByText('Save customer'));
    expect(await screen.findByText('Someone else changed this — reload to see their changes')).toBeTruthy();
    expect(screen.getByText('Reload')).toBeTruthy();
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Công ty Mới');
  });

  it('signed out mid-session: sign in again, same screen', async () => {
    const auth = fakeAuth({ signIn: vi.fn(async () => admin) });
    const db = await root(auth);
    await screen.findByText('+ New bill');
    db.putCustomer = vi.fn(async () => { throw new SignInError(); });
    location.hash = '#/customers';
    fireEvent.click(await screen.findByText('+ New customer'));
    fireEvent.input(screen.getByLabelText(/^Name/), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save customer'));
    fireEvent.input(await screen.findByLabelText('Password'), { target: { value: 'correct horse 1' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalled());
    expect(location.hash).toBe('#/customers');
    expect(await screen.findByText('Customers', { selector: 'h2' })).toBeTruthy();
  });

  it('no browser-backup reminder on the server (it backs up nightly)', async () => {
    await root(fakeAuth());
    await screen.findByText('+ New bill');
    await new Promise((r) => setTimeout(r, 300)); // the reminder is decided after the list loads
    expect(screen.queryByText(/haven't backed up/)).toBeNull();
  });

  it('sign out ends the session', async () => {
    const auth = fakeAuth();
    await root(auth);
    fireEvent.click(await screen.findByText('Sign out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(await screen.findByLabelText('Username')).toBeTruthy();
  });
});

describe('authorship and prepared-by', () => {
  it('prepared by defaults to the user; created/changed by on a bill', async () => {
    const db = await openAppDb(`server-ui-${n++}`);
    await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', preparedBy: '' });
    await putCustomer(db, { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
    await putBill(db, sampleBill({ id: 'b1', status: 'sent', createdBy: 'Chủ Doanh Nghiệp', updatedBy: 'Chị Lan', updatedAt: '2026-09-26T03:05:00.000Z' }));
    location.hash = '#/bills/b1';
    render(<App db={db} initialSettings={await getSettings(db)} user={lan} />);
    expect(await screen.findByText(/^Created by Chủ Doanh Nghiệp · changed by Chị Lan \d\d\/\d\d \d\d:\d\d$/)).toBeTruthy();
    cleanup();
    location.hash = '#/bills/new';
    render(<App db={db} initialSettings={await getSettings(db)} user={lan} />);
    fireEvent.click(await screen.findByText('Hoa Sen Xanh'));
    fireEvent.click(await screen.findByText('3 · Review & export'));
    expect(await screen.findByText('Chị Lan')).toBeTruthy();
  });
});

describe('company Drive in Settings (server mode)', () => {
  afterEach(() => useServerDrive(null));
  const client = (connected: boolean) => ({
    status: vi.fn(async () => ({ connected, email: connected ? 'owner@saomai.vn' : null })),
    upload: vi.fn(), disconnect: vi.fn(async () => {}),
  });
  it('Admin: Connect link when not connected; the email and Disconnect when connected', async () => {
    await useServerDrive(client(false));
    await root(fakeAuth());
    location.hash = '#/settings';
    const connect = await screen.findByText('Connect Google Drive');
    expect(connect.getAttribute('href')).toBe('/api/drive/connect');
    cleanup();
    const c = client(true);
    await useServerDrive(c);
    await root(fakeAuth());
    location.hash = '#/settings';
    expect(await screen.findByText('Company Drive: owner@saomai.vn')).toBeTruthy();
    fireEvent.click(screen.getByText('Disconnect'));
    await waitFor(() => expect(c.disconnect).toHaveBeenCalled());
  });
  it('other users only see who connects it', async () => {
    await useServerDrive(client(true));
    await root(fakeAuth({ me: vi.fn(async () => lan) }));
    location.hash = '#/settings';
    expect(await screen.findByText('Google Drive is connected by the Admin.')).toBeTruthy();
    expect(screen.queryByText('Connect Google Drive')).toBeNull();
    expect(screen.queryByText('Disconnect')).toBeNull();
  });
});

describe('review fixes (app)', () => {
  it('I2: after an offline failure the editor can save again', async () => {
    const db = await root(fakeAuth());
    await putCustomer(db, { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
    await screen.findByText('+ New bill');
    const real = db.putBill.bind(db);
    let calls = 0;
    db.putBill = vi.fn(async (b) => { calls++; if (calls === 1) throw new OfflineError(); return real(b); });
    location.hash = '#/bills/new';
    fireEvent.click(await screen.findByText('Hoa Sen Xanh'));
    fireEvent.click(screen.getByText('Save draft'));
    expect(await screen.findByText("Can't reach the server — your change wasn't saved")).toBeTruthy();
    expect(screen.queryByText(/Could not save/)).toBeNull();
    await waitFor(() => expect((screen.getByText('Save draft') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('M1: a sign-in with a temporary password in the overlay goes to Change password', async () => {
    const auth = fakeAuth({ signIn: vi.fn(async () => ({ ...admin, mustChangePassword: true })) });
    const db = await root(auth);
    await screen.findByText('+ New bill');
    db.putCustomer = vi.fn(async () => { throw new SignInError(); });
    location.hash = '#/customers';
    fireEvent.click(await screen.findByText('+ New customer'));
    fireEvent.input(screen.getByLabelText(/^Name/), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save customer'));
    fireEvent.input(await screen.findByLabelText('Password'), { target: { value: 'temporary pass 1' } });
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText('Choose a new password')).toBeTruthy();
  });

  it('I5: setup asks for the setup code from the server log', async () => {
    const auth = fakeAuth({ setupNeeded: vi.fn(async () => true), me: vi.fn(async () => { throw new SignInError(); }) });
    await root(auth);
    fireEvent.input(await screen.findByLabelText('Setup code (in the server log)'), { target: { value: 'K7Q2-M9XA-3FHP' } });
    fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.input(screen.getByLabelText('Your name'), { target: { value: 'A' } });
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'correct horse 1' } });
    fireEvent.input(screen.getByLabelText('Password again'), { target: { value: 'correct horse 1' } });
    fireEvent.click(screen.getByText('Create Admin'));
    await waitFor(() => expect(auth.setup).toHaveBeenCalledWith({ setupCode: 'K7Q2-M9XA-3FHP', username: 'admin', displayName: 'A', password: 'correct horse 1' }));
  });
});

