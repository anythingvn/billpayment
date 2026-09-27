// @vitest-environment node
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withAdmin, addUser } from './helpers';
import type { GoogleOAuth } from '../src/drive';
import { nightlyRun } from '../src/nightly';
import { fakeDrive } from '../../tests/drive/fakeDrive';
import { sampleBill } from '../../tests/fixtures';

const GOOGLE = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret' };
const oauth = (): GoogleOAuth => ({
  authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  exchange: async () => ({ refreshToken: 'REFRESH-TOKEN-XYZ', email: 'owner@saomai.vn' }),
  refresh: async () => ({ accessToken: 'ya29.access', expiresIn: 3600 }),
  revoke: async () => {},
});

/** Admin signed in, company Drive connected to a fake Drive, one bill. */
async function connected() {
  const api = fakeDrive();
  const s = await withAdmin(GOOGLE, { googleOAuth: oauth(), driveApi: () => api });
  const go = await s.admin.get('/api/drive/connect');
  const state = new URL(String(go.headers.location)).searchParams.get('state')!;
  await s.app.inject({ method: 'GET', url: `/api/drive/callback?code=good-code&state=${state}` });
  await s.admin.put('/api/bills/b1', sampleBill());
  return { ...s, api };
}
type State = { at: string | null; error: string | null; days: { date: string; json: string; db: string }[] };
const parentName = (api: ReturnType<typeof fakeDrive>, id: string) => api.files.get(api.files.get(id)!.parents![0])!.name;

describe('backup to the company Google Drive', () => {
  it('uploads the backup file and the database to their folders', async () => {
    const s = await connected();
    const r = await s.admin.post('/api/backup/drive');
    expect(r.statusCode).toBe(200);
    const st = r.json() as State;
    expect(st).toMatchObject({ at: '2026-09-26T08:00:00.000Z', error: null });
    expect(st.days.map((d) => d.date)).toEqual(['2026-09-26']);
    const json = s.api.byName('billpayment-2026-09-26.json');
    const db = s.api.byName('billpayment-2026-09-26.db');
    expect([json.length, db.length]).toEqual([1, 1]);
    expect(parentName(s.api, json[0].id)).toBe('Sao lưu');
    expect(parentName(s.api, db[0].id)).toBe('Máy chủ – không chia sẻ');
    expect(parentName(s.api, s.api.files.get(db[0].id)!.parents![0])).toBe('Sao lưu');
    const data = JSON.parse(await json[0].content!.text());
    expect(data.bills.map((b: { id: string }) => b.id)).toEqual(['b1']);
    expect(JSON.stringify(data)).not.toMatch(/hash|REFRESH/);
    expect((await db[0].content!.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await s.admin.get('/api/backup/drive')).json()).toEqual(st);
  });

  it('a second run the same day replaces that day\'s files', async () => {
    const s = await connected();
    await s.admin.post('/api/backup/drive');
    await s.admin.post('/api/backup/drive');
    const json = s.api.byName('billpayment-2026-09-26.json');
    expect(json.length).toBe(1);
    expect(json[0].versions).toBe(2);
    expect(s.api.byName('billpayment-2026-09-26.db').length).toBe(1);
  });

  it('keeps 14 nights: the 15th moves the oldest pair to the trash', async () => {
    const s = await connected();
    for (let i = 0; i < 15; i++) {
      s.clock.now = new Date(Date.UTC(2026, 8, 26 + i, 8));
      await s.admin.post('/api/backup/drive');
    }
    const st = (await s.admin.get('/api/backup/drive')).json() as State;
    expect(st.days.length).toBe(14);
    expect(st.days[0].date).toBe('2026-09-27');
    expect(s.api.byName('billpayment-2026-09-26.json')[0].trashed).toBe(true);
    expect(s.api.byName('billpayment-2026-09-26.db')[0].trashed).toBe(true);
    expect(s.api.byName('billpayment-2026-09-27.json')[0].trashed).toBeFalsy();
  });

  it('not connected: nothing uploaded, the error is shown, the local copy is still made', async () => {
    const s = await withAdmin();
    const st = (await s.admin.post('/api/backup/drive')).json() as State;
    expect(st).toMatchObject({ error: "Google Drive isn't connected", days: [] });
    expect(readdirSync(join(s.env.dataDir, 'backups'))).toEqual(['billpayment-2026-09-26.db']);
  });

  it('a Drive failure is recorded and the list is unchanged', async () => {
    const s = await connected();
    await s.admin.post('/api/backup/drive');
    s.clock.now = new Date('2026-09-27T08:00:00.000Z');
    s.api.createFile = async () => { throw new Error('Google Drive error 500'); };
    const st = (await s.admin.post('/api/backup/drive')).json() as State;
    expect(st.error).toBe('Google Drive error 500');
    expect(st.days.map((d) => d.date)).toEqual(['2026-09-26']);
  });

  it('only the Admin', async () => {
    const s = await connected();
    const m = (await addUser(s, 'minh', 'manager')).client;
    expect((await m.post('/api/backup/drive')).statusCode).toBe(403);
    expect((await m.get('/api/backup/drive')).statusCode).toBe(403);
  });

  it('a restore keeps the list of Drive backups (so old ones are still cleaned up)', async () => {
    const s = await connected();
    await s.admin.post('/api/backup/drive');
    const backup = (await s.admin.get('/api/backup')).json();
    expect((await s.admin.post('/api/restore', { confirm: 'RESTORE', data: backup })).statusCode).toBe(200);
    expect(((await s.admin.get('/api/backup/drive')).json() as State).days.length).toBe(1);
  });
});

describe('nightly run', () => {
  it('makes the local copy, then calls the Drive step; a failing Drive step is logged', async () => {
    const s = await withAdmin();
    const seen: string[] = [];
    const logs: string[] = [];
    await nightlyRun(s.store, s.env.dataDir, new Date('2026-09-26T02:00:00'), async (file) => { seen.push(file); throw new Error('boom'); }, (m) => logs.push(m));
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatch(/billpayment-2026-09-26\.db$/);
    expect(logs).toEqual(['Backup to Google Drive failed: boom']);
  });
});
