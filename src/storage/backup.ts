import type { AppDb } from './db';
import { getMeta, getSettings, setMeta } from './db';
import { normalizeSettings } from '../domain/settings';
import { VAT_RATES, type Bill, type Contract, type DocTemplate, type Customer, type Service, type Settings } from '../domain/types';

export interface BackupData {
  app: 'payment-bills';
  schemaVersion: 1;
  exportedAt: string;
  customers: Customer[];
  services: Service[];
  bills: Bill[];
  settings: Settings;
  counters: Record<string, number>;
  contracts: Contract[];
  templates: BackupTemplate[];
}

/** A Word template in a backup file (bytes as base64). */
export interface BackupTemplate extends Omit<DocTemplate, 'data'> {
  dataBase64: string;
}

const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

export function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function exportAll(db: AppDb, nowIso: string): Promise<BackupData> {
  const counters: Record<string, number> = {};
  const tx = db.transaction('meta');
  for (const key of await tx.store.getAllKeys()) {
    if (/^(contract-)?counter-/.test(String(key))) counters[String(key)] = (await tx.store.get(key)) as number;
  }
  await tx.done;
  return {
    app: 'payment-bills',
    schemaVersion: 1,
    exportedAt: nowIso,
    customers: await db.getAll('customers'),
    services: await db.getAll('services'),
    bills: await db.getAll('bills'),
    contracts: await db.getAll('contracts'),
    templates: (await db.getAll('templates')).map(({ data, ...t }) => ({ ...t, dataBase64: bytesToBase64(data) })),
    settings: await getSettings(db),
    counters,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const STATUSES = ['draft', 'sent', 'paid', 'cancelled'];

const isDate = (v: unknown): boolean => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isWhole = (v: unknown, min: number): boolean => Number.isInteger(v) && (v as number) >= min;
const isVat = (v: unknown): boolean => VAT_RATES.includes(v as never);
const SNAPSHOT_FIELDS = ['name', 'address', 'taxId', 'contactPerson', 'email', 'phone'];
const LINE_TEXT_FIELDS = ['nameVi', 'nameEn', 'unitVi', 'unitEn'];

function validBill(b: unknown): boolean {
  return (
    isObj(b) && isStr(b.id) && isStr(b.number) && STATUSES.includes(b.status as string) &&
    isDate(b.billDate) && isDate(b.dueDate) && (b.paidDate === null || isDate(b.paidDate)) &&
    isStr(b.customerId) && isVat(b.vatRate) && (b.footerNote === undefined || isStr(b.footerNote)) &&
    (b.bankAccount === undefined || validAccount(b.bankAccount)) &&
    (b.drive === undefined || validDriveStatus(b.drive)) &&
    (b.business === undefined || validBusiness(b.business)) &&
    (b.driveDocx === undefined || validDriveStatus(b.driveDocx)) &&
    (b.contractRef === undefined || validContractRef(b.contractRef)) &&
    validSnapshot(b.customer) && validLines(b.lines)
  );
}

const validSnapshot = (c: unknown): boolean => isObj(c) && SNAPSHOT_FIELDS.every((f) => isStr(c[f]));

const validLines = (lines: unknown): boolean => Array.isArray(lines) &&
  lines.every((l) => isObj(l) && LINE_TEXT_FIELDS.every((f) => isStr(l[f])) && isWhole(l.qty, 1) && isWhole(l.unitPrice, 0) &&
    (l.details === undefined || (Array.isArray(l.details) && l.details.every(isStr))));

function validContractRef(r: unknown): boolean {
  return isObj(r) && isStr(r.contractId) && strOrNull(r.itemKey) && isStr(r.number) && isDate(r.signedDate) &&
    strOrNull(r.parentNumber) && (r.parentSignedDate === null || isDate(r.parentSignedDate));
}

const CONTRACT_STATUSES = ['draft', 'active', 'completed', 'terminated'];

function validInstalment(i: unknown): boolean {
  if (!isObj(i) || !isStr(i.id) || !isStr(i.name) || typeof i.ready !== 'boolean' || !(i.readyOn === null || isDate(i.readyOn))) return false;
  const share = i.share, due = i.due;
  const okShare = isObj(share) && (typeof share.percent === 'number' || isWhole(share.amount, 0));
  const okDue = isObj(due) && (due.on === 'signing' || due.on === 'acceptance' || (due.on === 'date' && isDate(due.date)));
  return okShare && okDue;
}

function validPlan(p: unknown): boolean {
  if (!isObj(p)) return false;
  if (p.type === 'perUse') return true;
  if (p.type === 'instalments') return Array.isArray(p.items) && p.items.every(validInstalment);
  const month = (v: unknown) => isStr(v) && /^\d{4}-\d{2}$/.test(v);
  return p.type === 'periodic' && (p.every === 'month' || p.every === 'quarter') && isWhole(p.amount, 0) && month(p.first) && month(p.last);
}

function validContract(c: unknown): boolean {
  if (!isObj(c)) return false;
  const addendum = c.kind === 'addendum';
  return (
    isStr(c.id) && (c.kind === 'contract' || addendum) &&
    (addendum ? isStr(c.parentId) && (c.effect === 'addsWork' || c.effect === 'changesTerms') : c.parentId === null) &&
    (c.effectiveDate === null || isDate(c.effectiveDate)) &&
    isStr(c.number) && isStr(c.title) && CONTRACT_STATUSES.includes(c.status as string) &&
    isDate(c.signedDate) && isDate(c.startDate) && (c.endDate === null || isDate(c.endDate)) &&
    isStr(c.customerId) && validSnapshot(c.customer) && (c.business === null || validBusiness(c.business)) &&
    validLines(c.lines) && isVat(c.vatRate) && validPlan(c.plan) && isStr(c.paymentTerms) && isWhole(c.paymentDays, 0) &&
    (c.templateId === undefined || c.templateId === null || isStr(c.templateId)) && (c.drive === undefined || validDriveStatus(c.drive))
  );
}

function validTemplate(t: unknown): boolean {
  if (!isObj(t) || !isStr(t.id) || !['contract', 'addendum', 'bill'].includes(t.kind as string) || !isStr(t.name) || !isStr(t.fileName)
    || !isStr(t.uploadedAt) || typeof t.isDefault !== 'boolean' || !isStr(t.dataBase64)) return false;
  try {
    const bytes = base64ToBytes(t.dataBase64);
    return bytes.length <= MAX_TEMPLATE_BYTES && bytes[0] === 0x50 && bytes[1] === 0x4b;
  } catch {
    return false;
  }
}

const strOrNull = (v: unknown): boolean => v === null || isStr(v);

function validBusiness(x: unknown): boolean {
  return isObj(x) && ['businessName', 'taxId', 'address', 'phone', 'email', 'preparedBy'].every((k) => isStr(x[k])) && strOrNull(x.logoDataUrl);
}

function validDriveStatus(d: unknown): boolean {
  return isObj(d) && ['fileId', 'link', 'savedAt', 'error'].every((k) => strOrNull(d[k]));
}

function validAccount(a: unknown): boolean {
  return isObj(a) && isStr(a.bankBin) && isStr(a.accountNumber) && isStr(a.accountHolder);
}

function validSettings(s: Record<string, unknown>): boolean {
  if (['bankBin', 'accountNumber', 'accountHolder'].some((k) => s[k] !== undefined && !isStr(s[k]))) return false;
  if (s.bankAccounts !== undefined && !(Array.isArray(s.bankAccounts) && s.bankAccounts.every((a) => validAccount(a) && isStr(a.id)))) return false;
  if (s.defaultBankAccountId !== undefined && !isStr(s.defaultBankAccountId)) return false;
  if (['googleClientId', 'driveFolderName', 'contractType', 'contractSuffix'].some((k) => s[k] !== undefined && !isStr(s[k]))) return false;
  if (s.driveAutoUpload !== undefined && typeof s.driveAutoUpload !== 'boolean') return false;
  if (s.footerNote !== undefined && !isStr(s.footerNote)) return false;
  if (s.footerNotes !== undefined && !(Array.isArray(s.footerNotes) && s.footerNotes.every(isStr))) return false;
  if (s.defaultFooterIndex !== undefined && !isWhole(s.defaultFooterIndex, -1)) return false;
  const merged = normalizeSettings(s) as unknown as Record<string, unknown>;
  const textFields = ['businessName', 'taxId', 'address', 'phone', 'email', 'defaultBankAccountId', 'preparedBy', 'numberPrefix'];
  return (
    textFields.every((f) => isStr(merged[f])) &&
    (merged.logoDataUrl === null || isStr(merged.logoDataUrl)) &&
    isVat(merged.defaultVatRate) && isWhole(merged.defaultPaymentDays, 0)
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
  const contracts = raw.contracts === undefined ? [] : raw.contracts;
  if (!Array.isArray(contracts)) return { ok: false, error: 'The backup file is incomplete.' };
  const badContract = contracts.findIndex((c) => !validContract(c));
  if (badContract >= 0) return { ok: false, error: `Contract ${badContract + 1} in the backup is damaged.` };
  const templates = raw.templates === undefined ? [] : raw.templates;
  if (!Array.isArray(templates)) return { ok: false, error: 'The backup file is incomplete.' };
  const badTemplate = templates.findIndex((t) => !validTemplate(t));
  if (badTemplate >= 0) return { ok: false, error: `Word template ${badTemplate + 1} in the backup is damaged.` };
  if (!validSettings(raw.settings)) return { ok: false, error: 'The settings in the backup are damaged.' };
  const counters = raw.counters;
  if (!Object.entries(counters).every(([k, v]) => /^(contract-)?counter-\d{4}$/.test(k) && isWhole(v, 0))) {
    return { ok: false, error: 'The bill number counters in the backup are damaged.' };
  }

  const bills = (raw.bills as Bill[]).map((b) => ({ ...b, lines: b.lines.map((l) => ({ ...l, details: l.details ?? [] })) }));
  const data = { ...raw, bills, contracts, templates, settings: normalizeSettings(raw.settings) } as unknown as BackupData;
  return {
    ok: true,
    data,
    summary: `${data.bills.length} bills, ${data.customers.length} customers, ${data.services.length} services, ${data.contracts.length} contracts, ${data.templates.length} templates`,
  };
}

const DEVICE_META = ['lastBackupAt', 'driveConnected', 'driveFolders'];

export async function restoreAll(db: AppDb, data: BackupData): Promise<void> {
  const tx = db.transaction(['customers', 'services', 'bills', 'settings', 'meta', 'contracts', 'templates'], 'readwrite');
  const meta = tx.objectStore('meta');
  // Device-only facts survive a restore: last backup time and this device's Google Drive connection/folders.
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
  for (const [k, v] of keep) if (v !== undefined) await meta.put(v, k);
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
