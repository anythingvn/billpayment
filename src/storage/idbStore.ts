import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Bill, Contract, Customer, DocKind, DocTemplate, DriveStatus, Service, Settings } from '../domain/types';
import { normalizeSettings } from '../domain/settings';
import type { Store } from './store';
import { base64ToBytes, bytesToBase64, type BackupData } from './backup';

export interface AppSchema extends DBSchema {
  customers: { key: string; value: Customer };
  services: { key: string; value: Service };
  bills: { key: string; value: Bill; indexes: { byCustomer: string } };
  settings: { key: string; value: Settings };
  meta: { key: string; value: unknown };
  contracts: { key: string; value: Contract; indexes: { byCustomer: string; byParent: string } };
  templates: { key: string; value: DocTemplate };
}

const REPORT_DRIVE = 'report-drive:';
const STATEMENT_DRIVE = 'statement-drive:';
/** Device-only facts that survive a restore: last backup time and this device's Google Drive connection/folders. */
const DEVICE_META = ['lastBackupAt', 'driveConnected', 'driveFolders'];

/**
 * Opens (and upgrades) an IndexedDB database. Version 2 adds `contracts`, version 3 `templates`; existing data is untouched.
 * `onBlocked` runs when another open tab still uses the old version and holds up the upgrade.
 */
export async function openIdbStore(name = 'payment-bills', opts: { onBlocked?: () => void } = {}): Promise<IdbStore> {
  const idb = await openDB<AppSchema>(name, 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('customers', { keyPath: 'id' });
        db.createObjectStore('services', { keyPath: 'id' });
        const bills = db.createObjectStore('bills', { keyPath: 'id' });
        bills.createIndex('byCustomer', 'customerId');
        db.createObjectStore('settings');
        db.createObjectStore('meta');
      }
      if (oldVersion < 2) {
        const contracts = db.createObjectStore('contracts', { keyPath: 'id' });
        contracts.createIndex('byCustomer', 'customerId');
        contracts.createIndex('byParent', 'parentId');
      }
      if (oldVersion < 3) db.createObjectStore('templates', { keyPath: 'id' });
    },
    blocked() {
      opts.onBlocked?.();
    },
    // A newer version of the app (another tab) needs to upgrade: let go and reload into the new version.
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
      try {
        if (typeof location !== 'undefined' && !import.meta.env.VITEST) location.reload();
      } catch {
        /* nothing else to do */
      }
    },
  });
  return new IdbStore(idb);
}

/** The Store in this browser's IndexedDB. */
export class IdbStore implements Store {
  constructor(readonly idb: IDBPDatabase<AppSchema>) {}

  listCustomers() { return this.idb.getAll('customers'); }
  async putCustomer(c: Customer) { await this.idb.put('customers', c); return c; }

  async deleteOrArchiveCustomer(id: string): Promise<'deleted' | 'archived'> {
    const tx = this.idb.transaction(['customers', 'bills', 'contracts'], 'readwrite');
    const used = (await tx.objectStore('bills').index('byCustomer').count(id)) > 0
      || (await tx.objectStore('contracts').index('byCustomer').count(id)) > 0;
    const store = tx.objectStore('customers');
    if (used) {
      const c = await store.get(id);
      if (c) await store.put({ ...c, archived: true });
    } else {
      await store.delete(id);
    }
    await tx.done;
    return used ? 'archived' : 'deleted';
  }

  listServices() { return this.idb.getAll('services'); }
  async putService(s: Service) { await this.idb.put('services', s); return s; }

  async listBills(): Promise<Bill[]> {
    const all = await this.idb.getAll('bills');
    return all.sort((a, b) => b.billDate.localeCompare(a.billDate) || b.number.localeCompare(a.number));
  }
  getBill(id: string) { return this.idb.get('bills', id); }
  async putBill(b: Bill) { await this.idb.put('bills', b); return b; }

  async getSettings(): Promise<Settings> {
    const stored = await this.idb.get('settings', 'settings');
    return normalizeSettings(stored as Record<string, unknown> | undefined);
  }
  async putSettings(s: Settings) { await this.idb.put('settings', s, 'settings'); }

  async getMeta<T>(key: string): Promise<T | undefined> { return (await this.idb.get('meta', key)) as T | undefined; }
  async setMeta(key: string, value: unknown) { await this.idb.put('meta', value, key); }

  async nextCounter(key: string): Promise<number> {
    const tx = this.idb.transaction('meta', 'readwrite');
    const next = (((await tx.store.get(key)) as number | undefined) ?? 0) + 1;
    await tx.store.put(next, key);
    await tx.done;
    return next;
  }

  listContracts() { return this.idb.getAll('contracts'); }
  getContract(id: string) { return this.idb.get('contracts', id); }
  async putContract(c: Contract) { await this.idb.put('contracts', c); return c; }

  async deleteContract(id: string): Promise<'deleted' | 'refused'> {
    const tx = this.idb.transaction(['contracts', 'bills'], 'readwrite');
    const hasAddenda = (await tx.objectStore('contracts').index('byParent').count(id)) > 0;
    const hasBills = (await tx.objectStore('bills').getAll()).some((b) => b.contractRef?.contractId === id);
    if (!hasAddenda && !hasBills) await tx.objectStore('contracts').delete(id);
    await tx.done;
    return hasAddenda || hasBills ? 'refused' : 'deleted';
  }

  listTemplates() { return this.idb.getAll('templates'); }

  async putTemplate(t: DocTemplate): Promise<void> {
    const tx = this.idb.transaction('templates', 'readwrite');
    if (t.kind === 'contract' && t.isDefault) {
      for (const other of await tx.store.getAll()) {
        if (other.kind === 'contract' && other.id !== t.id && other.isDefault) await tx.store.put({ ...other, isDefault: false });
      }
    }
    await tx.store.put(t);
    await tx.done;
  }

  async removeTemplate(id: string): Promise<{ contractsReset: number }> {
    const tx = this.idb.transaction(['templates', 'contracts'], 'readwrite');
    const templates = tx.objectStore('templates');
    const removed = await templates.get(id);
    await templates.delete(id);
    if (removed?.kind === 'contract' && removed.isDefault) {
      const oldest = (await templates.getAll()).filter((t) => t.kind === 'contract').sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))[0];
      if (oldest) await templates.put({ ...oldest, isDefault: true });
    }
    let contractsReset = 0;
    const contracts = tx.objectStore('contracts');
    for (const c of await contracts.getAll()) {
      if (c.templateId === id) {
        await contracts.put({ ...c, templateId: null });
        contractsReset++;
      }
    }
    await tx.done;
    return { contractsReset };
  }

  async templateFor(kind: DocKind, templateId?: string | null): Promise<DocTemplate | null> {
    const all = (await this.idb.getAll('templates')).filter((t) => t.kind === kind).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    if (kind !== 'contract') return all[0] ?? null;
    return all.find((t) => t.id === templateId) ?? all.find((t) => t.isDefault) ?? all[0] ?? null;
  }

  async updateDriveStatus(target: { type: 'bill' | 'contract'; id: string }, field: 'drive' | 'driveDocx', make: (prev: DriveStatus | undefined) => DriveStatus) {
    // Read and write in one transaction: the PDF and Word jobs of one bill update the same record.
    if (target.type === 'bill') {
      const tx = this.idb.transaction('bills', 'readwrite');
      const bill = await tx.store.get(target.id);
      const next = make(bill?.[field]);
      if (bill) await tx.store.put({ ...bill, [field]: next });
      await tx.done;
      return next;
    }
    const tx = this.idb.transaction('contracts', 'readwrite');
    const c = await tx.store.get(target.id);
    const next = make(c?.drive);
    if (c) await tx.store.put({ ...c, drive: next });
    await tx.done;
    return next;
  }

  async exportAll(nowIso: string): Promise<BackupData> {
    const counters: Record<string, number> = {};
    const reportDrive: Record<string, DriveStatus> = {};
    const statementDrive: Record<string, DriveStatus> = {};
    const tx = this.idb.transaction('meta');
    for (const key of await tx.store.getAllKeys()) {
      const k = String(key);
      if (/^(contract-)?counter-/.test(k)) counters[k] = (await tx.store.get(key)) as number;
      if (k.startsWith(REPORT_DRIVE)) reportDrive[k.slice(REPORT_DRIVE.length)] = (await tx.store.get(key)) as DriveStatus;
      if (k.startsWith(STATEMENT_DRIVE)) statementDrive[k.slice(STATEMENT_DRIVE.length)] = (await tx.store.get(key)) as DriveStatus;
    }
    await tx.done;
    return {
      app: 'payment-bills',
      schemaVersion: 1,
      exportedAt: nowIso,
      customers: await this.idb.getAll('customers'),
      services: await this.idb.getAll('services'),
      bills: await this.idb.getAll('bills'),
      contracts: await this.idb.getAll('contracts'),
      templates: (await this.idb.getAll('templates')).map(({ data, ...t }) => ({ ...t, dataBase64: bytesToBase64(data) })),
      settings: await this.getSettings(),
      counters,
      reportDrive,
      statementDrive,
    };
  }

  async restoreAll(data: BackupData): Promise<void> {
    const tx = this.idb.transaction(['customers', 'services', 'bills', 'settings', 'meta', 'contracts', 'templates'], 'readwrite');
    const meta = tx.objectStore('meta');
    const keep = await Promise.all(DEVICE_META.map(async (k) => [k, await meta.get(k)] as const));
    await Promise.all([
      tx.objectStore('customers').clear(),
      tx.objectStore('services').clear(),
      tx.objectStore('bills').clear(),
      tx.objectStore('contracts').clear(),
      tx.objectStore('templates').clear(),
      tx.objectStore('settings').clear(),
      meta.clear(),
    ]);
    for (const c of data.customers) await tx.objectStore('customers').put(c);
    for (const s of data.services) await tx.objectStore('services').put(s);
    for (const b of data.bills) await tx.objectStore('bills').put(b);
    for (const c of data.contracts) await tx.objectStore('contracts').put(c);
    for (const { dataBase64, ...t } of data.templates) {
      const bytes = base64ToBytes(dataBase64);
      await tx.objectStore('templates').put({ ...t, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
    }
    await tx.objectStore('settings').put(data.settings, 'settings');
    for (const [k, v] of Object.entries(data.counters)) await meta.put(v, k);
    for (const [name, status] of Object.entries(data.reportDrive)) await meta.put(status, `${REPORT_DRIVE}${name}`);
    for (const [name, status] of Object.entries(data.statementDrive)) await meta.put(status, `${STATEMENT_DRIVE}${name}`);
    for (const [k, v] of keep) if (v !== undefined) await meta.put(v, k);
    await tx.done;
  }
}
