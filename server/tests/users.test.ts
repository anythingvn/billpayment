// @vitest-environment node
import { withAdmin, addUser, client, PASSWORD } from './helpers';

describe('users', () => {
  it('admin adds, lists and changes users; the API never returns secrets', async () => {
    const s = await withAdmin();
    const add = await s.admin.post('/api/users', { username: 'lan', displayName: 'Lan', role: 'creator', password: 'first password 1' });
    expect(add.json().user).toMatchObject({ username: 'lan', displayName: 'Lan', role: 'creator', disabled: false, mustChangePassword: true });
    const list = await s.admin.get('/api/users');
    expect(list.json().users.map((u: { username: string }) => u.username)).toEqual(['admin', 'lan']);
    for (const body of [add.body, list.body, (await s.admin.get('/api/me')).body]) {
      for (const secret of ['hash', 'salt', 'sid', 'id_hash']) expect(body).not.toContain(`"${secret}"`);
    }
    const id = add.json().user.id;
    expect((await s.admin.patch(`/api/users/${id}`, { role: 'accountant', displayName: 'Chị Lan' })).json().user).toMatchObject({ role: 'accountant', displayName: 'Chị Lan' });
    expect((await s.admin.post('/api/users', { username: 'LAN', displayName: 'x', role: 'creator', password: PASSWORD })).statusCode).toBe(422);
    expect((await s.admin.post('/api/users', { username: 'bad', displayName: 'x', role: 'boss', password: PASSWORD })).statusCode).toBe(422);
  });

  it('disabling a user or resetting their password ends their sessions', async () => {
    const s = await withAdmin();
    const lan = await addUser(s, 'lan', 'manager');
    expect((await lan.client.get('/api/me')).statusCode).toBe(200);
    await s.admin.post(`/api/users/${lan.id}/password`, { password: 'reset password 1' });
    expect((await lan.client.get('/api/me')).statusCode).toBe(401);
    const again = client(s.app);
    expect((await again.post('/api/signin', { username: 'lan', password: 'reset password 1' })).json().user.mustChangePassword).toBe(true);
    await s.admin.patch(`/api/users/${lan.id}`, { disabled: true });
    expect((await again.get('/api/me')).statusCode).toBe(401);
    expect((await client(s.app).post('/api/signin', { username: 'lan', password: 'reset password 1' })).statusCode).toBe(401);
  });

  it('there must always be an active admin', async () => {
    const s = await withAdmin();
    const me = (await s.admin.get('/api/me')).json().user.id;
    for (const change of [{ disabled: true }, { role: 'manager' }]) {
      const r = await s.admin.patch(`/api/users/${me}`, change);
      expect([r.statusCode, r.json().messages]).toEqual([422, ['There must be at least one active Admin']]);
    }
    const second = await addUser(s, 'boss2', 'admin');
    expect((await s.admin.patch(`/api/users/${me}`, { role: 'manager' })).statusCode).toBe(200);
    void second;
  });

  it('activity lists user changes newest first', async () => {
    const s = await withAdmin();
    await addUser(s, 'lan', 'creator');
    const items = (await s.admin.get('/api/activity')).json().items as { action: string; at: string; user: string | null }[];
    expect(items[0].at >= items[items.length - 1].at).toBe(true);
    expect(items.map((i) => i.action)).toEqual(expect.arrayContaining(['user-created', 'signin', 'setup']));
  });
});
