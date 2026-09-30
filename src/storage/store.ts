import type { Bill, Contract, Customer, DocKind, DocTemplate, DriveStatus, Service, Settings } from '../domain/types';
import type { BackupData } from './backup';

/**
 * Every data operation of the app. Implementations: IdbStore (this browser's IndexedDB — tests and the offline
 * cache), SqliteStore (the server) and ApiStore (the browser talking to the server).
 */
export interface Store {
  listCustomers(): Promise<Customer[]>;
  putCustomer(c: Customer): Promise<Customer>;
  deleteOrArchiveCustomer(id: string): Promise<'deleted' | 'archived'>;
  listServices(): Promise<Service[]>;
  putService(s: Service): Promise<Service>;
  /** Newest first (bill date, then number). */
  listBills(): Promise<Bill[]>;
  getBill(id: string): Promise<Bill | undefined>;
  putBill(b: Bill): Promise<Bill>;
  listContracts(): Promise<Contract[]>;
  getContract(id: string): Promise<Contract | undefined>;
  putContract(c: Contract): Promise<Contract>;
  /** Deletes a contract only when it has no addenda and no bills. */
  deleteContract(id: string): Promise<'deleted' | 'refused'>;
  listTemplates(): Promise<DocTemplate[]>;
  /** A default contract template clears the other contract templates' default. */
  putTemplate(t: DocTemplate): Promise<void>;
  /** Contracts that used it go back to the default; removing the default promotes the oldest remaining contract template. */
  removeTemplate(id: string): Promise<{ contractsReset: number }>;
  /** Contracts: the chosen one (if it still exists), else the default, else the oldest; other kinds: the oldest. */
  templateFor(kind: DocKind, templateId?: string | null): Promise<DocTemplate | null>;
  getSettings(): Promise<Settings>;
  putSettings(s: Settings): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Atomically increments counter `key` and returns the new value (1 for a new key). */
  nextCounter(key: string): Promise<number>;
  /** Reads and writes a bill's or contract's Drive status in one step. */
  updateDriveStatus(
    target: { type: 'bill' | 'contract'; id: string },
    field: 'drive' | 'driveDocx',
    make: (prev: DriveStatus | undefined) => DriveStatus,
  ): Promise<DriveStatus>;
  exportAll(nowIso: string): Promise<BackupData>;
  /** Replaces all business data; device facts (last backup, Drive connection/folders) are kept. */
  restoreAll(data: BackupData): Promise<void>;
}
