import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';
import { makeDocx } from '../docs/makeDocx';

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
  saveStatementToDrive: vi.fn(async () => ({ pdf: { fileId: 'f', link: 'l', savedAt: 's', error: null }, docx: null })),
  statementDriveStatus: vi.fn(async () => undefined),
  statementDriveKey: (customerId: string, fileName: string) => `${customerId}/${fileName}`,
  isUploading: vi.fn(() => false),
  isUploadingFile: vi.fn(() => false),
  onDriveChange: vi.fn(() => () => {}),
  serverDriveState: vi.fn(() => null),
  disconnectServerDrive: vi.fn(async () => {}),
}));
vi.mock('../../src/docs/download', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../src/ui/print', () => ({ printBill: vi.fn() }));
vi.mock('../../src/ui/useQrDataUrl', () => ({ qrToDataUrl: vi.fn(async () => 'data:image/png;base64,AA'), useQrDataUrl: () => 'data:image/png;base64,AA' }));

import * as service from '../../src/drive/service';
import { downloadBlob } from '../../src/docs/download';
import { printBill } from '../../src/ui/print';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putBill, putCustomer, putTemplate } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Bill, type Settings } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const line = { nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details: [] };
const bills: Bill[] = [
  sampleBill({ id: 'a', number: 'TT-2026-0012', customerId: 'c1', status: 'paid', billDate: '2026-02-01', dueDate: '2026-02-11', paidDate: '2026-02-05', lines: [line] }),
  sampleBill({ id: 'b', number: 'TT-2026-0013', customerId: 'c1', status: 'sent', billDate: '2026-09-02', dueDate: '2026-09-12', lines: [line] }),
];
const base: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'Sao Mai', googleClientId: 'cid.apps.googleusercontent.com',
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
};
async function open(hash: string, over: Partial<Settings> = {}, template = false) {
  const db = await openAppDb(`statement-ui-${n++}`);
  await putSettings(db, { ...base, ...over });
  await putCustomer(db, { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '0109876543', contactPerson: '', email: '', phone: '', archived: false });
  for (const b of bills) await putBill(db, b);
  if (template) {
    await putTemplate(db, { id: 'st', kind: 'statement', name: 'Statement', fileName: 's.docx', data: await makeDocx(['{so_doi_chieu} {so_du_cuoi_ky}']), uploadedAt: '2026-01-01T00:00:00.000Z', isDefault: false });
  }
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 10));
});
afterEach(() => { cleanup(); location.hash = ''; vi.clearAllMocks(); vi.useRealTimers(); });
const date = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const PERIOD = 'Đối chiếu Công ty CP Hoa Sen Xanh 2026-01-01 – 2026-10-15';

describe('customer statement screen', () => {
  it('Customers has a Statement button', async () => {
    await open('#/customers');
    const row = (await screen.findByText('Công ty CP Hoa Sen Xanh')).closest('tr')!;
    fireEvent.click(within(row).getByText('Statement'));
    await waitFor(() => expect(location.hash).toBe('#/customers/c1/statement'));
  });
  it('opens on This year', async () => {
    await open('#/customers/c1/statement');
    await screen.findByText('Export PDF');
    expect([date('From').value, date('To').value]).toEqual(['2026-01-01', '2026-10-15']);
    expect(document.querySelector('.stmt-balances')!.textContent).toContain('1.080.000');
    expect(screen.getByText('BẢNG ĐỐI CHIẾU CÔNG NỢ')).toBeTruthy();
  });
  it('shortcuts', async () => {
    await open('#/customers/c1/statement');
    fireEvent.click(await screen.findByText('Last year'));
    expect([date('From').value, date('To').value]).toEqual(['2025-01-01', '2025-12-31']);
  });
  it('export PDF', async () => {
    await open('#/customers/c1/statement');
    fireEvent.click(await screen.findByText('Export PDF'));
    expect(printBill).toHaveBeenCalledWith(PERIOD);
  });
  it('Word with and without a template', async () => {
    await open('#/customers/c1/statement', {}, true);
    fireEvent.click(await screen.findByText('Word (.docx)'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe(`${PERIOD}.docx`);
    cleanup();
    await open('#/customers/c1/statement');
    expect((await screen.findByText('Add a template in Settings → Documents')).getAttribute('href')).toBe('#/settings');
  });
  it('Save to Google Drive', async () => {
    await open('#/customers/c1/statement');
    fireEvent.click(await screen.findByText('Save to Google Drive'));
    expect(service.saveStatementToDrive).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ from: '2026-01-01', to: '2026-10-15', customer: expect.objectContaining({ id: 'c1' }) }), expect.anything());
  });
  it('shows the Word file Drive status separately', async () => {
    vi.mocked(service.statementDriveStatus).mockImplementation(async (_db, customerId, name) => (customerId !== 'c1' ? undefined
      : name.endsWith('.pdf') ? { fileId: 'p', link: 'https://drive.google.com/file/d/p/view', savedAt: '2026-10-01T03:05:00.000Z', error: null }
        : { fileId: null, link: null, savedAt: null, error: 'Offline' }));
    await open('#/customers/c1/statement', {}, true);
    expect(await screen.findByText(/^PDF: saved to Drive 01\/10\/2026/)).toBeTruthy();
    expect(await screen.findByText(/^Word: not saved: Offline/)).toBeTruthy();
    vi.mocked(service.statementDriveStatus).mockResolvedValue(undefined);
  });
  it('from after to', async () => {
    await open('#/customers/c1/statement');
    await screen.findByText('Export PDF');
    fireEvent.input(date('From'), { target: { value: '2026-11-01' } });
    expect(await screen.findByText('The start date must be on or before the end date')).toBeTruthy();
    for (const label of ['Export PDF', 'Save to Google Drive']) expect((screen.getByText(label) as HTMLButtonElement).disabled).toBe(true);
  });
  it('no bank account', async () => {
    await open('#/customers/c1/statement', { bankAccounts: [], defaultBankAccountId: '' });
    expect(await screen.findByText('Add a bank account in Settings to show the VietQR')).toBeTruthy();
  });
});
