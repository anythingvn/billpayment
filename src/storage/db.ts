import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Bill, type Customer, type Service, type Settings } from '../domain/types';

export interface AppSchema extends DBSchema {
  customers: { key: string; value: Customer };
  services: { key: string; value: Service };
  bills: { key: string; value: Bill; indexes: { byCustomer: string } };
  settings: { key: string; value: Settings };
  meta: { key: string; value: unknown };
}

export type AppDb = IDBPDatabase<AppSchema>;

export function openAppDb(name = 'payment-bills'): Promise<AppDb> {
  return openDB<AppSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('customers', { keyPath: 'id' });
      db.createObjectStore('services', { keyPath: 'id' });
      const bills = db.createObjectStore('bills', { keyPath: 'id' });
      bills.createIndex('byCustomer', 'customerId');
      db.createObjectStore('settings');
      db.createObjectStore('meta');
    },
  });
}

export const newId = (): string => crypto.randomUUID();

export const listCustomers = (db: AppDb) => db.getAll('customers');
export const putCustomer = (db: AppDb, c: Customer) => db.put('customers', c);

export async function deleteOrArchiveCustomer(db: AppDb, id: string): Promise<'deleted' | 'archived'> {
  const tx = db.transaction(['customers', 'bills'], 'readwrite');
  const used = (await tx.objectStore('bills').index('byCustomer').count(id)) > 0;
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
  return { ...DEFAULT_SETTINGS, ...stored };
}
export const putSettings = (db: AppDb, s: Settings) => db.put('settings', s, 'settings');

export async function getMeta<T>(db: AppDb, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}
export const setMeta = (db: AppDb, key: string, value: unknown) => db.put('meta', value, key);
