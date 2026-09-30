// @vitest-environment node
import { withAdmin, addUser, makeServer } from './helpers';
import { encryptToken, decryptToken, type GoogleOAuth } from '../src/drive';
import { fakeDrive } from '../../tests/drive/fakeDrive';
import { sampleBill } from '../../tests/fixtures';

function fakeOAuth(): GoogleOAuth & { revoked: string[] } {
  const revoked: string[] = [];
  return {
    revoked,
    authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchange: vi.fn(async (code: string) => {
      if (code !== 'good-code') throw new Error('bad code');
      return { refreshToken: 'REFRESH-TOKEN-XYZ', email: 'owner@saomai.vn' };
    }),
    refresh: vi.fn(async () => ({ accessToken: 'ya29.access', expiresIn: 3600 })),
    revoke: vi.fn(async (t: string) => { revoked.push(t); }),
  };
}
/** Like the real Drive client: asks for an access token before every call. */
function tokenAware(api: ReturnType<typeof fakeDrive>, getToken: () => Promise<string>) {
  return new Proxy(api, {
    get(t, prop, r) {
      const v = Reflect.get(t, prop, r);
      return typeof v === 'function' ? async (...a: unknown[]) => { await getToken(); return (v as (...x: unknown[]) => unknown).apply(t, a); } : v;
    },
  });
}
const GOOGLE = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret' };
const pdf = (s = '%PDF-1.4') => Buffer.from(s).toString('base64');
async function connected() {
  const oauth = fakeOAuth();
  const api = fakeDrive();
  const s = await withAdmin(GOOGLE, { googleOAuth: oauth, driveApi: (getToken) => tokenAware(api, getToken) });
  const go = await s.admin.get('/api/drive/connect');
  const state = new URL(String(go.headers.location)).searchParams.get('state')!;
  const cb = await s.app.inject({ method: 'GET', url: `/api/drive/callback?code=good-code&state=${state}` });
  return { ...s, oauth, api, cb };
}

describe('company Google Drive', () => {
  it('encrypts the token', () => {
    const key = Buffer.alloc(32, 9);
    const blob = encryptToken(key, 'REFRESH-TOKEN-XYZ');
    expect(blob).not.toContain('REFRESH');
    expect(decryptToken(key, blob)).toBe('REFRESH-TOKEN-XYZ');
    expect(() => decryptToken(Buffer.alloc(32, 1), blob)).toThrow();
    expect(encryptToken(key, 'same')).not.toBe(encryptToken(key, 'same'));
  });

  it('connect stores the token encrypted and redirects back to Settings', async () => {
    const s = await connected();
    expect([s.cb.statusCode, s.cb.headers.location]).toEqual([302, '/#/settings']);
    const stored = JSON.stringify(s.store.getMetaSync('drive-token'));
    expect(stored).not.toContain('REFRESH-TOKEN-XYZ');
    expect((await s.admin.get('/api/drive/status')).json()).toEqual({ connected: true, email: 'owner@saomai.vn' });
    const acts = (await s.admin.get('/api/activity')).json().items.map((i: { action: string }) => i.action);
    expect(acts).toContain('drive-connect');
  });

  it('callback checks state', async () => {
    const oauth = fakeOAuth();
    const s = await withAdmin(GOOGLE, { googleOAuth: oauth, driveApi: () => fakeDrive() });
    const bad = await s.app.inject({ method: 'GET', url: '/api/drive/callback?code=good-code&state=forged' });
    expect(bad.statusCode).toBe(400);
    const go = await s.admin.get('/api/drive/connect');
    const state = new URL(String(go.headers.location)).searchParams.get('state')!;
    s.clock.now = new Date(s.clock.now.getTime() + 11 * 60 * 1000);
    expect((await s.app.inject({ method: 'GET', url: `/api/drive/callback?code=good-code&state=${state}` })).statusCode).toBe(400);
    expect(s.store.getMetaSync('drive-token')).toBeUndefined();
    expect(oauth.exchange).not.toHaveBeenCalled();
  });

  it('non-admin cannot connect or disconnect', async () => {
    const s = await withAdmin({}, { googleOAuth: fakeOAuth(), driveApi: () => fakeDrive() });
    const lan = await addUser(s, 'lan', 'manager');
    expect((await lan.client.get('/api/drive/connect')).statusCode).toBe(403);
    expect((await lan.client.post('/api/drive/disconnect')).statusCode).toBe(403);
    expect((await lan.client.get('/api/drive/status')).statusCode).toBe(200);
  });

  it('upload creates then updates the same file; status saved on the bill', async () => {
    const s = await connected();
    await s.admin.put('/api/bills/b1', sampleBill({ id: 'b1', status: 'sent' }));
    const body = { target: { type: 'bill', id: 'b1' }, field: 'drive', fileName: 'TT-2026-0012.pdf', folders: ['Phiếu thanh toán', '2026', 'Hoa Sen Xanh'], mimeType: 'application/pdf', dataBase64: pdf() };
    const first = (await s.admin.post('/api/drive/upload', body)).json();
    const second = (await s.admin.post('/api/drive/upload', body)).json();
    expect(first).toMatchObject({ error: null });
    expect(second.fileId).toBe(first.fileId);
    expect(s.api.calls.filter((c) => /^(create|update)File/.test(c))).toEqual(['createFile TT-2026-0012.pdf', `updateFile ${first.fileId}`]);
    expect((await s.admin.get('/api/bills/b1')).json().drive).toEqual(second);
    expect(s.oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it('report and statement uploads record meta statuses', async () => {
    const s = await connected();
    const base = { mimeType: 'application/pdf', dataBase64: pdf(), folders: ['Phiếu thanh toán', 'Báo cáo', '2026'] };
    const r = (await s.admin.post('/api/drive/upload', { ...base, target: { type: 'report', id: 'Báo cáo 2026-09.xlsx' }, fileName: 'Báo cáo 2026-09.xlsx' })).json();
    expect(s.store.getMetaSync('report-drive:Báo cáo 2026-09.xlsx')).toEqual(r);
    const st = (await s.admin.post('/api/drive/upload', { ...base, target: { type: 'statement', id: 'c1/Đối chiếu X 2026.pdf' }, fileName: 'Đối chiếu X 2026.pdf' })).json();
    expect(s.store.getMetaSync('statement-drive:c1/Đối chiếu X 2026.pdf')).toEqual(st);
  });

  it('connect needs the Google client settings', async () => {
    const s = await withAdmin({}, { googleOAuth: fakeOAuth(), driveApi: () => fakeDrive() });
    expect((await s.admin.get('/api/drive/connect')).json().messages).toEqual(['Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server settings first']);
  });

  it('upload without a connection', async () => {
    const s = await withAdmin({}, { googleOAuth: fakeOAuth(), driveApi: () => fakeDrive() });
    const r = await s.admin.post('/api/drive/upload', { target: { type: 'report', id: 'x.xlsx' }, fileName: 'x.xlsx', folders: ['a'], mimeType: 'x', dataBase64: pdf() });
    expect([r.statusCode, r.json().message]).toEqual([409, "Google Drive isn't connected — ask the Admin"]);
  });

  it('disconnect revokes and forgets the token', async () => {
    const s = await connected();
    expect((await s.admin.post('/api/drive/disconnect')).statusCode).toBe(200);
    expect(s.oauth.revoked).toEqual(['REFRESH-TOKEN-XYZ']);
    expect(s.store.getMetaSync('drive-token')).toBeUndefined();
    expect((await s.admin.get('/api/drive/status')).json()).toEqual({ connected: false, email: null });
  });

  it('refused Google token is reported, not thrown', async () => {
    const s = await connected();
    (s.oauth.refresh as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('invalid_grant'));
    const r = await s.admin.post('/api/drive/upload', { target: { type: 'report', id: 'y.xlsx' }, fileName: 'y.xlsx', folders: ['a'], mimeType: 'x', dataBase64: pdf() });
    expect(r.json()).toMatchObject({ error: 'Google access expired — the Admin must reconnect Google Drive' });
  });
});
void makeServer;
