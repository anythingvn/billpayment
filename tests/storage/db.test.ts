import 'fake-indexeddb/auto';
import {
  openAppDb, listCustomers, putCustomer, deleteOrArchiveCustomer, listServices, putService,
  listBills, getBill, putBill, getSettings, putSettings, getMeta, setMeta,
} from '../../src/storage/db';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const freshDb = () => openAppDb(`test-db-${n++}`);
const customer = (id: string) => ({ id, name: `C ${id}`, address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });

describe('storage', () => {
  it('returns default settings until saved, then the saved values', async () => {
    const db = await freshDb();
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai' });
    expect((await getSettings(db)).businessName).toBe('Sao Mai');
  });

  it('stores customers and services', async () => {
    const db = await freshDb();
    await putCustomer(db, customer('c1'));
    await putService(db, { id: 's1', nameVi: 'A', nameEn: '', unitVi: '', unitEn: '', unitPrice: 1, archived: false });
    expect(await listCustomers(db)).toHaveLength(1);
    expect(await listServices(db)).toHaveLength(1);
  });

  it('deletes an unused customer but archives one used on a bill', async () => {
    const db = await freshDb();
    await putCustomer(db, customer('c1'));
    await putCustomer(db, customer('c2'));
    await putBill(db, sampleBill({ customerId: 'c2' }));
    expect(await deleteOrArchiveCustomer(db, 'c1')).toBe('deleted');
    expect(await deleteOrArchiveCustomer(db, 'c2')).toBe('archived');
    const left = await listCustomers(db);
    expect(left).toHaveLength(1);
    expect(left[0].archived).toBe(true);
  });

  it('lists bills newest first', async () => {
    const db = await freshDb();
    await putBill(db, sampleBill({ id: 'a', number: 'TT-2026-0001', billDate: '2026-09-01' }));
    await putBill(db, sampleBill({ id: 'b', number: 'TT-2026-0003', billDate: '2026-09-20' }));
    await putBill(db, sampleBill({ id: 'c', number: 'TT-2026-0002', billDate: '2026-09-20' }));
    expect((await listBills(db)).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect((await getBill(db, 'a'))?.number).toBe('TT-2026-0001');
  });

  it('stores meta values', async () => {
    const db = await freshDb();
    expect(await getMeta(db, 'lastBackupAt')).toBeUndefined();
    await setMeta(db, 'lastBackupAt', '2026-09-25T00:00:00.000Z');
    expect(await getMeta(db, 'lastBackupAt')).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('settings saved by an older version', () => {
  it('are converted to the footer note list when loaded', async () => {
    const db = await freshDb();
    const { footerNotes: _n, defaultFooterIndex: _i, ...old } = DEFAULT_SETTINGS;
    await db.put('settings', { ...old, footerNote: 'Old note' } as never, 'settings');
    const s = await getSettings(db);
    expect([s.footerNotes, s.defaultFooterIndex]).toEqual([['Old note'], 0]);
  });
});

describe('bank settings saved by an older version', () => {
  it('are converted to the account list when loaded', async () => {
    const db = await freshDb();
    const { bankAccounts: _a, defaultBankAccountId: _d, ...old } = DEFAULT_SETTINGS;
    await db.put('settings', { ...old, bankBin: '970436', accountNumber: '123', accountHolder: 'X' } as never, 'settings');
    expect((await getSettings(db)).bankAccounts).toEqual([{ id: 'acc-1', bankBin: '970436', accountNumber: '123', accountHolder: 'X' }]);
  });
});
