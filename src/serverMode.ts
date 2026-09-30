const SERVER_FLAG = 'bp-server';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/**
 * Where the data lives. Once this address has answered as the company server it is remembered for good, so a server
 * that is updating (502) or unreachable never opens the empty single-user app in its place. A static host
 * (GitHub Pages) that never had a server keeps the single-user app.
 */
export async function detectServer(fetchFn: typeof fetch = fetch, storage: Storage | null = safeStorage()): Promise<boolean> {
  const known = storage?.getItem(SERVER_FLAG) === '1';
  try {
    const r = await fetchFn('/api/health', { credentials: 'same-origin' });
    const ok = r.ok && ((await r.json().catch(() => null)) as { ok?: boolean } | null)?.ok === true;
    if (ok) {
      try { storage?.setItem(SERVER_FLAG, '1'); } catch { /* private mode */ }
      return true;
    }
    return known;
  } catch {
    return known;
  }
}

function safeStorage(): Storage | null {
  try { return localStorage; } catch { return null; }
}
