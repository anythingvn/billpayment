import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Bill, Contract, Customer, Service, Settings } from '../domain/types';
import { normalizeSettings } from '../domain/settings';

export interface AppSchema extends DBSchema {
  customers: { key: string; value: Customer };
  services: { key: string; value: Service };
  bills: { key: string; value: Bill; indexes: { byCustomer: string } };
  settings: { key: string; value: Settings };
  meta: { key: string; value: unknown };
  contracts: { key: string; value: Contract; indexes: { byCustomer: string; byParent: string } };
}

export type AppDb = IDBPDatabase<AppSchema>;

/**
 * Opens (and upgrades) the app database. Version 2 adds the `contracts` store; existing data is untouched.
 * `onBlocked` runs when another open tab still uses the old version and holds up the upgrade.
 */
export function openAppDb(name = 'payment-bills', opts: { onBlocked?: () => void } = {}): Promise<AppDb> {
  return openDB<AppSchema>(name, 2, {
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
