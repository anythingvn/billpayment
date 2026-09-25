import type { AppDb } from './db';
import { getMeta, getSettings, setMeta } from './db';
import { DEFAULT_SETTINGS, type Bill, type Customer, type Service, type Settings } from '../domain/types';

export interface BackupData {
  app: 'payment-bills';
  schemaVersion: 1;
  exportedAt: string;
  customers: Customer[];
  services: Service[];
  bills: Bill[];
  settings: Settings;
  counters: Record<string, number>;
}

export async function exportAll(db: AppDb, nowIso: string): Promise<BackupData> {
  const counters: Record<string, number> = {};
  const tx = db.transaction('meta');
  for (const key of await tx.store.getAllKeys()) {
    if (String(key).startsWith('counter-')) counters[String(key)] = (await tx.store.get(key)) as number;
  }
  await tx.done;
  return {
    app: 'payment-bills',
    schemaVersion: 1,
    exportedAt: nowIso,
    customers: await db.getAll('customers'),
    services: await db.getAll('services'),
    bills: await db.getAll('bills'),
    settings: await getSettings(db),
    counters,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const STATUSES = ['draft', 'sent', 'paid', 'cancelled'];

function validBill(b: unknown): boolean {
  return (
    isObj(b) && isStr(b.id) && isStr(b.number) && STATUSES.includes(b.status as string) &&
    isStr(b.billDate) && isStr(b.dueDate) && isStr(b.customerId) && isObj(b.customer) &&
    Array.isArray(b.lines) &&
    b.lines.every((l) => isObj(l) && isStr(l.nameVi) && Number.isInteger(l.qty) && Number.isInteger(l.unitPrice))
  );
}

export function parseBackup(
  text: string,
): { ok: true; data: BackupData; summary: string } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a backup (not valid JSON).' };
  }
  if (!isObj(raw) || raw.app !== 'payment-bills') return { ok: false, error: 'This file is not a payment-bills backup.' };
  if (raw.schemaVersion !== 1) return { ok: false, error: 'This backup was made by a different version of the app.' };
  if (!Array.isArray(raw.customers) || !Array.isArray(raw.services) || !Array.isArray(raw.bills) || !isObj(raw.settings) || !isObj(raw.counters)) {
    return { ok: false, error: 'The backup file is incomplete.' };
  }
  if (!raw.customers.every((c) => isObj(c) && isStr(c.id) && isStr(c.name))) return { ok: false, error: 'A customer in the backup is damaged.' };
  if (!raw.services.every((s) => isObj(s) && isStr(s.id) && isStr(s.nameVi))) return { ok: false, error: 'A service in the backup is damaged.' };
  const badBill = raw.bills.findIndex((b) => !validBill(b));
  if (badBill >= 0) return { ok: false, error: `Bill ${badBill + 1} in the backup is damaged.` };

  const data = { ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings } } as unknown as BackupData;
  return {
    ok: true,
    data,
    summary: `${data.bills.length} bills, ${data.customers.length} customers, ${data.services.length} services`,
  };
}

export async function restoreAll(db: AppDb, data: BackupData): Promise<void> {
  const tx = db.transaction(['customers', 'services', 'bills', 'settings', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  const keepLastBackup = await meta.get('lastBackupAt');
  await Promise.all([
    tx.objectStore('customers').clear(),
    tx.objectStore('services').clear(),
    tx.objectStore('bills').clear(),
    tx.objectStore('settings').clear(),
    meta.clear(),
  ]);
  for (const c of data.customers) await tx.objectStore('customers').put(c);
  for (const s of data.services) await tx.objectStore('services').put(s);
  for (const b of data.bills) await tx.objectStore('bills').put(b);
  await tx.objectStore('settings').put(data.settings, 'settings');
  for (const [k, v] of Object.entries(data.counters)) await meta.put(v, k);
  if (keepLastBackup !== undefined) await meta.put(keepLastBackup, 'lastBackupAt');
  await tx.done;
}

export const backupFileName = (nowIso: string) => `payment-bills-backup-${nowIso.slice(0, 10)}.json`;

export const markBackedUp = (db: AppDb, nowIso: string) => setMeta(db, 'lastBackupAt', nowIso);

export async function lastBackupAt(db: AppDb): Promise<string | null> {
  return (await getMeta<string>(db, 'lastBackupAt')) ?? null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export function needsBackupReminder(last: string | null, nowIso: string): boolean {
  return last === null || Date.parse(nowIso) - Date.parse(last) > SEVEN_DAYS_MS;
}
