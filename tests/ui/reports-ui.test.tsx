import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';

vi.mock('../../src/drive/service', () => ({
  driveConfigured: vi.fn((s: { googleClientId: string }) => s.googleClientId.trim() !== ''),
  prepareDrive: vi.fn(async () => {}),
  connectDrive: vi.fn(async () => ({ email: 'a@b.c' })),
  disconnectDrive: vi.fn(async () => {}),
  driveConnection: vi.fn(async () => null),
  saveBillToDrive: vi.fn(async () => ({ fileId: 'f', link: 'l', savedAt: 's', error: null })),
  saveDocxToDrive: vi.fn(async () => ({ fileId: 'f', link: 'l', savedAt: 's', error: null })),
  saveReportToDrive: vi.fn(async () => ({ fileId: 'f', link: 'l', savedAt: 's', error: null })),
  reportDriveStatus: vi.fn(async () => undefined),
  isUploading: vi.fn(() => false),
  isUploadingFile: vi.fn(() => false),
  onDriveChange: vi.fn(() => () => {}),
}));
vi.mock('../../src/docs/download', () => ({ downloadBlob: vi.fn() }));
// The Excel file has its own tests; the screen only needs a file to hand to the download.
vi.mock('../../src/report/excel', () => ({ reportToXlsx: vi.fn(async () => new Blob(['PK'])), XLSX_MIME: 'application/xlsx' }));

import * as service from '../../src/drive/service';
import { downloadBlob } from '../../src/docs/download';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putBill } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Bill } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const line = { nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details: [] };
const bills: Bill[] = [
  sampleBill({ id: 'a', number: 'TT-2026-0012', status: 'paid', billDate: '2026-09-01', paidDate: '2026-09-05', lines: [line] }),
  sampleBill({ id: 'b', number: 'TT-2026-0013', status: 'paid', billDate: '2026-09-02', paidDate: '2026-09-06', lines: [line] }),
  sampleBill({ id: 'c', number: 'TT-2026-0014', status: 'sent', billDate: '2026-09-10', dueDate: '2026-09-20', lines: [line], vatRate: 'none' }),
];
async function open() {
  const db = await openAppDb(`reports-ui-${n++}`);
  await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', googleClientId: 'cid.apps.googleusercontent.com' });
  for (const b of bills) await putBill(db, b);
  location.hash = '#/reports';
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 10));
});
afterEach(() => {
  cleanup(); location.hash = ''; vi.clearAllMocks(); vi.useRealTimers();
  vi.mocked(service.reportDriveStatus).mockResolvedValue(undefined);
  vi.mocked(service.onDriveChange).mockImplementation(() => () => {});
  vi.mocked(service.isUploadingFile).mockReturnValue(false);
});
const date = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('Reports screen', () => {
  it('opens on last month', async () => {
    await open();
    await screen.findByText('Download Excel');
    expect([date('From').value, date('To').value]).toEqual(['2026-09-01', '2026-09-30']);
  });
  it('shortcuts fill the dates', async () => {
    await open();
    fireEvent.click(await screen.findByText('This year'));
    expect([date('From').value, date('To').value]).toEqual(['2026-01-01', '2026-12-31']);
  });
  it('summary figures', async () => {
    await open();
    const vat8 = (await screen.findByText('8%')).closest('tr')!;
    expect(within(vat8).getByText('2')).toBeTruthy();
    expect(within(vat8).getByText('2.160.000')).toBeTruthy();
    const received = screen.getByText('Received').closest('div')!;
    expect(within(received).getByText('2.160.000 ₫')).toBeTruthy();
    expect(within(screen.getByText('Billed').closest('div')!).getByText('3.160.000 ₫')).toBeTruthy();
    expect(within(screen.getByText('Owed at end').closest('div')!).getByText('1.000.000 ₫')).toBeTruthy();
  });
  it('download', async () => {
    await open();
    fireEvent.click(await screen.findByText('Download Excel'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(name).toBe('Báo cáo 2026-09.xlsx');
  });
  it('from after to', async () => {
    await open();
    await screen.findByText('Download Excel');
    fireEvent.input(date('From'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('The start date must be on or before the end date')).toBeTruthy();
    expect((screen.getByText('Download Excel') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Save to Google Drive') as HTMLButtonElement).disabled).toBe(true);
  });
  it('save to Drive', async () => {
    await open();
    fireEvent.click(await screen.findByText('Save to Google Drive'));
    expect(service.saveReportToDrive).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-30' }), expect.anything());
  });
  it('first save of a period shows that it is uploading', async () => {
    let listener: (id: string) => void = () => {};
    vi.mocked(service.onDriveChange).mockImplementation((fn) => { listener = fn; return () => {}; });
    await open();
    fireEvent.click(await screen.findByText('Save to Google Drive'));
    vi.mocked(service.isUploadingFile).mockReturnValue(true);
    listener('Báo cáo 2026-09.xlsx');
    expect(await screen.findByText('Uploading to Google Drive…')).toBeTruthy();
    expect((screen.getByText('Save to Google Drive') as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(service.isUploadingFile).mockReturnValue(false);
  });
  it('shows the saved Drive status', async () => {
    vi.mocked(service.reportDriveStatus).mockResolvedValue({ fileId: 'f1', link: 'https://drive.google.com/file/d/f1/view', savedAt: '2026-10-01T03:05:00.000Z', error: null });
    await open();
    expect(await screen.findByText('Update in Google Drive')).toBeTruthy();
    expect(screen.getByText(/^Saved to Drive 01\/10\/2026/)).toBeTruthy();
    expect(service.reportDriveStatus).toHaveBeenCalledWith(expect.anything(), 'Báo cáo 2026-09.xlsx');
  });
  it('menu', async () => {
    await open();
    location.hash = '#/';
    fireEvent.click(await screen.findByRole('button', { name: 'Reports' }));
    await waitFor(() => expect(location.hash).toBe('#/reports'));
  });
});
