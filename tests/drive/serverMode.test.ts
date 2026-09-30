import 'fake-indexeddb/auto';
import { openAppDb, putBill } from '../../src/storage/db';
import { saveBillToDrive, saveStatementToDrive, setDriveDepsForTest, useServerDrive, driveConfigured, isUploadingFile, type ServerDriveClient } from '../../src/drive/service';
import { buildStatement } from '../../src/domain/statement';
import { DEFAULT_SETTINGS, type DriveStatus } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const s = { ...DEFAULT_SETTINGS, googleClientId: '' };
let n = 0;
function server(result: DriveStatus | Error = { fileId: 'f1', link: 'l', savedAt: '2026-09-26T08:00:00.000Z', error: null }) {
  const uploads: Parameters<ServerDriveClient['upload']>[0][] = [];
  const client: ServerDriveClient = {
    status: vi.fn(async () => ({ connected: true, email: 'owner@saomai.vn' })),
    upload: vi.fn(async (body) => { uploads.push(body); if (result instanceof Error) throw result; return result; }),
    disconnect: vi.fn(async () => {}),
  };
  return { client, uploads };
}
const getToken = vi.fn(async () => 'browser-token');
beforeEach(() => {
  setDriveDepsForTest({
    auth: { getToken, revoke: vi.fn(async () => {}) }, api: {} as never,
    makePdf: vi.fn(async () => new Blob(['%PDF'])), makeDocx: vi.fn(async () => null), makeXlsx: vi.fn(async () => new Blob(['PK'])),
    makeStatementPdf: vi.fn(async () => new Blob(['%PDF'])), makeStatementDocx: vi.fn(async () => null),
    now: () => '2026-09-26T08:00:00.000Z', online: () => true,
  });
});
afterEach(() => { useServerDrive(null); setDriveDepsForTest(null); getToken.mockClear(); });

describe('Drive in server mode', () => {
  it('saveBillToDrive posts the PDF to the server; no Google sign-in in the browser', async () => {
    const db = await openAppDb(`srv-drive-${n++}`);
    await putBill(db, sampleBill({ id: 'b1', status: 'sent' }));
    const { client, uploads } = server();
    await useServerDrive(client);
    expect(driveConfigured(s)).toBe(true);
    const status = await saveBillToDrive(db, 'b1', s);
    expect(status).toMatchObject({ fileId: 'f1', error: null });
    expect(uploads[0]).toMatchObject({ target: { type: 'bill', id: 'b1' }, field: 'drive', fileName: 'TT-2026-0012.pdf', mimeType: 'application/pdf' });
    expect(uploads[0].folders).toEqual(['Phiếu thanh toán', '2026', 'Công ty CP Hoa Sen Xanh']);
    expect(Buffer.from(uploads[0].dataBase64, 'base64').toString()).toBe('%PDF');
    expect(getToken).not.toHaveBeenCalled();
    expect(isUploadingFile('b1', 'pdf')).toBe(false);
  });

  it('statement uploads use the customer-keyed target', async () => {
    const db = await openAppDb(`srv-drive-${n++}`);
    const { client, uploads } = server();
    await useServerDrive(client);
    const st = buildStatement([], { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false }, '2026-01-01', '2026-12-31', '2027-01-10');
    await saveStatementToDrive(db, st, s);
    expect(uploads[0].target).toEqual({ type: 'statement', id: 'c1/Đối chiếu Hoa Sen Xanh 2026.pdf' });
  });

  it('not connected or unreachable: the message comes back as the status error', async () => {
    const db = await openAppDb(`srv-drive-${n++}`);
    await putBill(db, sampleBill({ id: 'b1', status: 'sent' }));
    await useServerDrive(server(new Error("Google Drive isn't connected — ask the Admin")).client);
    expect((await saveBillToDrive(db, 'b1', s)).error).toBe("Google Drive isn't connected — ask the Admin");
  });

  it('not configured until the server says it is connected', async () => {
    const { client } = server();
    (client.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ connected: false, email: null });
    await useServerDrive(client);
    expect(driveConfigured({ ...s, googleClientId: 'x' })).toBe(false);
  });
});
