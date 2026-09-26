import { ensureFolderPath } from '../../src/drive/folders';
import { uploadBillPdf, uploadFile } from '../../src/drive/upload';
import { fakeDrive } from './fakeDrive';
import { sampleBill } from '../fixtures';

const NAMES = ['Phiếu thanh toán', '2026', 'Công ty CP Hoa Sen Xanh'];
const pdf = () => new Blob(['%PDF']);
const sent = (over = {}) => sampleBill({ status: 'sent', ...over });
const creates = (calls: string[]) => calls.filter((c) => c.startsWith('createFolder')).length;

describe('ensureFolderPath', () => {
  it('creates the missing folder chain', async () => {
    const api = fakeDrive();
    const { folderId, cache } = await ensureFolderPath(api, NAMES, {});
    expect(Object.keys(cache)).toEqual(['Phiếu thanh toán', 'Phiếu thanh toán/2026', 'Phiếu thanh toán/2026/Công ty CP Hoa Sen Xanh']);
    expect(api.files.get(folderId)?.name).toBe('Công ty CP Hoa Sen Xanh');
    expect(creates(api.calls)).toBe(3);
  });
  it('reuses cached folders', async () => {
    const api = fakeDrive();
    const first = await ensureFolderPath(api, NAMES, {});
    api.calls.length = 0;
    const second = await ensureFolderPath(api, NAMES, first.cache);
    expect(second.folderId).toBe(first.folderId);
    expect(creates(api.calls)).toBe(0);
  });
  it('finds an existing folder by name instead of duplicating it', async () => {
    const api = fakeDrive();
    const main = await api.createFolder('Phiếu thanh toán', 'root');
    api.calls.length = 0;
    const { cache } = await ensureFolderPath(api, NAMES, {});
    expect(cache['Phiếu thanh toán']).toBe(main);
    expect(creates(api.calls)).toBe(2);
  });
  it('recreates missing cached folder', async () => {
    const api = fakeDrive();
    const first = await ensureFolderPath(api, NAMES, {});
    api.files.delete(first.cache['Phiếu thanh toán/2026']);
    const second = await ensureFolderPath(api, NAMES, first.cache);
    expect(second.cache['Phiếu thanh toán/2026']).not.toBe(first.cache['Phiếu thanh toán/2026']);
    expect(second.folderId).not.toBe(first.folderId);
    expect(api.files.get(second.folderId)?.parents).toEqual([second.cache['Phiếu thanh toán/2026']]);
  });
});

describe('uploadBillPdf', () => {
  it('first upload creates the file', async () => {
    const api = fakeDrive();
    const { status, cache } = await uploadBillPdf(api, sent(), pdf(), 'Phiếu thanh toán', {}, '2026-09-26T07:00:00.000Z');
    expect(status).toEqual({ fileId: status.fileId, link: `https://drive.google.com/file/d/${status.fileId}/view`, savedAt: '2026-09-26T07:00:00.000Z', error: null });
    const f = api.files.get(status.fileId!)!;
    expect(f.name).toBe('TT-2026-0012.pdf');
    expect(f.parents).toEqual([cache['Phiếu thanh toán/2026/Công ty CP Hoa Sen Xanh']]);
  });
  it('re-upload updates the same file', async () => {
    const api = fakeDrive();
    const a = await uploadBillPdf(api, sent(), pdf(), 'Phiếu thanh toán', {}, 't1');
    const b = await uploadBillPdf(api, sent({ drive: a.status }), pdf(), 'Phiếu thanh toán', a.cache, 't2');
    expect(b.status.fileId).toBe(a.status.fileId);
    expect(api.byName('TT-2026-0012.pdf')).toHaveLength(1);
    expect(api.calls).toContain(`updateFile ${a.status.fileId}`);
    expect(b.status.savedAt).toBe('t2');
  });
  it('recreates a deleted file', async () => {
    const api = fakeDrive();
    const a = await uploadBillPdf(api, sent(), pdf(), 'Phiếu thanh toán', {}, 't1');
    api.files.delete(a.status.fileId!);
    const b = await uploadBillPdf(api, sent({ drive: a.status }), pdf(), 'Phiếu thanh toán', a.cache, 't2');
    expect(b.status.fileId).not.toBe(a.status.fileId);
    expect(api.byName('TT-2026-0012.pdf')).toHaveLength(1);
  });
  it('moves file when its folder changed', async () => {
    const api = fakeDrive();
    const a = await uploadBillPdf(api, sent(), pdf(), 'A', {}, 't1');
    const b = await uploadBillPdf(api, sent({ drive: a.status }), pdf(), 'B', a.cache, 't2');
    expect(b.status.fileId).toBe(a.status.fileId);
    expect(api.files.get(b.status.fileId!)?.parents).toEqual([b.cache['B/2026/Công ty CP Hoa Sen Xanh']]);
  });
});

describe('uploadFile (any file, any folder path)', () => {
  it('creates in the path, then updates the same file', async () => {
    const api = fakeDrive();
    const folders = ['Phiếu thanh toán', 'Hợp đồng', '2026', 'Công ty CP Hoa Sen Xanh'];
    const input = { folders, fileName: 'HĐ 12-2026-HĐDV-SM – Công ty CP Hoa Sen Xanh.docx', mimeType: 'application/x-test', blob: new Blob(['PK']), existingFileId: null };
    const a = await uploadFile(api, input, {}, 't1');
    expect(api.files.get(a.status.fileId!)?.parents).toEqual([a.cache[folders.join('/')]]);
    expect(api.files.get(a.status.fileId!)?.mime).toBe('application/x-test');
    const b = await uploadFile(api, { ...input, existingFileId: a.status.fileId }, a.cache, 't2');
    expect(b.status.fileId).toBe(a.status.fileId);
    expect(api.files.get(a.status.fileId!)?.versions).toBe(2);
  });
});
