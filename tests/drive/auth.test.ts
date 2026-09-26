import { createDriveAuth, DRIVE_SCOPE, type Gis } from '../../src/drive/auth';

type Reply = { access_token?: string; expires_in?: number; error?: string } | { popup: string };
function fakeGis(replies: Reply[]) {
  const prompts: string[] = [];
  const configs: Parameters<Gis['initTokenClient']>[0][] = [];
  const revoked: string[] = [];
  const gis: Gis = {
    initTokenClient(cfg) {
      configs.push(cfg);
      return {
        requestAccessToken(o) {
          prompts.push(o.prompt);
          const r = replies.shift() ?? { access_token: 'tok', expires_in: 3600 };
          queueMicrotask(() => ('popup' in r ? cfg.error_callback?.({ type: r.popup }) : cfg.callback(r)));
        },
      };
    },
    revoke(token, done) { revoked.push(token); done(); },
  };
  return { gis, prompts, configs, revoked };
}

describe('Drive sign-in', () => {
  it('requests the drive.file scope with consent the first time', async () => {
    const f = fakeGis([]);
    await createDriveAuth('cid', { gis: async () => f.gis, wasConnected: false }).getToken();
    expect(f.configs[0]).toMatchObject({ client_id: 'cid', scope: DRIVE_SCOPE });
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(f.prompts).toEqual(['consent']);
    const g = fakeGis([]);
    await createDriveAuth('cid', { gis: async () => g.gis, wasConnected: true }).getToken();
    expect(g.prompts).toEqual(['']);
  });
  it('reuses a token until 60 s before expiry', async () => {
    let now = 1_000_000;
    const f = fakeGis([{ access_token: 'A', expires_in: 3600 }, { access_token: 'B', expires_in: 3600 }]);
    const auth = createDriveAuth('cid', { gis: async () => f.gis, wasConnected: true, now: () => now });
    expect(await auth.getToken()).toBe('A');
    now += 3500_000;
    expect(await auth.getToken()).toBe('A');
    now += 41_000;
    expect(await auth.getToken()).toBe('B');
    expect(f.prompts).toHaveLength(2);
  });
  it('refresh forces a new request', async () => {
    const f = fakeGis([{ access_token: 'A', expires_in: 3600 }, { access_token: 'B', expires_in: 3600 }]);
    const auth = createDriveAuth('cid', { gis: async () => f.gis, wasConnected: true });
    await auth.getToken();
    expect(await auth.getToken({ refresh: true })).toBe('B');
  });
  it('rejects when the user closes the popup or denies access', async () => {
    const closed = fakeGis([{ popup: 'popup_closed' }]);
    await expect(createDriveAuth('cid', { gis: async () => closed.gis, wasConnected: false }).getToken()).rejects.toMatchObject({ kind: 'auth' });
    const denied = fakeGis([{ error: 'access_denied' }]);
    await expect(createDriveAuth('cid', { gis: async () => denied.gis, wasConnected: false }).getToken()).rejects.toMatchObject({ kind: 'auth' });
  });
  it('explains an unregistered address', async () => {
    const f = fakeGis([{ error: 'idpiframe_initialization_failed: Not a valid origin for the client' }]);
    const e = await createDriveAuth('cid', { gis: async () => f.gis, wasConnected: false }).getToken().catch((x) => x);
    expect(e.kind).toBe('origin');
    expect(e.message).toContain(location.origin);
  });
  it('revoke clears the token', async () => {
    const f = fakeGis([{ access_token: 'A', expires_in: 3600 }, { access_token: 'B', expires_in: 3600 }]);
    const auth = createDriveAuth('cid', { gis: async () => f.gis, wasConnected: true });
    await auth.getToken();
    await auth.revoke();
    expect(f.revoked).toEqual(['A']);
    expect(await auth.getToken()).toBe('B');
  });
});
