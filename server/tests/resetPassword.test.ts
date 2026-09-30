// @vitest-environment node
import { withAdmin, client } from './helpers';
import { resetPassword } from '../src/resetPassword';

describe('reset-password command (server machine)', () => {
  it('sets a new password, ends sessions, requires a change at sign-in', async () => {
    const s = await withAdmin();
    await resetPassword(s.store, 'ADMIN', 'rescue password 1', s.clock.now);
    expect((await s.admin.get('/api/me')).statusCode).toBe(401);
    const r = await client(s.app).post('/api/signin', { username: 'admin', password: 'rescue password 1' });
    expect([r.statusCode, r.json().user.mustChangePassword]).toEqual([200, true]);
    const acts = (await client(s.app).post('/api/signin', { username: 'admin', password: 'rescue password 1' })).statusCode;
    expect(acts).toBe(200);
  });
  it('refuses unknown users and short passwords; re-enables a disabled admin', async () => {
    const s = await withAdmin();
    await expect(resetPassword(s.store, 'ghost', 'rescue password 1', s.clock.now)).rejects.toThrow('No user named ghost');
    await expect(resetPassword(s.store, 'admin', 'short', s.clock.now)).rejects.toThrow('The password must be at least 10 characters');
    s.store.db.prepare('UPDATE users SET disabled = 1').run();
    await resetPassword(s.store, 'admin', 'rescue password 1', s.clock.now);
    expect((await client(s.app).post('/api/signin', { username: 'admin', password: 'rescue password 1' })).statusCode).toBe(200);
  });
});
