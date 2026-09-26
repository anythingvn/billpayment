// @vitest-environment node
import { makeServer, client, withAdmin, addUser, PASSWORD, SETUP_CODE } from './helpers';

const BAD = 'Wrong username or password, or the account is locked for a while';

describe('setup and sign-in', () => {
  it('setup creates the first admin once', async () => {
    const { app } = await makeServer();
    const c = client(app);
    expect((await c.get('/api/setup')).json()).toEqual({ needed: true });
    const r = await c.post('/api/setup', { username: 'admin', displayName: 'Chủ', password: PASSWORD, setupCode: SETUP_CODE });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ username: 'admin', role: 'admin', mustChangePassword: false });
    expect((await c.get('/api/setup')).json()).toEqual({ needed: false });
    expect((await client(app).post('/api/setup', { username: 'x', displayName: 'X', password: PASSWORD, setupCode: SETUP_CODE })).statusCode).toBe(409);
  });

  it('sign in and me', async () => {
    const s = await withAdmin();
    const c = client(s.app);
    const r = await c.post('/api/signin', { username: 'ADMIN', password: PASSWORD });
    expect(r.statusCode).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/^sid=[^;]+;/);
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(flag);
    expect(cookie).not.toContain('Secure');
    expect((await c.get('/api/me')).json().user).toMatchObject({ username: 'admin', displayName: 'Chủ Doanh Nghiệp', role: 'admin' });
    expect((await client(s.app).get('/api/me')).statusCode).toBe(401);
  });

  it('Secure cookie on https', async () => {
    const s = await withAdmin({ PUBLIC_URL: 'https://bills.example.vn' });
    const r = await client(s.app).post('/api/signin', { username: 'admin', password: PASSWORD }, { origin: 'https://bills.example.vn' });
    expect(String(r.headers['set-cookie'])).toContain('Secure');
  });

  it('wrong password and unknown user give the same message', async () => {
    const s = await withAdmin();
    const a = await client(s.app).post('/api/signin', { username: 'admin', password: 'nope nope nope' });
    const b = await client(s.app).post('/api/signin', { username: 'ghost', password: 'nope nope nope' });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect([a.json().message, b.json().message]).toEqual([BAD, BAD]);
  });

  it('locks after 5 failures for 15 minutes', async () => {
    const s = await withAdmin();
    for (let i = 0; i < 5; i++) await client(s.app).post('/api/signin', { username: 'admin', password: 'wrong wrong 1' });
    const locked = await client(s.app).post('/api/signin', { username: 'admin', password: PASSWORD });
    expect([locked.statusCode, locked.json().message]).toEqual([401, BAD]);
    s.clock.now = new Date(s.clock.now.getTime() + 15 * 60 * 1000 + 1000);
    expect((await client(s.app).post('/api/signin', { username: 'admin', password: PASSWORD })).statusCode).toBe(200);
    const actions = (await s.admin.get('/api/activity')).json().items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['signin-failed', 'locked', 'signin']));
  });

  it('password rules', async () => {
    const { app, store } = await makeServer();
    const c = client(app);
    const short = await c.post('/api/setup', { username: 'admin', displayName: 'A', password: '123456789', setupCode: SETUP_CODE });
    expect([short.statusCode, short.json().messages]).toEqual([422, ['The password must be at least 10 characters']]);
    await c.post('/api/setup', { username: 'admin', displayName: 'A', password: PASSWORD, setupCode: SETUP_CODE });
    const row = store.db.prepare('SELECT hash, salt FROM users').get() as { hash: string; salt: string };
    expect(row.hash).not.toContain(PASSWORD);
    expect(row.hash.length).toBeGreaterThan(40);
    expect(row.salt.length).toBeGreaterThan(10);
  });

  it('sessions expire after 30 idle days; sign-out ends them', async () => {
    const s = await withAdmin();
    s.clock.now = new Date(s.clock.now.getTime() + 29 * 86400000);
    expect((await s.admin.get('/api/me')).statusCode).toBe(200);
    s.clock.now = new Date(s.clock.now.getTime() + 29 * 86400000);
    expect((await s.admin.get('/api/me')).statusCode).toBe(200);
    s.clock.now = new Date(s.clock.now.getTime() + 31 * 86400000);
    expect((await s.admin.get('/api/me')).statusCode).toBe(401);
    const c = client(s.app);
    await c.post('/api/signin', { username: 'admin', password: PASSWORD });
    const cookie = c.cookie;
    await c.post('/api/signout');
    expect((await s.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('CSRF: writes need the header and a same-origin Origin', async () => {
    const s = await withAdmin();
    const cookie = s.admin.cookie;
    const noHeader = await s.app.inject({ method: 'POST', url: '/api/signout', headers: { cookie } });
    const foreign = await s.app.inject({ method: 'POST', url: '/api/signout', headers: { cookie, 'x-requested-with': 'billpayment', origin: 'https://evil.example' } });
    expect([noHeader.statusCode, foreign.statusCode]).toEqual([403, 403]);
    expect((await s.admin.get('/api/me')).statusCode).toBe(200);
  });

  it('security headers on every response', async () => {
    const s = await withAdmin();
    for (const r of [await s.admin.get('/api/me'), await s.app.inject({ method: 'GET', url: '/api/health' }), await s.app.inject({ method: 'GET', url: '/nothing' })]) {
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('same-origin');
      expect(r.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    }
  });

  it('must change password first', async () => {
    const s = await withAdmin();
    await s.admin.post('/api/users', { username: 'lan', displayName: 'Lan', role: 'creator', password: 'first password 1' });
    const c = client(s.app);
    expect((await c.post('/api/signin', { username: 'lan', password: 'first password 1' })).json().user.mustChangePassword).toBe(true);
    expect((await c.post('/api/me/password', { current: 'wrong wrong wrong', next: PASSWORD })).statusCode).toBe(422);
    expect((await c.post('/api/me/password', { current: 'first password 1', next: PASSWORD })).statusCode).toBe(200);
    expect((await c.get('/api/me')).json().user.mustChangePassword).toBe(false);
  });

  it('non-admin gets 403 on users and activity', async () => {
    const s = await withAdmin();
    const { client: lan } = await addUser(s, 'lan', 'manager');
    expect((await lan.get('/api/users')).statusCode).toBe(403);
    expect((await lan.get('/api/activity')).statusCode).toBe(403);
    expect((await lan.post('/api/users', { username: 'x', displayName: 'X', role: 'admin', password: PASSWORD })).statusCode).toBe(403);
  });
});
