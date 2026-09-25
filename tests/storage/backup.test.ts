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
