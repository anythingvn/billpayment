import 'fake-indexeddb/auto';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';

vi.mock('../../src/drive/service', () => ({
  driveConfigured: (s: { googleClientId: string }) => s.googleClientId.trim() !== '',
  prepareDrive: vi.fn(async () => {}),
  connectDrive: vi.fn(async () => ({ email: 'a@b.c' })),
  disconnectDrive: vi.fn(async () => {}),
  driveConnection: vi.fn(async () => null),
  saveBillToDrive: vi.fn(async () => ({ fileId: 'f', link: 'l', savedAt: 's', error: null })),
  isUploading: vi.fn(() => false),
  onDriveChange: vi.fn(() => () => {}),
}));

import * as service from '../../src/drive/service';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putBill, putCustomer } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/types';
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
    expect((screen.getByLabelText(/Google Client ID/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Main folder name/) as HTMLInputElement).value).toBe('Phiếu thanh toán');
    expect((screen.getByLabelText(/Upload automatically on export/) as HTMLInputElement).checked).toBe(true);
  });
  it('Connect is disabled until a Client ID is saved', async () => {
    await open('#/settings');
    expect((await screen.findByText('Connect Google Drive') as HTMLButtonElement).disabled).toBe(true);
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
