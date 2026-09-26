import 'fake-indexeddb/auto';
import { openAppDb, putCustomer, putBill, putSettings, listBills, listCustomers, getSettings, getMeta, setMeta, putContract, listContracts } from '../../src/storage/db';
import { allocateContractNumber } from '../../src/storage/contractNumbering';
import { putTemplate, listTemplates } from '../../src/storage/db';
import { sampleContract, sampleAddendum } from '../contractFixtures';
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
    expect(parsed.summary).toBe('1 bills, 1 customers, 0 services, 0 contracts, 0 templates');

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

describe('backups with bank account lists', () => {
  const file = (settings: unknown, bill: unknown = sampleBill()) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], counters: {}, settings, bills: [bill],
  });
  const { bankAccounts: _a, defaultBankAccountId: _d, ...base } = DEFAULT_SETTINGS;
  it('converts an old backup with a single account', () => {
    const r = parseBackup(file({ ...base, bankBin: '970436', accountNumber: '123', accountHolder: 'X' }));
    expect(r.ok && r.data.settings.bankAccounts.map((a) => a.accountNumber)).toEqual(['123']);
  });
  it('rejects damaged account data', () => {
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, bankAccounts: 'x' })).ok).toBe(false);
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, bankAccounts: [{ id: 'a', bankBin: 1 }] })).ok).toBe(false);
    expect(parseBackup(file(DEFAULT_SETTINGS, { ...sampleBill(), bankAccount: { bankBin: '970436' } })).ok).toBe(false);
  });
});

describe('backups with Google Drive fields', () => {
  const file = (settings: unknown, bill: unknown = sampleBill()) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], counters: {}, settings, bills: [bill],
  });
  it('accepts bills with drive status and rejects damaged drive fields', () => {
    const drive = { fileId: 'f1', link: 'https://drive.google.com/x', savedAt: '2026-09-26T07:00:00.000Z', error: null };
    expect(parseBackup(file(DEFAULT_SETTINGS, { ...sampleBill({ status: 'sent' }), drive })).ok).toBe(true);
    expect(parseBackup(file(DEFAULT_SETTINGS, { ...sampleBill(), drive: { fileId: 5 } })).ok).toBe(false);
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, driveAutoUpload: 'yes' })).ok).toBe(false);
    expect(parseBackup(file({ ...DEFAULT_SETTINGS, googleClientId: 7 })).ok).toBe(false);
  });
});

describe('restore keeps this device\'s Drive connection', () => {
  it('keeps driveConnected and driveFolders', async () => {
    const db = await seeded();
    await setMeta(db, 'driveConnected', { email: 'a@b.c', at: 'x' });
    await setMeta(db, 'driveFolders', { 'Phiếu thanh toán': 'F1' });
    const parsed = parseBackup(JSON.stringify(await exportAll(db, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreAll(db, parsed.data);
    expect(await getMeta(db, 'driveConnected')).toEqual({ email: 'a@b.c', at: 'x' });
    expect(await getMeta(db, 'driveFolders')).toEqual({ 'Phiếu thanh toán': 'F1' });
  });
});

describe('business details saved on bills', () => {
  const file = (bill: unknown) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], counters: {}, settings: DEFAULT_SETTINGS, bills: [bill],
  });
  const business = { businessName: 'Sao Mai', taxId: '', address: '', phone: '', email: '', logoDataUrl: null, preparedBy: '' };
  it('accepts a business snapshot and rejects a damaged one', () => {
    expect(parseBackup(file({ ...sampleBill({ status: 'sent' }), business })).ok).toBe(true);
    expect(parseBackup(file({ ...sampleBill({ status: 'sent' }), business: { businessName: 1 } })).ok).toBe(false);
  });
});

describe('backups with contracts', () => {
  const file = (over: Record<string, unknown>) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], counters: {}, settings: DEFAULT_SETTINGS, bills: [], ...over,
  });
  it('round trip with contracts and contract counters', async () => {
    const src = await seeded();
    await putContract(src, sampleContract());
    await putContract(src, sampleAddendum());
    await allocateContractNumber(src, DEFAULT_SETTINGS, '2026-09-15');
    const parsed = parseBackup(JSON.stringify(await exportAll(src, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary).toBe('1 bills, 1 customers, 0 services, 2 contracts, 0 templates');
    const dst = await freshDb();
    await restoreAll(dst, parsed.data);
    expect((await listContracts(dst)).map((c) => c.id).sort()).toEqual(['a1', 'k1']);
    expect(await allocateContractNumber(dst, DEFAULT_SETTINGS, '2026-10-01')).toBe('2/2026/HĐDV');
  });
  it('old backup without contracts restores', async () => {
    const r = parseBackup(file({}));
    expect(r.ok && r.data.contracts).toEqual([]);
    expect(r.ok && r.summary).toBe('0 bills, 0 customers, 0 services, 0 contracts, 0 templates');
  });
  it('rejects damaged contracts', () => {
    const k = sampleContract();
    const bad: Record<string, unknown>[] = [
      { ...k, status: 'weird' },
      { ...k, plan: undefined },
      { ...k, plan: { type: 'weird' } },
      { ...k, plan: { type: 'instalments', items: [{ name: 'x', share: { percent: 100 }, due: { on: 'signing' }, ready: false, readyOn: null }] } },
      { ...k, plan: { type: 'instalments', items: [{ id: 'i', name: 'x', share: { percent: 100 }, due: { on: 'signing' }, ready: false, readyOn: 5 }] } },
      { ...k, lines: [{ ...k.lines[0], qty: 0 }] },
      { ...sampleAddendum(), parentId: null },
    ];
    for (const c of bad) expect(parseBackup(file({ contracts: [c] })).ok).toBe(false);
    expect(parseBackup(file({ contracts: [k, sampleAddendum()] })).ok).toBe(true);
  });
  it('rejects a damaged contractRef on a bill', () => {
    expect(parseBackup(file({ bills: [{ ...sampleBill(), contractRef: { contractId: 5 } }] })).ok).toBe(false);
  });
  it('counter keys', () => {
    expect(parseBackup(file({ counters: { 'counter-2026': 3, 'contract-counter-2026': 2 } })).ok).toBe(true);
    expect(parseBackup(file({ counters: { 'contract-counter-abc': 2 } })).ok).toBe(false);
  });
});

describe('backups with Word templates', () => {
  const file = (over: Record<string, unknown>) => JSON.stringify({
    app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], counters: {}, settings: DEFAULT_SETTINGS, bills: [], ...over,
  });
  const good = { id: 't1', kind: 'bill', name: 'Bill', fileName: 'bill.docx', dataBase64: btoa('PK\u0003\u0004abc'), uploadedAt: '2026-09-26T00:00:00.000Z', isDefault: false };
  it('round trip keeps template bytes identical', async () => {
    const src = await seeded();
    const data = new Uint8Array([0x50, 0x4b, 3, 4, 0, 255, 128, 7]).buffer;
    await putTemplate(src, { id: 't1', kind: 'bill', name: 'Bill', fileName: 'bill.docx', data, uploadedAt: '2026-09-26T00:00:00.000Z', isDefault: false });
    const parsed = parseBackup(JSON.stringify(await exportAll(src, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary).toBe('1 bills, 1 customers, 0 services, 0 contracts, 1 templates');
    const dst = await freshDb();
    await restoreAll(dst, parsed.data);
    const [t] = await listTemplates(dst);
    expect([...new Uint8Array(t.data)]).toEqual([0x50, 0x4b, 3, 4, 0, 255, 128, 7]);
  });
  it('old backup without templates restores', () => {
    const r = parseBackup(file({}));
    expect(r.ok && r.data.templates).toEqual([]);
  });
  it('rejects damaged templates', () => {
    expect(parseBackup(file({ templates: [good] })).ok).toBe(true);
    expect(parseBackup(file({ templates: [{ ...good, dataBase64: btoa('not a zip') }] })).ok).toBe(false);
    expect(parseBackup(file({ templates: [{ ...good, kind: 'poster' }] })).ok).toBe(false);
    const big = btoa('PK' + 'x'.repeat(5 * 1024 * 1024));
    expect(parseBackup(file({ templates: [{ ...good, dataBase64: big }] })).ok).toBe(false);
  });
  it('rejects damaged Word Drive fields', () => {
    expect(parseBackup(file({ bills: [{ ...sampleBill(), driveDocx: { fileId: 5 } }] })).ok).toBe(false);
    expect(parseBackup(file({ contracts: [{ ...sampleContract(), drive: { fileId: 5 } }] })).ok).toBe(false);
  });
  it('restore leaves exactly one default contract template', () => {
    const c = (id: string, uploadedAt: string, isDefault: boolean) => ({ ...good, id, kind: 'contract', uploadedAt, isDefault });
    const none = parseBackup(file({ templates: [c('b', '2026-02-01T00:00:00.000Z', false), c('a', '2026-01-01T00:00:00.000Z', false)] }));
    const two = parseBackup(file({ templates: [c('b', '2026-02-01T00:00:00.000Z', true), c('a', '2026-01-01T00:00:00.000Z', true)] }));
    for (const r of [none, two]) {
      if (!r.ok) throw new Error(r.error);
      expect(r.data.templates.filter((t) => t.isDefault).map((t) => t.id)).toEqual(['a']);
    }
  });
  it('keeps report Drive status (so the next save updates the same Drive file)', async () => {
    const src = await seeded();
    const status = { fileId: 'f9', link: 'https://drive.google.com/file/d/f9/view', savedAt: '2026-09-26T07:00:00.000Z', error: null };
    await setMeta(src, 'report-drive:Báo cáo 2026-08.xlsx', status);
    const parsed = parseBackup(JSON.stringify(await exportAll(src, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    const dst = await freshDb();
    await restoreAll(dst, parsed.data);
    expect(await getMeta(dst, 'report-drive:Báo cáo 2026-08.xlsx')).toEqual(status);
  });
  it('old backup without report Drive status restores; damaged ones are refused', () => {
    const r = parseBackup(file({}));
    expect(r.ok && r.data.reportDrive).toEqual({});
    expect(parseBackup(file({ reportDrive: { 'Báo cáo 2026-08.xlsx': { fileId: 5 } } })).ok).toBe(false);
  });
  it('statement templates restore', () => {
    expect(parseBackup(file({ templates: [{ ...good, kind: 'statement' }] })).ok).toBe(true);
  });
  it('statement Drive status survives restore', async () => {
    const src = await seeded();
    const status = { fileId: 'f7', link: 'https://drive.google.com/file/d/f7/view', savedAt: '2026-09-26T07:00:00.000Z', error: null };
    await setMeta(src, 'statement-drive:Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf', status);
    const parsed = parseBackup(JSON.stringify(await exportAll(src, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    const dst = await freshDb();
    await restoreAll(dst, parsed.data);
    expect(await getMeta(dst, 'statement-drive:Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf')).toEqual(status);
    const old = parseBackup(file({}));
    expect(old.ok && old.data.statementDrive).toEqual({});
    expect(parseBackup(file({ statementDrive: { 'x.pdf': { fileId: 5 } } })).ok).toBe(false);
  });
});

