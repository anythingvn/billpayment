import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type AppOptions } from '../src/app';
import { SqliteStore } from '../src/sqliteStore';
import { loadEnv } from '../src/env';

export const PASSWORD = 'correct horse 1';
export const SETUP_CODE = 'TEST-SETUP-CODE';
export const testEnv = (over: Record<string, string> = {}) =>
  loadEnv({ SESSION_SECRET: 'x'.repeat(32), TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'), DATA_DIR: mkdtempSync(join(tmpdir(), 'bp-data-')), ...over });

/** A fresh server on a temp SQLite file, with a movable clock. */
export async function makeServer(over: Record<string, string> = {}, extra: Partial<AppOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bp-srv-'));
  const store = new SqliteStore(join(dir, 'test.db'));
  const clock = { now: new Date('2026-09-26T08:00:00.000Z') };
  const env = testEnv(over);
  const app = await buildApp({ store, env, now: () => clock.now, distDir: join(dir, 'no-dist'), setupCode: SETUP_CODE, ...extra });
  return { app, store, clock, env };
}

/** Cookie jar helper: sends requests with the CSRF header and remembers the session cookie. */
export function client(app: FastifyInstance) {
  let cookie = '';
  const req = async (method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({
      method, url, payload: payload as InjectOptions['payload'],
      headers: { 'x-requested-with': 'billpayment', ...(cookie ? { cookie } : {}), ...headers },
    });
    const set = r.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : set;
    if (first?.startsWith('sid=')) cookie = first.split(';')[0].endsWith('=') ? '' : first.split(';')[0];
    return r;
  };
  return {
    get: (url: string) => req('GET', url),
    post: (url: string, body?: unknown, headers?: Record<string, string>) => req('POST', url, body ?? {}, headers),
    patch: (url: string, body?: unknown) => req('PATCH', url, body ?? {}),
    put: (url: string, body?: unknown) => req('PUT', url, body ?? {}),
    del: (url: string) => req('DELETE', url),
    raw: req,
    get cookie() { return cookie; },
  };
}

/** A server with the Admin set up and signed in. */
export async function withAdmin(over: Record<string, string> = {}, extra: Partial<AppOptions> = {}) {
  const s = await makeServer(over, extra);
  const admin = client(s.app);
  const r = await admin.post('/api/setup', { username: 'admin', displayName: 'Chủ Doanh Nghiệp', password: PASSWORD, setupCode: SETUP_CODE });
  if (r.statusCode !== 200) throw new Error(`setup failed: ${r.statusCode} ${r.body}`);
  return { ...s, admin };
}

/** Admin creates a user; returns a signed-in client for them (first password already changed). */
export async function addUser(s: Awaited<ReturnType<typeof withAdmin>>, username: string, role: string, displayName = username) {
  const r = await s.admin.post('/api/users', { username, displayName, role, password: 'first password 1' });
  if (r.statusCode !== 200) throw new Error(`add user failed: ${r.statusCode} ${r.body}`);
  const c = client(s.app);
  await c.post('/api/signin', { username, password: 'first password 1' });
  await c.post('/api/me/password', { current: 'first password 1', next: PASSWORD });
  return { client: c, id: (r.json() as { user: { id: string } }).user.id };
}
