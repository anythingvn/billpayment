import 'fake-indexeddb/auto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/src/app';
import { SqliteStore } from '../../server/src/sqliteStore';
import { loadEnv } from '../../server/src/env';
import { ApiStore } from '../../src/storage/apiStore';

let n = 0;
/** An ApiStore whose fetch goes straight into a real server, signed in as the Admin. */
export async function realServerStore(): Promise<{ store: ApiStore; server: SqliteStore }> {
  const dir = mkdtempSync(join(tmpdir(), 'bp-real-'));
  const env = loadEnv({ SESSION_SECRET: 'x'.repeat(32), TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'), DATA_DIR: dir });
  const server = new SqliteStore(join(dir, 'db.sqlite'));
  const app = await buildApp({ store: server, env, distDir: join(dir, 'none'), setupCode: 'CODE' });
  const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-requested-with': 'billpayment' },
    payload: { username: 'admin', displayName: 'Admin', password: 'correct horse 1', setupCode: 'CODE' } });
  const cookie = String(setup.headers['set-cookie']).split(';')[0];
  const f = (async (url: string, init: RequestInit = {}) => {
    const r = await app.inject({
      method: (init.method ?? 'GET') as 'GET', url, payload: init.body as string | undefined,
      headers: { ...(init.headers as Record<string, string>), cookie },
    });
    return new Response(r.statusCode === 204 ? null : r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { store: new ApiStore({ fetch: f, userId: `real-${n++}`, onStatus: () => {} }), server };
}
