import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import {
  openAppDb, listContracts, getContract, putContract, deleteContract, putBill, putCustomer, listBills, listCustomers, getSettings,
  putSettings, deleteOrArchiveCustomer,
} from '../../src/storage/db';
import { allocateContractNumber } from '../../src/storage/contractNumbering';
import { allocateBillNumber } from '../../src/storage/numbering';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';

let n = 0;
const name = () => `contracts-db-${n++}`;
const customer = (id: string) => ({ id, name: `C ${id}`, address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });

/** The database exactly as version 1 of the app created it. */
function openV1(dbName: string) {
  return openDB(dbName, 1, {
    upgrade(db) {
      db.createObjectStore('customers', { keyPath: 'id' });
      db.createObjectStore('services', { keyPath: 'id' });
      db.createObjectStore('bills', { keyPath: 'id' }).createIndex('byCustomer', 'customerId');
      db.createObjectStore('settings');
      db.createObjectStore('meta');
    },
  });
}

describe('database version 2', () => {
  it('upgrade from version 1 keeps existing data', async () => {
    const dbName = name();
    const v1 = await openV1(dbName);
    await v1.put('bills', sampleBill());
    await v1.put('customers', customer('c1'));
    await v1.put('settings', { ...DEFAULT_SETTINGS, businessName: 'Sao Mai' }, 'settings');
    v1.close();
    const db = await openAppDb(dbName);
    expect(await listBills(db)).toHaveLength(1);
    expect(await listCustomers(db)).toHaveLength(1);
    expect((await getSettings(db)).businessName).toBe('Sao Mai');
    expect(await listContracts(db)).toEqual([]);
  });
  it('reports when another tab blocks the upgrade', async () => {
    const dbName = name();
    const old = await openV1(dbName);
    const onBlocked = vi.fn();
    const opening = openAppDb(dbName, { onBlocked });
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalled());
    old.close();
    await expect(opening).resolves.toBeTruthy();
  });
});

describe('contracts', () => {
  it('CRUD and delete rules', async () => {
    const db = await openAppDb(name());
    await putContract(db, sampleContract({ id: 'k1', status: 'draft' }));
    await putContract(db, sampleContract({ id: 'k2' }));
    await putContract(db, sampleAddendum({ id: 'a1', parentId: 'k2' }));
    await putContract(db, sampleContract({ id: 'k3' }));
    await putBill(db, sampleBill({ contractRef: { contractId: 'k3', itemKey: null, number: 'x', signedDate: '2026-01-01', parentNumber: null, parentSignedDate: null } }));
    expect((await getContract(db, 'k2'))?.number).toBe('12/2026/HĐDV-SM');
    expect(await deleteContract(db, 'k1')).toBe('deleted');
    expect(await deleteContract(db, 'k2')).toBe('refused');
    expect(await deleteContract(db, 'k3')).toBe('refused');
    expect((await listContracts(db)).map((c) => c.id).sort()).toEqual(['a1', 'k2', 'k3']);
  });
  it('customer used by a contract is archived', async () => {
    const db = await openAppDb(name());
    await putCustomer(db, customer('c9'));
    await putContract(db, sampleContract({ customerId: 'c9' }));
    expect(await deleteOrArchiveCustomer(db, 'c9')).toBe('archived');
  });
  it('contract numbers', async () => {
    const db = await openAppDb(name());
    const s = { ...DEFAULT_SETTINGS, contractType: 'HĐDV', contractSuffix: 'SM' };
    expect(await allocateContractNumber(db, s, '2026-09-15')).toBe('1/2026/HĐDV-SM');
    expect(await allocateContractNumber(db, s, '2026-12-31')).toBe('2/2026/HĐDV-SM');
    expect(await allocateContractNumber(db, s, '2027-01-02')).toBe('1/2027/HĐDV-SM');
    expect(await allocateContractNumber(db, { ...s, contractSuffix: '' }, '2026-10-01')).toBe('3/2026/HĐDV');
    expect(await allocateBillNumber(db, 'TT', '2026-10-01')).toBe('TT-2026-0001');
    await putSettings(db, s);
  });
});
