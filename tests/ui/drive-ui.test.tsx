import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';

vi.mock('../../src/drive/service', () => ({
  driveConfigured: vi.fn((s: { googleClientId: string }) => s.googleClientId.trim() !== ''),
  prepareDrive: vi.fn(async () => {}),
  connectDrive: vi.fn(async () => ({ email: 'a@b.c' })),
  disconnectDrive: vi.fn(async () => {}),
  driveConnection: vi.fn(async () => null),
  saveBillToDrive: vi.fn(async () => ({ fileId: 'f', link: 'l', savedAt: 's', error: null })),
  saveDocxToDrive: vi.fn(async () => ({ fileId: 'f', link: 'l', savedAt: 's', error: null })),
  isUploading: vi.fn(() => false),
  isUploadingFile: vi.fn(() => false),
  onDriveChange: vi.fn(() => () => {}),
  serverDriveState: vi.fn(() => null),
  disconnectServerDrive: vi.fn(async () => {}),
}));

import * as service from '../../src/drive/service';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putBill, putCustomer } from '../../src/storage/db';
import { DEFAULT_SETTINGS, BUILT_IN_GOOGLE_CLIENT_ID, type Settings } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const base: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'Sao Mai',
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
};
async function open(hash: string, settings: Partial<Settings> = {}, bills = [] as ReturnType<typeof sampleBill>[]) {
  const db = await openAppDb(`drive-ui-${n++}`);
  await putSettings(db, { ...base, ...settings });
  await putCustomer(db, { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
  for (const b of bills) await putBill(db, b);
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
afterEach(() => { cleanup(); location.hash = ''; vi.clearAllMocks(); });

describe('Settings → Google Drive', () => {
  it('shows the Drive panel fields', async () => {
    await open('#/settings');
    expect(await screen.findByText('Google Drive')).toBeTruthy();
    expect((screen.getByLabelText(/Main folder name/) as HTMLInputElement).value).toBe('Phiếu thanh toán');
    expect((screen.getByLabelText(/Upload automatically on export/) as HTMLInputElement).checked).toBe(true);
  });
  it('Connect works without entering a Client ID; the ID sits under Advanced', async () => {
    await open('#/settings');
    expect((await screen.findByText('Connect Google Drive') as HTMLButtonElement).disabled).toBe(false);
    const advanced = screen.getByText('Advanced').closest('details')!;
    expect(advanced.open).toBe(false);
    expect((screen.getByLabelText(/Google Client ID/) as HTMLInputElement).value).toBe(BUILT_IN_GOOGLE_CLIENT_ID);
  });
  it('Connect calls connectDrive and shows the email', async () => {
    await open('#/settings', { googleClientId: 'cid.apps.googleusercontent.com' });
    fireEvent.click(await screen.findByText('Connect Google Drive'));
    expect(await screen.findByText('Connected as a@b.c')).toBeTruthy();
    expect(service.connectDrive).toHaveBeenCalled();
  });
  it('rejects a main folder name containing /', async () => {
    const db = await open('#/settings');
    fireEvent.input(await screen.findByLabelText(/Main folder name/), { target: { value: 'Bills/2026' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Main folder name cannot contain /')).toBeTruthy();
    expect((await getSettings(db)).driveFolderName).toBe('Phiếu thanh toán');
  });
});

const CID = { googleClientId: 'cid.apps.googleusercontent.com' };
const saved = { fileId: 'f1', link: 'https://drive.google.com/file/d/f1/view', savedAt: '2026-09-26T07:05:00.000Z', error: null };

describe('bill view → Google Drive', () => {
  it('button only on sent and paid bills', async () => {
    await open('#/bills/s', CID, [sampleBill({ id: 's', status: 'sent' })]);
    expect(await screen.findByText('Save to Google Drive')).toBeTruthy();
    cleanup();
    await open('#/bills/p', CID, [sampleBill({ id: 'p', status: 'paid', paidDate: '2026-09-26', drive: saved })]);
    expect(await screen.findByText('Update in Google Drive')).toBeTruthy();
    for (const status of ['draft', 'cancelled'] as const) {
      cleanup();
      await open(`#/bills/${status}`, CID, [sampleBill({ id: status, status })]);
      await screen.findByText('← Back to bills');
      expect(screen.queryByText(/in Google Drive|to Google Drive/)).toBeNull();
    }
  });
  it('can save to Drive without entering a Client ID', async () => {
    await open('#/bills/s', {}, [sampleBill({ id: 's', status: 'sent' })]);
    expect(await screen.findByText('Save to Google Drive')).toBeTruthy();
    expect(screen.queryByText('Connect Google Drive in Settings')).toBeNull();
  });
  it('shows saved status with link', async () => {
    await open('#/bills/p', CID, [sampleBill({ id: 'p', status: 'sent', drive: saved })]);
    expect(await screen.findByText(/Saved to Drive \d\d\/\d\d\/\d{4} \d\d:\d\d/)).toBeTruthy();
    const link = screen.getByText('Open in Drive') as HTMLAnchorElement;
    expect([link.href, link.target]).toEqual([saved.link, '_blank']);
  });
  it('shows error with Retry', async () => {
    await open('#/bills/p', CID, [sampleBill({ id: 'p', status: 'sent', drive: { ...saved, error: 'Offline' } })]);
    expect(await screen.findByText(/Not saved to Drive: Offline/)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(service.saveBillToDrive).toHaveBeenCalledWith(expect.anything(), 'p', expect.objectContaining(CID));
  });
});

describe('Save & export → Google Drive', () => {
  async function exportNewBill(settings: Partial<Settings>) {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await open('#/bills/new', settings);
    fireEvent.click(await screen.findByText('Hoa Sen Xanh'));
    fireEvent.click(await screen.findByText('+ Custom line'));
    fireEvent.input(screen.getByPlaceholderText('Tên dịch vụ'), { target: { value: 'Thiết kế' } });
    fireEvent.input(document.querySelectorAll('input[type=number]')[1], { target: { value: '1000' } });
    fireEvent.click(screen.getByText('3 · Review & export'));
    fireEvent.click(await screen.findByText('Save & export PDF'));
    await waitFor(() => expect(print).toHaveBeenCalled());
    print.mockRestore();
  }
  it('export uploads when enabled and still prints if the upload fails', async () => {
    vi.mocked(service.saveBillToDrive).mockRejectedValueOnce(new Error('boom'));
    await exportNewBill(CID);
    expect(service.saveBillToDrive).toHaveBeenCalledTimes(1);
    expect(vi.mocked(service.saveBillToDrive).mock.calls[0][1]).toMatch(/.+/);
  });
  it('export uploads with the built-in Client ID when none was entered', async () => {
    await exportNewBill({});
    expect(service.saveBillToDrive).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ googleClientId: BUILT_IN_GOOGLE_CLIENT_ID }));
  });
  it('export with auto-upload off never calls the upload', async () => {
    await exportNewBill({ ...CID, driveAutoUpload: false });
    expect(service.saveBillToDrive).not.toHaveBeenCalled();
  });
});

describe('connect failure hint', () => {
  it('names this address and the setup guide when Google refuses', async () => {
    vi.mocked(service.connectDrive).mockRejectedValueOnce(new Error('Not connected to Google Drive'));
    await open('#/settings', CID);
    fireEvent.click(await screen.findByText('Connect Google Drive'));
    expect(await screen.findByText(new RegExp(`${location.origin.replace(/[.:/]/g, '\\$&')}.*Authorized JavaScript origins`))).toBeTruthy();
  });
});

describe('blocked pop-up on Connect', () => {
  it('shows the pop-up message', async () => {
    vi.mocked(service.connectDrive).mockRejectedValueOnce(new Error("Your browser blocked Google's sign-in window. Allow pop-ups for this site and try again."));
    await open('#/settings', CID);
    fireEvent.click(await screen.findByText('Connect Google Drive'));
    expect(await screen.findByText(/blocked Google's sign-in window/)).toBeTruthy();
  });
});

describe('deferred fixes: Drive status line', () => {
  it('shows an existing Drive link even when Drive is not configured', async () => {
    vi.mocked(service.driveConfigured).mockReturnValue(false);
    await open('#/bills/p', {}, [sampleBill({ id: 'p', status: 'sent', drive: saved })]);
    expect(await screen.findByText('Open in Drive')).toBeTruthy();
    vi.mocked(service.driveConfigured).mockImplementation((st) => st.googleClientId.trim() !== '');
  });
  it('has no stray separator when the saved file has no link', async () => {
    await open('#/bills/p', CID, [sampleBill({ id: 'p', status: 'sent', drive: { ...saved, link: null } })]);
    const line = await screen.findByText(/Saved to Drive/);
    expect(line.textContent!.trim()).not.toMatch(/·$/);
  });
  it('offers Reconnect when Google access expired', async () => {
    await open('#/bills/p', CID, [sampleBill({ id: 'p', status: 'sent', drive: { ...saved, error: 'Google access expired' } })]);
    expect(await screen.findByText(/Not saved to Drive: Google access expired/)).toBeTruthy();
    fireEvent.click(screen.getByText('Reconnect'));
    expect(service.saveBillToDrive).toHaveBeenCalled();
  });
});
