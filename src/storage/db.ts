import type { Bill, Contract, Customer, DocKind, DocTemplate, Service, Settings } from '../domain/types';
import type { Store } from './store';
import { openIdbStore, type IdbStore } from './idbStore';

export type { AppSchema } from './idbStore';
/** The app's data access. Screens pass it to the functions below; see Store for the implementations. */
export type AppDb = Store;

/** Opens this browser's IndexedDB store (tests, and the single-user app). */
export function openAppDb(name = 'payment-bills', opts: { onBlocked?: () => void } = {}): Promise<IdbStore> {
  return openIdbStore(name, opts);
}

export const newId = (): string => crypto.randomUUID();

export const listCustomers = (db: Store) => db.listCustomers();
export const putCustomer = (db: Store, c: Customer) => db.putCustomer(c);
export const deleteOrArchiveCustomer = (db: Store, id: string) => db.deleteOrArchiveCustomer(id);

export const listServices = (db: Store) => db.listServices();
export const putService = (db: Store, s: Service) => db.putService(s);

export const listBills = (db: Store): Promise<Bill[]> => db.listBills();
export const getBill = (db: Store, id: string) => db.getBill(id);
export const putBill = (db: Store, b: Bill) => db.putBill(b);

export const getSettings = (db: Store): Promise<Settings> => db.getSettings();
export const putSettings = (db: Store, s: Settings) => db.putSettings(s);

export const getMeta = <T>(db: Store, key: string): Promise<T | undefined> => db.getMeta<T>(key);
export const setMeta = (db: Store, key: string, value: unknown) => db.setMeta(key, value);

export const listContracts = (db: Store) => db.listContracts();
export const getContract = (db: Store, id: string) => db.getContract(id);
export const putContract = (db: Store, c: Contract) => db.putContract(c);
/** Deletes a contract only when it has no addenda and no bills; otherwise it must be terminated instead. */
export const deleteContract = (db: Store, id: string) => db.deleteContract(id);

export const listTemplates = (db: Store) => db.listTemplates();
/** Saves a template; a default contract template clears the other contract templates' default. */
export const putTemplate = (db: Store, t: DocTemplate) => db.putTemplate(t);
/** Removes a template; see Store.removeTemplate. */
export const removeTemplate = (db: Store, id: string) => db.removeTemplate(id);
/** The template to use: for contracts the chosen one (if it still exists) else the default; else the one of that kind. */
export const templateFor = (db: Store, kind: DocKind, templateId?: string | null): Promise<DocTemplate | null> => db.templateFor(kind, templateId);
