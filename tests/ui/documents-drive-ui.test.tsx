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
  isUploading: vi.fn(() => false),
  isUploadingFile: vi.fn(() => false),
  onDriveChange: vi.fn(() => () => {}),
}));

import * as service from '../../src/drive/service';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putCustomer, putContract, putTemplate } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Contract, type DocTemplate, type Settings } from '../../src/domain/types';
import { sampleContract, sampleAddendum } from '../contractFixtures';

let n = 0;
const base: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'Sao Mai', googleClientId: 'cid.apps.googleusercontent.com', driveAutoUpload: true,
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
};
async function open(hash: string, settings: Partial<Settings>, contracts: Contract[], templates: DocTemplate[]) {
  const db = await openAppDb(`documents-drive-ui-${n++}`);
  await putSettings(db, { ...base, ...settings });
  await putCustomer(db, { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
  for (const c of contracts) await putContract(db, c);
  for (const t of templates) await putTemplate(db, t);
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
afterEach(() => {
  cleanup(); location.hash = ''; vi.clearAllMocks();
  vi.mocked(service.driveConfigured).mockImplementation((s) => s.googleClientId.trim() !== '');
});

const tpl = async (kind: DocTemplate['kind'] = 'contract'): Promise<DocTemplate> => ({
  id: `t-${kind}`, kind, name: 'T', fileName: 't.docx', data: await makeDocx(['{so_hop_dong}']), uploadedAt: '2026-01-01T00:00:00.000Z', isDefault: kind === 'contract',
});
const saved = { fileId: 'f1', link: 'https://drive.google.com/file/d/f1/view', savedAt: '2026-09-26T07:05:00.000Z', error: null };

describe('contracts — Drive', () => {
  it('contract page shows the Drive status and saves', async () => {
    await open('#/contracts/k1', {}, [sampleContract({ drive: saved })], [await tpl()]);
    expect(await screen.findByText(/^Word saved to Drive 26\/09\/2026/)).toBeTruthy();
    fireEvent.click(screen.getByText('Update in Google Drive'));
    expect(service.saveDocxToDrive).toHaveBeenCalledWith(expect.anything(), { type: 'contract', id: 'k1' }, expect.anything());
  });
  it('shows the error with Retry', async () => {
    await open('#/contracts/k1', {}, [sampleContract({ drive: { ...saved, error: 'Offline' } })], [await tpl()]);
    expect(await screen.findByText(/Not saved: Offline/)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(service.saveDocxToDrive).toHaveBeenCalled();
  });
  it('addendum row Drive action', async () => {
    await open('#/contracts/k1', {}, [sampleContract(), sampleAddendum()], [await tpl(), await tpl('addendum')]);
    const row = (await screen.findByText('PL01')).closest('tr')!;
    fireEvent.click(within(row).getByText('Save to Drive'));
    expect(service.saveDocxToDrive).toHaveBeenCalledWith(expect.anything(), { type: 'contract', id: 'a1' }, expect.anything());
  });
  it('Save & activate uploads when auto-upload is on and a template exists', async () => {
    await open('#/contracts/k1/edit', {}, [sampleContract({ status: 'draft' })], [await tpl()]);
    fireEvent.click(await screen.findByText('Save & activate'));
    await waitFor(() => expect(service.saveDocxToDrive).toHaveBeenCalledWith(expect.anything(), { type: 'contract', id: 'k1' }, expect.anything()));
  });
  it('Save & activate of an addendum uploads with the addendum template', async () => {
    await open('#/contracts/a1/edit', {}, [sampleContract(), sampleAddendum({ status: 'draft' })], [await tpl('addendum')]);
    fireEvent.click(await screen.findByText('Save & activate'));
    await waitFor(() => expect(service.saveDocxToDrive).toHaveBeenCalledWith(expect.anything(), { type: 'contract', id: 'a1' }, expect.anything()));
  });
  for (const [label, settings, templates] of [
    ['auto-upload off', { driveAutoUpload: false }, true],
    ['Drive not configured', {}, true],
    ['no template', {}, false],
  ] as const) {
    it(`Save & activate does not upload: ${label}`, async () => {
      if (label === 'Drive not configured') vi.mocked(service.driveConfigured).mockReturnValue(false);
      const db = await open('#/contracts/k1/edit', settings, [sampleContract({ status: 'draft' })], templates ? [await tpl()] : []);
      fireEvent.click(await screen.findByText('Save & activate'));
      await waitFor(() => expect(location.hash).toBe('#/contracts/k1'));
      await screen.findByText('Billing plan');
      expect(service.saveDocxToDrive).not.toHaveBeenCalled();
      void db;
    });
  }
});
