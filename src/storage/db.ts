import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Bill, Contract, Customer, DocKind, DocTemplate, Service, Settings } from '../domain/types';
import { normalizeSettings } from '../domain/settings';

export interface AppSchema extends DBSchema {
  customers: { key: string; value: Customer };
  services: { key: string; value: Service };
  bills: { key: string; value: Bill; indexes: { byCustomer: string } };
  settings: { key: string; value: Settings };
  meta: { key: string; value: unknown };
  contracts: { key: string; value: Contract; indexes: { byCustomer: string; byParent: string } };
  templates: { key: string; value: DocTemplate };
}

export type AppDb = IDBPDatabase<AppSchema>;

/**
 * Opens (and upgrades) the app database. Version 2 adds `contracts`, version 3 `templates`; existing data is untouched.
 * `onBlocked` runs when another open tab still uses the old version and holds up the upgrade.
 */
export function openAppDb(name = 'payment-bills', opts: { onBlocked?: () => void } = {}): Promise<AppDb> {
  return openDB<AppSchema>(name, 3, {
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
}

export const newId = (): string => crypto.randomUUID();

export const listCustomers = (db: AppDb) => db.getAll('customers');
export const putCustomer = (db: AppDb, c: Customer) => db.put('customers', c);

export async function deleteOrArchiveCustomer(db: AppDb, id: string): Promise<'deleted' | 'archived'> {
  const tx = db.transaction(['customers', 'bills', 'contracts'], 'readwrite');
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

export const listServices = (db: AppDb) => db.getAll('services');
export const putService = (db: AppDb, s: Service) => db.put('services', s);

export async function listBills(db: AppDb): Promise<Bill[]> {
  const all = await db.getAll('bills');
  return all.sort((a, b) => b.billDate.localeCompare(a.billDate) || b.number.localeCompare(a.number));
}
export const getBill = (db: AppDb, id: string) => db.get('bills', id);
export const putBill = (db: AppDb, b: Bill) => db.put('bills', b);

export async function getSettings(db: AppDb): Promise<Settings> {
  const stored = await db.get('settings', 'settings');
  return normalizeSettings(stored as Record<string, unknown> | undefined);
}
export const putSettings = (db: AppDb, s: Settings) => db.put('settings', s, 'settings');

export async function getMeta<T>(db: AppDb, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}
export const setMeta = (db: AppDb, key: string, value: unknown) => db.put('meta', value, key);

export const listContracts = (db: AppDb) => db.getAll('contracts');
export const getContract = (db: AppDb, id: string) => db.get('contracts', id);
export const putContract = (db: AppDb, c: Contract) => db.put('contracts', c);

/** Deletes a contract only when it has no addenda and no bills; otherwise it must be terminated instead. */
export async function deleteContract(db: AppDb, id: string): Promise<'deleted' | 'refused'> {
  const tx = db.transaction(['contracts', 'bills'], 'readwrite');
  const hasAddenda = (await tx.objectStore('contracts').index('byParent').count(id)) > 0;
  const hasBills = (await tx.objectStore('bills').getAll()).some((b) => b.contractRef?.contractId === id);
  if (!hasAddenda && !hasBills) await tx.objectStore('contracts').delete(id);
  await tx.done;
  return hasAddenda || hasBills ? 'refused' : 'deleted';
}

export const listTemplates = (db: AppDb) => db.getAll('templates');

/** Saves a template; a default contract template clears the other contract templates' default. */
export async function putTemplate(db: AppDb, t: DocTemplate): Promise<void> {
  const tx = db.transaction('templates', 'readwrite');
  if (t.kind === 'contract' && t.isDefault) {
    for (const other of await tx.store.getAll()) {
      if (other.kind === 'contract' && other.id !== t.id && other.isDefault) await tx.store.put({ ...other, isDefault: false });
    }
  }
  await tx.store.put(t);
  await tx.done;
}

/**
 * Removes a template. Contracts that used it go back to the default; when the default contract template
 * is removed, the oldest remaining contract template becomes the default.
 */
export async function removeTemplate(db: AppDb, id: string): Promise<{ contractsReset: number }> {
  const tx = db.transaction(['templates', 'contracts'], 'readwrite');
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

/** The template to use: for contracts the chosen one (if it still exists) else the default; else the one of that kind. */
export async function templateFor(db: AppDb, kind: DocKind, templateId?: string | null): Promise<DocTemplate | null> {
  const all = (await db.getAll('templates')).filter((t) => t.kind === kind).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  if (kind !== 'contract') return all[0] ?? null;
  return all.find((t) => t.id === templateId) ?? all.find((t) => t.isDefault) ?? all[0] ?? null;
}
