import type { ServerDriveClient } from './service';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'billpayment', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Offline');
  }
  const json = (await res.json().catch(() => ({}))) as { message?: string; messages?: string[] };
  if (res.status === 401) throw new Error('Please sign in again');
  if (!res.ok) throw new Error(json.message ?? json.messages?.join(' ') ?? 'Something went wrong on the server');
  return json as T;
}

/** The company Drive on this app's server. */
export const serverDriveClient: ServerDriveClient = {
  status: () => call('GET', '/api/drive/status'),
  upload: (body) => call('POST', '/api/drive/upload', body),
  disconnect: async () => { await call('POST', '/api/drive/disconnect'); },
};
