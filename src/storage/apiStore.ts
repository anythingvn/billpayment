import type { Bill, Contract, Customer, DocKind, DocTemplate, DriveStatus, Service, Settings } from '../domain/types';
import type { Store } from './store';
import type { BackupData, BackupTemplate } from './backup';
import { base64ToBytes, bytesToBase64 } from './backup';
import type { IdbStore } from './idbStore';
import { openCache } from './cache';
import { ConflictError, ForbiddenError, InvalidError, OfflineError, ServerError, SignInError } from './errors';

/** The server counts as unreachable after 8 s. */
export const TIMEOUT_MS = 8000;
const LAST_UPDATED = '__lastUpdated';
type Status = 'online' | 'offline';

export interface ApiStoreOptions {
  fetch?: typeof fetch;
  userId: string;
  /** Online after each successful read; offline (with the cache's time) when the server can't be reached. */
  onStatus: (status: Status, lastUpdated?: string) => void;
  /** For tests; default TIMEOUT_MS. */
  timeoutMs?: number;
}

const toBuffer = (b64: string) => {
  const u = base64ToBytes(b64);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const fromWire = ({ dataBase64, ...t }: BackupTemplate): DocTemplate => ({ ...t, data: toBuffer(dataBase64) });

/** Same rules as IdbStore.templateFor. */
function chooseTemplate(all: DocTemplate[], kind: DocKind, templateId?: string | null): DocTemplate | null {
  const list = all.filter((t) => t.kind === kind).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  if (kind !== 'contract') return list[0] ?? null;
  return list.find((t) => t.id === templateId) ?? list.find((t) => t.isDefault) ?? list[0] ?? null;
}

/**
 * The Store backed by the server (/api). Reads refresh a per-user IndexedDB copy and fall back to it when the server
 * can't be reached (offline viewing). Writes need the server and fail loudly otherwise.
 */
export class ApiStore implements Store {
  private readonly f: typeof fetch;
  private cache: Promise<IdbStore>;

  constructor(private opts: ApiStoreOptions) {
    this.f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.cache = openCache(opts.userId);
  }

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const write = method !== 'GET';
    if (write && typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.f(url, {
        method, credentials: 'same-origin', signal: ctl.signal,
        headers: { 'X-Requested-With': 'billpayment', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new OfflineError();
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new SignInError();
    if (res.status === 403) {
      // A temporary password must be changed first: treated like a new sign-in (which leads to Change password).
      if (((await res.clone().json().catch(() => ({}))) as { error?: string }).error === 'password-change') throw new SignInError();
      throw new ForbiddenError();
    }
    if (res.status === 409) throw new ConflictError();
    if (res.status === 422) throw new InvalidError(((await res.json().catch(() => ({}))) as { messages?: string[] }).messages ?? []);
    if (res.status === 404 && method === 'GET') return undefined as T;
    if (!res.ok) throw new ServerError();
    return (await res.json()) as T;
  }

  /** A read: from the server (then saved to the offline copy), or from the offline copy when unreachable. */
  private async read<T>(url: string, save: (c: IdbStore, value: T) => Promise<void>, fallback: (c: IdbStore) => Promise<T>): Promise<T> {
    const cache = await this.cache;
    try {
      const value = await this.call<T>('GET', url);
      await save(cache, value);
      await cache.setMeta(LAST_UPDATED, new Date().toISOString());
      this.opts.onStatus('online', undefined);
      return value;
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      this.opts.onStatus('offline', await cache.getMeta<string>(LAST_UPDATED));
      return fallback(cache);
    }
  }

  /** Replaces one object store of the offline copy with the server's list. */
  private replaceAll<K extends 'customers' | 'services' | 'bills' | 'contracts' | 'templates'>(name: K) {
    return async (c: IdbStore, list: unknown[]) => {
      const tx = c.idb.transaction(name, 'readwrite');
      await tx.store.clear();
      for (const item of list) await tx.store.put(item as never);
      await tx.done;
    };
  }

  listCustomers() { return this.read<Customer[]>('/api/customers', this.replaceAll('customers'), (c) => c.listCustomers()); }
  async putCustomer(c: Customer) { const r = await this.call<Customer>('PUT', `/api/customers/${enc(c.id)}`, c); await (await this.cache).putCustomer(r); return r; }
  async deleteOrArchiveCustomer(id: string) { return (await this.call<{ result: 'deleted' | 'archived' }>('DELETE', `/api/customers/${enc(id)}`)).result; }

  listServices() { return this.read<Service[]>('/api/services', this.replaceAll('services'), (c) => c.listServices()); }
  async putService(s: Service) { const r = await this.call<Service>('PUT', `/api/services/${enc(s.id)}`, s); await (await this.cache).putService(r); return r; }

  listBills() { return this.read<Bill[]>('/api/bills', this.replaceAll('bills'), (c) => c.listBills()); }
  getBill(id: string) {
    return this.read<Bill | undefined>(`/api/bills/${enc(id)}`, async (c, b) => { if (b) await c.putBill(b); }, (c) => c.getBill(id));
  }
  async putBill(b: Bill) { const r = await this.call<Bill>('PUT', `/api/bills/${enc(b.id)}`, b); await (await this.cache).putBill(r); return r; }

  listContracts() { return this.read<Contract[]>('/api/contracts', this.replaceAll('contracts'), (c) => c.listContracts()); }
  getContract(id: string) {
    return this.read<Contract | undefined>(`/api/contracts/${enc(id)}`, async (c, k) => { if (k) await c.putContract(k); }, (c) => c.getContract(id));
  }
  async putContract(k: Contract) { const r = await this.call<Contract>('PUT', `/api/contracts/${enc(k.id)}`, k); await (await this.cache).putContract(r); return r; }
  async deleteContract(id: string) { return (await this.call<{ result: 'deleted' | 'refused' }>('DELETE', `/api/contracts/${enc(id)}`)).result; }

  async listTemplates(): Promise<DocTemplate[]> {
    return this.read<DocTemplate[]>('/api/templates', async (c, list) => this.replaceAll('templates')(c, list), (c) => c.listTemplates())
      .then((list) => list.map((t) => ('dataBase64' in t ? fromWire(t as unknown as BackupTemplate) : t)));
  }
  async putTemplate(t: DocTemplate) {
    const { data, ...meta } = t;
    await this.call('PUT', `/api/templates/${enc(t.id)}`, { ...meta, dataBase64: bytesToBase64(data) });
  }
  async removeTemplate(id: string) { return this.call<{ contractsReset: number }>('DELETE', `/api/templates/${enc(id)}`); }
  async templateFor(kind: DocKind, templateId?: string | null) { return chooseTemplate(await this.listTemplates(), kind, templateId); }

  getSettings() {
    return this.read<Settings>('/api/settings', async (c, s) => c.putSettings(s), (c) => c.getSettings());
  }
  async putSettings(s: Settings) { const r = await this.call<Settings>('PUT', '/api/settings', s); await (await this.cache).putSettings(r); }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const r = await this.read<{ value: T | null } | undefined>(`/api/meta/${enc(key)}`,
      async (c, v) => { if (v) await c.setMeta(key, v.value); }, async (c) => ({ value: (await c.getMeta<T>(key)) ?? null }));
    return r?.value ?? undefined;
  }
  async setMeta(key: string, value: unknown) { await this.call('PUT', `/api/meta/${enc(key)}`, { value }); await (await this.cache).setMeta(key, value); }

  async nextCounter(key: string) { return (await this.call<{ value: number }>('POST', `/api/counters/${enc(key)}`)).value; }

  /**
   * On a server, Drive status is recorded by the server itself when it uploads (users can't change it), so this only
   * works out the new status from the current record without saving anything.
   */
  async updateDriveStatus(target: { type: 'bill' | 'contract'; id: string }, field: 'drive' | 'driveDocx', make: (prev: DriveStatus | undefined) => DriveStatus) {
    if (target.type === 'bill') return make((await this.getBill(target.id))?.[field]);
    return make((await this.getContract(target.id))?.drive);
  }

  async exportAll(nowIso: string): Promise<BackupData> {
    const { users: _u, activity: _a, ...data } = await this.call<BackupData & { users?: unknown; activity?: unknown }>('GET', '/api/backup');
    return { ...data, exportedAt: nowIso };
  }
  async restoreAll(data: BackupData) { await this.call('POST', '/api/restore', { confirm: 'RESTORE', data }); }
}

const enc = encodeURIComponent;
