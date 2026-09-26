import 'fake-indexeddb/auto';
import { openAppDb, putBill, getBill, getMeta, putContract, getContract } from '../../src/storage/db';
import { sampleContract } from '../contractFixtures';
import {
  saveBillToDrive, saveDocxToDrive, saveReportToDrive, reportDriveStatus, saveStatementToDrive, statementDriveStatus, setDriveDepsForTest, isUploading, onDriveChange, connectDrive, disconnectDrive, driveConnection, driveConfigured,
  type DriveDeps,
} from '../../src/drive/service';
import { DriveError } from '../../src/drive/api';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { buildReport } from '../../src/domain/report';
import { buildStatement } from '../../src/domain/statement';
import { fakeDrive } from './fakeDrive';

const s = { ...DEFAULT_SETTINGS, googleClientId: 'cid.apps.googleusercontent.com' };
let n = 0;
function setup(over: Partial<DriveDeps> = {}) {
  const api = fakeDrive();
  const deps: DriveDeps = {
    auth: { getToken: vi.fn(async () => 'ya29.fake'), revoke: vi.fn(async () => {}) },
    api,
    makePdf: vi.fn(async () => new Blob(['%PDF'])),
    makeDocx: vi.fn(async (target: { type: string; id: string }) => ({
      blob: new Blob(['PK']), fileName: `${target.id}.docx`,
      folders: target.type === 'contract' ? ['Phiếu thanh toán', 'Hợp đồng', '2026', 'Công ty CP Hoa Sen Xanh'] : ['Phiếu thanh toán', '2026', 'Công ty CP Hoa Sen Xanh'],
    })),
    makeXlsx: vi.fn(async () => new Blob(['PK'])),
    makeStatementPdf: vi.fn(async () => new Blob(['%PDF'])),
    makeStatementDocx: vi.fn(async (st: { customer: { name: string }; to: string }) => ({
      blob: new Blob(['PK']), fileName: 'Đối chiếu Công ty CP Hoa Sen Xanh 2026.docx',
      folders: ['Phiếu thanh toán', 'Đối chiếu', st.to.slice(0, 4), st.customer.name],
    })),
    now: () => '2026-09-26T07:00:00.000Z',
    online: () => true,
    ...over,
  };
  setDriveDepsForTest(deps);
  return { deps, api };
}
async function dbWith(...bills: ReturnType<typeof sampleBill>[]) {
  const db = await openAppDb(`drive-svc-${n++}`);
  for (const b of bills) await putBill(db, b);
  return db;
}
afterEach(() => setDriveDepsForTest(null));

describe('drive service', () => {
  it('is configured only with a Client ID', () => {
    expect(driveConfigured({ ...DEFAULT_SETTINGS, googleClientId: '' })).toBe(false);
    expect(driveConfigured({ ...DEFAULT_SETTINGS, googleClientId: '  ' })).toBe(false);
    expect(driveConfigured(s)).toBe(true);
  });

  it('asks for the token before anything else', async () => {
    const { deps } = setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    const p = saveBillToDrive(db, 'b1', s);
    expect(deps.auth.getToken).toHaveBeenCalledTimes(1);
    await p;
  });

  it('saves success on the bill', async () => {
    setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    const seen: string[] = [];
    const off = onDriveChange((id) => seen.push(`${id}:${isUploading(id)}`));
    const status = await saveBillToDrive(db, 'b1', s);
    off();
    const stored = (await getBill(db, 'b1'))!.drive!;
    expect(stored).toEqual(status);
    expect(stored).toMatchObject({ savedAt: '2026-09-26T07:00:00.000Z', error: null });
    expect(stored.fileId).toBeTruthy();
    expect(stored.link).toContain('drive.google.com');
    expect(seen).toEqual(['b1:true', 'b1:false']);
  });

  it('keeps the previous link on failure', async () => {
    const prev = { fileId: 'old', link: 'https://drive.google.com/file/d/old/view', savedAt: '2026-09-01T00:00:00.000Z', error: null };
    const { api } = setup();
    api.getFile = async () => { throw new DriveError('other', 'Google Drive error 500'); };
    const db = await dbWith(sampleBill({ status: 'paid', drive: prev }));
    const status = await saveBillToDrive(db, 'b1', s);
    expect(status).toEqual({ ...prev, error: 'Google Drive error 500' });
    expect((await getBill(db, 'b1'))!.drive).toEqual(status);
  });

  it('refuses drafts and cancelled bills', async () => {
    const { api } = setup();
    const db = await dbWith(sampleBill({ id: 'd', status: 'draft' }), sampleBill({ id: 'c', status: 'cancelled' }));
    for (const id of ['d', 'c']) {
      expect((await saveBillToDrive(db, id, s)).error).toBe('Only sent or paid bills are saved to Drive');
      expect((await getBill(db, id))!.drive).toBeUndefined();
    }
    expect(api.calls).toEqual([]);
  });

  it('offline fails fast', async () => {
    const { deps } = setup({ online: () => false });
    const db = await dbWith(sampleBill({ status: 'sent' }));
    expect((await saveBillToDrive(db, 'b1', s)).error).toBe('Offline');
    expect(deps.auth.getToken).not.toHaveBeenCalled();
    expect((await getBill(db, 'b1'))!.drive?.error).toBe('Offline');
  });

  it('reports sign-in and PDF problems in plain words', async () => {
    setup({ auth: { getToken: async () => { throw new DriveError('auth', 'x'); }, revoke: async () => {} } });
    const db = await dbWith(sampleBill({ status: 'sent' }));
    expect((await saveBillToDrive(db, 'b1', s)).error).toBe('Not connected to Google Drive');
    setup({ makePdf: async () => { throw new Error('canvas'); } });
    expect((await saveBillToDrive(db, 'b1', s)).error).toBe('Could not create the PDF');
  });

  it('joins a double click', async () => {
    const { api } = setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    const [a, b] = await Promise.all([saveBillToDrive(db, 'b1', s), saveBillToDrive(db, 'b1', s)]);
    expect(a).toEqual(b);
    expect(api.calls.filter((c) => c.startsWith('createFile'))).toHaveLength(1);
  });

  it('uploads run one at a time', async () => {
    const { api } = setup();
    const db = await dbWith(sampleBill({ id: 'x', number: 'TT-2026-0001', status: 'sent' }), sampleBill({ id: 'y', number: 'TT-2026-0002', status: 'sent' }));
    await Promise.all([saveBillToDrive(db, 'x', s), saveBillToDrive(db, 'y', s)]);
    expect(api.calls.filter((c) => c.startsWith('createFolder'))).toHaveLength(3);
    expect(api.calls.filter((c) => c.startsWith('createFile'))).toHaveLength(2);
  });

  it('stores the folder cache in meta', async () => {
    const { api } = setup();
    const db = await dbWith(sampleBill({ id: 'x', number: 'TT-2026-0001', status: 'sent' }), sampleBill({ id: 'y', number: 'TT-2026-0002', status: 'sent' }));
    await saveBillToDrive(db, 'x', s);
    expect(Object.keys((await getMeta<Record<string, string>>(db, 'driveFolders'))!)).toHaveLength(3);
    api.calls.length = 0;
    await saveBillToDrive(db, 'y', s);
    expect(api.calls.filter((c) => c.startsWith('createFolder'))).toHaveLength(0);
  });

  it('connect stores the email; disconnect revokes and forgets it', async () => {
    const { deps } = setup();
    const db = await dbWith();
    expect(await connectDrive(db, s)).toEqual({ email: 'owner@example.com' });
    expect(await driveConnection(db)).toEqual({ email: 'owner@example.com', at: '2026-09-26T07:00:00.000Z' });
    await disconnectDrive(db, s);
    expect(await driveConnection(db)).toBeNull();
    expect(deps.auth.revoke).toHaveBeenCalled();
  });

  it('never stores the token', async () => {
    setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    await connectDrive(db, s);
    await saveBillToDrive(db, 'b1', s);
    const metas = await Promise.all((await db.getAllKeys('meta')).map((k) => db.get('meta', k)));
    const everything = JSON.stringify({ metas, bills: await db.getAll('bills'), settings: await db.getAll('settings') });
    expect(everything).not.toContain('ya29.fake');
  });
});

describe('connection remembered from uploads', () => {
  it('records this device as connected after a successful upload', async () => {
    setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    expect(await driveConnection(db)).toBeNull();
    await saveBillToDrive(db, 'b1', s);
    expect(await driveConnection(db)).toEqual({ email: null, at: '2026-09-26T07:00:00.000Z' });
  });
});

describe('expired access', () => {
  it('says access expired (not "not connected") on a device that was connected', async () => {
    const { deps } = setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    await connectDrive(db, s);
    deps.auth.getToken = async () => { throw new DriveError('auth', 'x'); };
    expect((await saveBillToDrive(db, 'b1', s)).error).toBe('Google access expired');
  });
});

describe('Word documents to Drive', () => {
  it('saves a contract document and records it on the contract', async () => {
    setup();
    const db = await dbWith();
    await putContract(db, sampleContract());
    const status = await saveDocxToDrive(db, { type: 'contract', id: 'k1' }, s);
    expect(status.link).toContain('drive.google.com');
    expect((await getContract(db, 'k1'))!.drive).toEqual(status);
  });
  it("saves a bill's Word document separately from its PDF", async () => {
    setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    const pdf = await saveBillToDrive(db, 'b1', s);
    const docx = await saveDocxToDrive(db, { type: 'bill', id: 'b1' }, s);
    const b = (await getBill(db, 'b1'))!;
    expect(b.drive).toEqual(pdf);
    expect(b.driveDocx).toEqual(docx);
    expect(docx.fileId).not.toBe(pdf.fileId);
  });
  it('no template: no Drive calls', async () => {
    const { api } = setup({ makeDocx: vi.fn(async () => null) });
    const db = await dbWith(sampleBill({ status: 'sent' }));
    expect((await saveDocxToDrive(db, { type: 'bill', id: 'b1' }, s)).error).toBe('No Word template');
    expect(api.calls).toEqual([]);
  });
  it('draft contracts are not saved', async () => {
    setup();
    const db = await dbWith();
    await putContract(db, sampleContract({ status: 'draft' }));
    expect((await saveDocxToDrive(db, { type: 'contract', id: 'k1' }, s)).error).toBe('Only active contracts are saved to Drive');
  });
  it('PDF and Word of the same bill queued together land in the same folder, in order', async () => {
    const { api } = setup();
    const db = await dbWith(sampleBill({ status: 'sent' }));
    await Promise.all([saveBillToDrive(db, 'b1', s), saveDocxToDrive(db, { type: 'bill', id: 'b1' }, s)]);
    const created = api.calls.filter((c) => c.startsWith('createFile'));
    expect(created).toEqual(['createFile TT-2026-0012.pdf', 'createFile b1.docx']);
    const files = [...api.files.values()].filter((f) => f.mime !== 'application/vnd.google-apps.folder');
    expect(new Set(files.map((f) => f.parents![0])).size).toBe(1);
  });

  it('PDF and Word failing together both record their error', async () => {
    setup({ online: () => false });
    const db = await dbWith(sampleBill({ status: 'sent' }));
    await Promise.all([saveBillToDrive(db, 'b1', s), saveDocxToDrive(db, { type: 'bill', id: 'b1' }, s)]);
    const bill = (await getBill(db, 'b1'))!;
    expect([bill.drive?.error, bill.driveDocx?.error]).toEqual(['Offline', 'Offline']);
  });

  const report = () => buildReport([], '2026-09-01', '2026-09-30', s, '2026-10-02');
  it('saves a report under Báo cáo/<year>', async () => {
    const { api } = setup();
    const db = await dbWith();
    const status = await saveReportToDrive(db, report(), s);
    expect(api.calls.filter((c) => c.startsWith('create'))).toEqual([
      'createFolder Phiếu thanh toán', 'createFolder Báo cáo', 'createFolder 2026', 'createFile Báo cáo 2026-09.xlsx',
    ]);
    expect(status.error).toBeNull();
    expect(await reportDriveStatus(db, 'Báo cáo 2026-09.xlsx')).toEqual(status);
    expect(status.fileId).toBeTruthy();
  });
  it('same file name updates one file', async () => {
    const { api } = setup();
    const db = await dbWith();
    const first = await saveReportToDrive(db, report(), s);
    const second = await saveReportToDrive(db, report(), s);
    expect(api.byName('Báo cáo 2026-09.xlsx')).toHaveLength(1);
    expect(api.calls.filter((c) => c.startsWith('createFile') || c.startsWith('updateFile'))).toEqual([
      'createFile Báo cáo 2026-09.xlsx', `updateFile ${first.fileId}`,
    ]);
    expect(second.fileId).toBe(first.fileId);
  });
  it('offline records the report error in meta', async () => {
    setup({ online: () => false });
    const db = await dbWith();
    expect((await saveReportToDrive(db, report(), s)).error).toBe('Offline');
    expect((await reportDriveStatus(db, 'Báo cáo 2026-09.xlsx'))?.error).toBe('Offline');
  });

  const statement = () => buildStatement([], { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false },
    '2026-01-01', '2026-12-31', '2027-01-10');
  it('saves a statement PDF and Word under Đối chiếu', async () => {
    const { api } = setup();
    const db = await dbWith();
    const r = await saveStatementToDrive(db, statement(), s);
    expect(api.calls.filter((c) => c.startsWith('create'))).toEqual([
      'createFolder Phiếu thanh toán', 'createFolder Đối chiếu', 'createFolder 2026', 'createFolder Công ty CP Hoa Sen Xanh',
      'createFile Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf', 'createFile Đối chiếu Công ty CP Hoa Sen Xanh 2026.docx',
    ]);
    expect([r.pdf.error, r.docx?.error]).toEqual([null, null]);
    expect(await statementDriveStatus(db, 'Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf')).toEqual(r.pdf);
    expect(await statementDriveStatus(db, 'Đối chiếu Công ty CP Hoa Sen Xanh 2026.docx')).toEqual(r.docx);
  });
  it('no statement template: PDF only', async () => {
    const { api } = setup({ makeStatementDocx: vi.fn(async () => null) });
    const db = await dbWith();
    const r = await saveStatementToDrive(db, statement(), s);
    expect(r.docx).toBeNull();
    expect(api.calls.filter((c) => c.startsWith('createFile'))).toEqual(['createFile Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf']);
  });
  it('same statement updates the same files', async () => {
    const { api } = setup();
    const db = await dbWith();
    await saveStatementToDrive(db, statement(), s);
    await saveStatementToDrive(db, statement(), s);
    expect(api.byName('Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf')).toHaveLength(1);
    expect(api.byName('Đối chiếu Công ty CP Hoa Sen Xanh 2026.docx')).toHaveLength(1);
    expect(api.calls.filter((c) => c.startsWith('updateFile'))).toHaveLength(2);
  });
});

