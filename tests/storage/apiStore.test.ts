import 'fake-indexeddb/auto';
import { ApiStore, TIMEOUT_MS } from '../../src/storage/apiStore';
import { OfflineError, SignInError, ConflictError, InvalidError, ServerError } from '../../src/storage/errors';
import { clearCache } from '../../src/storage/cache';
import { sampleBill } from '../fixtures';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
let n = 0;
function fakeFetch(handler: (c: Call) => Response | Promise<Response> | 'network' | 'hang') {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const r = await handler(call);
    if (r === 'network') throw new TypeError('Failed to fetch');
    if (r === 'hang') return new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    return r;
  });
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const bill = sampleBill({ id: 'b1', status: 'sent' });
const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });
afterEach(() => { setOnline(true); });

describe('ApiStore', () => {
  it('reads go to the API and fill the cache', async () => {
    const userId = `u${n++}`;
    const f = fakeFetch(() => json([{ ...bill, version: 3 }]));
    const onStatus = vi.fn();
    const store = new ApiStore({ fetch: f.fn as unknown as typeof fetch, userId, onStatus });
    expect((await store.listBills()).map((b) => [b.id, b.version])).toEqual([['b1', 3]]);
    expect(f.calls[0]).toMatchObject({ url: '/api/bills', method: 'GET' });
    expect(onStatus).toHaveBeenLastCalledWith('online', undefined);
    const offline = new ApiStore({ fetch: fakeFetch(() => 'network').fn as unknown as typeof fetch, userId, onStatus });
    expect((await offline.listBills()).map((b) => b.id)).toEqual(['b1']);
    expect(onStatus).toHaveBeenLastCalledWith('offline', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect((await offline.getBill('b1'))?.id).toBe('b1');
  });

  it('falls back to empty data when nothing is cached', async () => {
    const store = new ApiStore({ fetch: fakeFetch(() => 'network').fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    expect(await store.listCustomers()).toEqual([]);
    expect((await store.getSettings()).businessName).toBeDefined();
  });

  it('offline write throws OfflineError without calling the server', async () => {
    setOnline(false);
    const f = fakeFetch(() => json({}));
    const store = new ApiStore({ fetch: f.fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    await expect(store.putBill(bill)).rejects.toBeInstanceOf(OfflineError);
    expect(f.calls).toHaveLength(0);
    setOnline(true);
    const down = new ApiStore({ fetch: fakeFetch(() => 'network').fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    await expect(down.putBill(bill)).rejects.toBeInstanceOf(OfflineError);
  });

  it('maps statuses', async () => {
    const make = (status: number, body: unknown) => new ApiStore({ fetch: fakeFetch(() => json(body, status)).fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    await expect(make(401, { error: 'signin' }).putBill(bill)).rejects.toBeInstanceOf(SignInError);
    await expect(make(409, { error: 'conflict' }).putBill(bill)).rejects.toBeInstanceOf(ConflictError);
    const inv = make(422, { error: 'invalid', messages: ['Line 1: bad'] }).putBill(bill);
    await expect(inv).rejects.toBeInstanceOf(InvalidError);
    await expect(inv).rejects.toMatchObject({ messages: ['Line 1: bad'] });
    await expect(make(500, { error: 'server' }).putBill(bill)).rejects.toBeInstanceOf(ServerError);
    await expect(make(401, { error: 'signin' }).listBills()).rejects.toBeInstanceOf(SignInError);
  });

  it('times out after 8 s', async () => {
    expect(TIMEOUT_MS).toBe(8000);
    const onStatus = vi.fn();
    const store = new ApiStore({ fetch: fakeFetch(() => 'hang').fn as unknown as typeof fetch, userId: `u${n++}`, onStatus, timeoutMs: 30 });
    expect(await store.listCustomers()).toEqual([]);
    expect(onStatus).toHaveBeenLastCalledWith('offline', undefined);
  });

  it('sends the CSRF header and the version on writes; returns the saved record', async () => {
    const f = fakeFetch((c) => json({ ...JSON.parse(c.body!), version: 4 }));
    const store = new ApiStore({ fetch: f.fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    const saved = await store.putBill({ ...bill, version: 3 });
    expect(saved.version).toBe(4);
    expect(f.calls[0]).toMatchObject({ url: '/api/bills/b1', method: 'PUT' });
    expect(f.calls[0].headers['X-Requested-With']).toBe('billpayment');
    expect(JSON.parse(f.calls[0].body!).version).toBe(3);
    await store.nextCounter('counter-2026').catch(() => undefined);
    expect(f.calls[1]).toMatchObject({ url: '/api/counters/counter-2026', method: 'POST' });
  });

  it('templates carry their bytes; templateFor applies the default rules', async () => {
    const data = Buffer.from([0x50, 0x4b, 1]).toString('base64');
    const f = fakeFetch(() => json([
      { id: 'A', kind: 'contract', name: 'A', fileName: 'a', uploadedAt: '2026-01-01', isDefault: false, dataBase64: data },
      { id: 'B', kind: 'contract', name: 'B', fileName: 'b', uploadedAt: '2026-02-01', isDefault: true, dataBase64: data },
    ]));
    const store = new ApiStore({ fetch: f.fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    expect((await store.templateFor('contract', null))?.id).toBe('B');
    expect((await store.templateFor('contract', 'A'))?.id).toBe('A');
    expect([...new Uint8Array((await store.listTemplates())[0].data)]).toEqual([0x50, 0x4b, 1]);
  });

  it('the cache is per user and cleared', async () => {
    const userId = `u${n++}`;
    await new ApiStore({ fetch: fakeFetch(() => json([bill])).fn as unknown as typeof fetch, userId, onStatus: vi.fn() }).listBills();
    const other = new ApiStore({ fetch: fakeFetch(() => 'network').fn as unknown as typeof fetch, userId: `u${n++}`, onStatus: vi.fn() });
    expect(await other.listBills()).toEqual([]);
    await clearCache(userId);
    const same = new ApiStore({ fetch: fakeFetch(() => 'network').fn as unknown as typeof fetch, userId, onStatus: vi.fn() });
    expect(await same.listBills()).toEqual([]);
  });
});
