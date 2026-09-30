// @vitest-environment node
import { withAdmin, makeServer, client, addUser, PASSWORD, SETUP_CODE } from './helpers';

describe('final review fixes (server)', () => {
  it('I4/M5: huge usernames are refused before any write; unknown usernames are not logged verbatim', async () => {
    const s = await withAdmin();
    const huge = await client(s.app).post('/api/signin', { username: 'x'.repeat(5 * 1024 * 1024), password: 'whatever pass' });
    expect(huge.statusCode).toBe(413);
    await client(s.app).post('/api/signin', { username: 'my secret password!', password: 'whatever pass' });
    const count = (t: string) => (s.store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count('signin_failures')).toBe(0);
    const failed = (await s.admin.get('/api/activity')).json().items.filter((i: { action: string }) => i.action === 'signin-failed');
    expect(failed.map((f: { detail: object }) => f.detail)).toEqual([{ username: '(unknown)' }]);
  });

  it('I4: old sign-in failures are pruned', async () => {
    const s = await withAdmin();
    for (let i = 0; i < 3; i++) await client(s.app).post('/api/signin', { username: 'admin', password: 'wrong wrong 1' });
    s.clock.now = new Date(s.clock.now.getTime() + 16 * 60 * 1000);
    await client(s.app).post('/api/signin', { username: 'admin', password: 'wrong wrong 1' });
    expect((s.store.db.prepare('SELECT COUNT(*) AS n FROM signin_failures').get() as { n: number }).n).toBe(1);
  });

  it('M4: attempts during a lock do not extend it', async () => {
    const s = await withAdmin();
    for (let i = 0; i < 5; i++) await client(s.app).post('/api/signin', { username: 'admin', password: 'wrong wrong 1' });
    // Someone keeps trying once a minute during the lock…
    for (let m = 1; m <= 14; m++) {
      s.clock.now = new Date(s.clock.now.getTime() + 60 * 1000);
      expect((await client(s.app).post('/api/signin', { username: 'admin', password: 'wrong wrong 1' })).statusCode).toBe(401);
    }
    // …but the lock still ends 15 minutes after it started.
    s.clock.now = new Date(s.clock.now.getTime() + 2 * 60 * 1000);
    expect((await client(s.app).post('/api/signin', { username: 'admin', password: PASSWORD })).statusCode).toBe(200);
  });

  it('I5: setup needs the setup code; it is single-use', async () => {
    const { app } = await makeServer();
    const body = { username: 'admin', displayName: 'A', password: PASSWORD };
    expect((await client(app).post('/api/setup', body)).statusCode).toBe(403);
    expect((await client(app).post('/api/setup', { ...body, setupCode: 'WRONG-CODE' })).statusCode).toBe(403);
    const [a, b] = await Promise.all([client(app).post('/api/setup', { ...body, setupCode: SETUP_CODE }), client(app).post('/api/setup', { ...body, username: 'other', setupCode: SETUP_CODE })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it('I7: server errors never leak details; templates must be complete', async () => {
    const s = await withAdmin();
    const bad = await s.admin.put('/api/templates/t2', { id: 't2', kind: 'bill', dataBase64: Buffer.from([0x50, 0x4b]).toString('base64') });
    expect(bad.statusCode).toBe(422);
    expect((await s.admin.get('/api/templates')).statusCode).toBe(200);
    s.store.db.exec("INSERT INTO templates (id, json, data, version) VALUES ('broken', 'not json', x'504b', 1)");
    const r = await s.admin.get('/api/templates');
    expect([r.statusCode, r.json()]).toEqual([500, { error: 'server' }]);
  });

  it('M1: a temporary password must be changed before anything else', async () => {
    const s = await withAdmin();
    await s.admin.post('/api/users', { username: 'lan', displayName: 'Lan', role: 'creator', password: 'first password 1' });
    const c = client(s.app);
    await c.post('/api/signin', { username: 'lan', password: 'first password 1' });
    const blocked = await c.get('/api/bills');
    expect([blocked.statusCode, blocked.json()]).toEqual([403, { error: 'password-change' }]);
    expect((await c.get('/api/me')).statusCode).toBe(200);
    await c.post('/api/me/password', { current: 'first password 1', next: PASSWORD });
    expect((await c.get('/api/bills')).statusCode).toBe(200);
    void addUser;
  });
});
