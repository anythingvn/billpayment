import { detectServer } from '../src/serverMode';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
const ok = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const down = async () => new Response('Bad gateway', { status: 502 });
const gone = async () => { throw new TypeError('Failed to fetch'); };
const pages404 = async () => new Response('<html>404</html>', { status: 404 });

describe('detectServer (I3)', () => {
  it('remembers a server origin, and stays in server mode when it is down or unreachable', async () => {
    const st = memory();
    expect(await detectServer(ok as unknown as typeof fetch, st)).toBe(true);
    expect(await detectServer(down as unknown as typeof fetch, st)).toBe(true);
    expect(await detectServer(gone as unknown as typeof fetch, st)).toBe(true);
  });
  it('a static host (GitHub Pages) stays the single-user app', async () => {
    const st = memory();
    expect(await detectServer(pages404 as unknown as typeof fetch, st)).toBe(false);
    expect(await detectServer(gone as unknown as typeof fetch, st)).toBe(false);
  });
});
