// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app';
import { SqliteStore } from '../src/sqliteStore';
import { loadEnv } from '../src/env';

const key = Buffer.alloc(32, 7).toString('base64');
export const testEnv = (over: Record<string, string> = {}) => loadEnv({ SESSION_SECRET: 'x'.repeat(32), TOKEN_KEY: key, ...over });

describe('server app', () => {
  it('health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-app-'));
    const app = await buildApp({ store: new SqliteStore(join(dir, 'a.db')), env: testEnv({ DATA_DIR: dir }) });
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect([r.statusCode, r.json()]).toEqual([200, { ok: true }]);
    await app.close();
  });
  it('serves the app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-app-'));
    const dist = join(dir, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Phiếu thanh toán</title>');
    const app = await buildApp({ store: new SqliteStore(join(dir, 'a.db')), env: testEnv({ DATA_DIR: dir }), distDir: dist });
    const r = await app.inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Phiếu thanh toán');
    expect((await app.inject({ method: 'GET', url: '/api/nothing' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('env', () => {
  it('requires the secrets', () => {
    expect(() => loadEnv({})).toThrow('Missing SESSION_SECRET or TOKEN_KEY in .env');
    expect(() => loadEnv({ SESSION_SECRET: 'x'.repeat(32), TOKEN_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/TOKEN_KEY must be 32 bytes/);
  });
  it('defaults', () => {
    const e = testEnv();
    expect([e.publicUrl, e.dataDir, e.port, e.tokenKey.length, e.secureCookies]).toEqual(['http://localhost:8080', '/data', 8080, 32, false]);
    expect(testEnv({ PUBLIC_URL: 'https://bills.example.vn' }).secureCookies).toBe(true);
  });
});
