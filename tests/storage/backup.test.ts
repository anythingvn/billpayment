import 'fake-indexeddb/auto';
import { openAppDb, putCustomer, putBill, putSettings, listBills, listCustomers, getSettings } from '../../src/storage/db';
import { allocateBillNumber } from '../../src/storage/numbering';
import {
  exportAll, parseBackup, restoreAll, needsBackupReminder, backupFileName, markBackedUp, lastBackupAt,
} from '../../src/storage/backup';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const freshDb = () => openAppDb(`backup-db-${n++}`);
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };

async function seeded() {
  const db = await freshDb();
  await putCustomer(db, customer);
  await putBill(db, sampleBill());
  await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai' });
  await allocateBillNumber(db, 'TT', '2026-09-25');
  return db;
}

describe('backup round trip', () => {
  it('restores identical data into an empty database, including counters', async () => {
    const src = await seeded();
    const text = JSON.stringify(await exportAll(src, '2026-09-25T10:00:00.000Z'));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary).toBe('1 bills, 1 customers, 0 services');

    const dst = await freshDb();
    await restoreAll(dst, parsed.data);
    expect(await listBills(dst)).toEqual(await listBills(src));
    expect(await listCustomers(dst)).toEqual(await listCustomers(src));
    expect(await getSettings(dst)).toEqual(await getSettings(src));
    expect(await allocateBillNumber(dst, 'TT', '2026-10-01')).toBe('TT-2026-0002');
  });

  it('replaces existing data rather than merging', async () => {
    const dst = await seeded();
    const empty = await freshDb();
    const parsed = parseBackup(JSON.stringify(await exportAll(empty, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreAll(dst, parsed.data);
    expect(await listBills(dst)).toEqual([]);
  });
});

describe('parseBackup rejects bad files', () => {
  it.each([
    ['not json', 'hello'],
    ['another app', JSON.stringify({ app: 'other', schemaVersion: 1 })],
    ['newer schema', JSON.stringify({ app: 'payment-bills', schemaVersion: 2 })],
    ['missing arrays', JSON.stringify({ app: 'payment-bills', schemaVersion: 1, settings: {} })],
    [
      'bill without lines',
      JSON.stringify({
        app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], settings: {}, counters: {},
        bills: [{ id: 'b', number: 'TT-2026-0001', status: 'sent', billDate: '2026-01-01', dueDate: '2026-01-02' }],
      }),
    ],
  ])('%s', (_label, text) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
  });

  it('leaves current data untouched when a bad file is rejected', async () => {
    const db = await seeded();
    const r = parseBackup('{"app":"payment-bills","schemaVersion":1}');
    expect(r.ok).toBe(false);
    expect(await listBills(db)).toHaveLength(1);
  });
});

describe('reminder and bookkeeping', () => {
  it('reminds when never backed up or older than 7 days', () => {
    expect(needsBackupReminder(null, '2026-09-25T00:00:00.000Z')).toBe(true);
    expect(needsBackupReminder('2026-09-18T00:00:00.000Z', '2026-09-25T00:00:00.000Z')).toBe(false);
    expect(needsBackupReminder('2026-09-17T23:59:00.000Z', '2026-09-25T00:00:00.000Z')).toBe(true);
  });
  it('names the file by date and records the last backup', async () => {
    expect(backupFileName('2026-09-25T10:00:00.000Z')).toBe('payment-bills-backup-2026-09-25.json');
    const db = await freshDb();
    expect(await lastBackupAt(db)).toBeNull();
    await markBackedUp(db, '2026-09-25T10:00:00.000Z');
    expect(await lastBackupAt(db)).toBe('2026-09-25T10:00:00.000Z');
  });
});

describe('parseBackup rejects bills and settings with invalid fields', () => {
  const good = () => ({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [],
    settings: { ...DEFAULT_SETTINGS }, counters: { 'counter-2026': 3 },
    bills: [sampleBill()] as unknown[],
  });
  it('accepts the good baseline', () => {
    expect(parseBackup(JSON.stringify(good())).ok).toBe(true);
  });
  it.each([
    ['missing vatRate', (d: any) => { delete d.bills[0].vatRate; }],
    ['invalid vatRate', (d: any) => { d.bills[0].vatRate = 7; }],
    ['bad bill date', (d: any) => { d.bills[0].billDate = 'garbage'; }],
    ['bad paid date', (d: any) => { d.bills[0].paidDate = 5; }],
    ['missing customer name', (d: any) => { delete d.bills[0].customer.name; }],
    ['qty zero', (d: any) => { d.bills[0].lines[0].qty = 0; }],
    ['negative price', (d: any) => { d.bills[0].lines[0].unitPrice = -1; }],
    ['non-numeric counter', (d: any) => { d.counters['counter-2026'] = 'abc'; }],
    ['bad settings VAT', (d: any) => { d.settings.defaultVatRate = 7; }],
    ['bad settings prefix', (d: any) => { d.settings.numberPrefix = 42; }],
  ])('%s', (_label, mutate) => {
    const d = good();
    mutate(d);
    expect(parseBackup(JSON.stringify(d)).ok).toBe(false);
  });
});

describe('backups with service detail lines', () => {
  const file = (lines: unknown[]) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [],
    settings: { ...DEFAULT_SETTINGS }, counters: {}, bills: [{ ...sampleBill(), lines }],
  });
  const line = sampleBill().lines[0];
  it('accepts lines with details', () => {
    const r = parseBackup(file([{ ...line, details: ['Trang chủ / Home'] }]));
    expect(r.ok && r.data.bills[0].lines[0].details).toEqual(['Trang chủ / Home']);
  });
  it('accepts an old backup without details and fills in an empty list', () => {
    const { details: _omit, ...old } = line;
    const r = parseBackup(file([old]));
    expect(r.ok && r.data.bills[0].lines[0].details).toEqual([]);
  });
  it('rejects details that are not a list of text', () => {
    expect(parseBackup(file([{ ...line, details: 'x' }])).ok).toBe(false);
    expect(parseBackup(file([{ ...line, details: [1] }])).ok).toBe(false);
  });
});

describe('backups with footer note lists', () => {
  const file = (settings: unknown, bill: unknown = sampleBill()) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], counters: {}, settings, bills: [bill],
  });
  const { footerNotes: _n, defaultFooterIndex: _i, ...base } = DEFAULT_SETTINGS;
  it('converts an old backup with a single footer note', () => {
    const r = parseBackup(file({ ...base, footerNote: 'Old note' }));
    expect(r.ok && [r.data.settings.footerNotes, r.data.settings.defaultFooterIndex]).toEqual([['Old note'], 0]);
  });
  it('rejects damaged footer settings or bill notes', () => {
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, footerNotes: 'x' })).ok).toBe(false);
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, footerNotes: [1] })).ok).toBe(false);
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, defaultFooterIndex: 'x' })).ok).toBe(false);
    expect(parseBackup(file(DEFAULT_SETTINGS, { ...sampleBill(), footerNote: 5 })).ok).toBe(false);
  });
});
