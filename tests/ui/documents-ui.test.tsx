import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';
import { makeDocx } from '../docs/makeDocx';

vi.mock('../../src/docs/starters', () => ({
  loadStarter: vi.fn(async () => (await import('../docs/makeDocx')).makeDocx(['{so_phieu}'])),
}));

import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putCustomer, putContract, putTemplate, listTemplates, type AppDb } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Contract, type DocTemplate } from '../../src/domain/types';
import { sampleContract } from '../contractFixtures';

let n = 0;
export async function openApp(hash: string, data: { contracts?: Contract[]; templates?: DocTemplate[] } = {}): Promise<AppDb> {
  const db = await openAppDb(`documents-ui-${n++}`);
  await putSettings(db, {
    ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false,
    bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
  });
  await putCustomer(db, { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
  for (const c of data.contracts ?? []) await putContract(db, c);
  for (const t of data.templates ?? []) await putTemplate(db, t);
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

const docxFile = async (paragraphs: string[], name = 't.docx') => new File([await makeDocx(paragraphs)], name);
const tpl = async (over: Partial<DocTemplate>): Promise<DocTemplate> => ({
  id: 't', kind: 'contract', name: 'T', fileName: 't.docx', data: await makeDocx(['{so_hop_dong}']), uploadedAt: '2026-01-01T00:00:00.000Z', isDefault: false, ...over,
});
const panel = async () => (await screen.findByText('Documents (Word templates)')).closest('.panel') as HTMLElement;

describe('Settings → Documents', () => {
  it('upload a contract template', async () => {
    const db = await openApp('#/settings');
    const p = await panel();
    fireEvent.input(within(p).getByLabelText('New contract template name'), { target: { value: 'Hợp đồng thiết kế' } });
    fireEvent.change(within(p).getByLabelText('Upload contract template'), { target: { files: [await docxFile(['{so_hop_dong}'])] } });
    await waitFor(async () => expect((await listTemplates(db)).map((t) => [t.kind, t.name, t.isDefault])).toEqual([['contract', 'Hợp đồng thiết kế', true]]));
    expect(await within(p).findByText('Hợp đồng thiết kế')).toBeTruthy();
  });
  it('refuses a non-docx or oversized file', async () => {
    const db = await openApp('#/settings');
    const p = await panel();
    fireEvent.change(within(p).getByLabelText('Upload bill template'), { target: { files: [new File(['hello'], 'a.txt')] } });
    expect(await within(p).findByText("This isn't a Word .docx file")).toBeTruthy();
    const big = new File([new Uint8Array(6 * 1024 * 1024).fill(0x50, 0, 1).fill(0x4b, 1, 2)], 'big.docx');
    fireEvent.change(within(p).getByLabelText('Upload bill template'), { target: { files: [big] } });
    expect(await within(p).findByText('The template is larger than 5 MB')).toBeTruthy();
    expect(await listTemplates(db)).toEqual([]);
  });
  it('shows unknown placeholders on upload but saves', async () => {
    const db = await openApp('#/settings');
    const p = await panel();
    fireEvent.change(within(p).getByLabelText('Upload addendum template'), { target: { files: [await docxFile(['{so_hop_dongg}'])] } });
    expect(await within(p).findByText('Unknown placeholder: so_hop_dongg (did you mean so_hop_dong?)')).toBeTruthy();
    await waitFor(async () => expect((await listTemplates(db)).map((t) => t.kind)).toEqual(['addendum']));
  });
  it('make default and remove in use', async () => {
    const db = await openApp('#/settings', {
      templates: [await tpl({ id: 'A', name: 'Mẫu A', isDefault: true, uploadedAt: '2026-01-01T00:00:00.000Z' }), await tpl({ id: 'B', name: 'Mẫu B', uploadedAt: '2026-02-01T00:00:00.000Z' })],
      contracts: [sampleContract({ templateId: 'B' })],
    });
    const p = await panel();
    const rowB = (await within(p).findByText('Mẫu B')).closest('tr')!;
    fireEvent.click(within(rowB).getByLabelText('Default'));
    await waitFor(async () => expect((await listTemplates(db)).find((t) => t.isDefault)?.id).toBe('B'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(within(p).getByText('Mẫu B').closest('tr')!).getByText('Remove'));
    await waitFor(async () => expect((await listTemplates(db)).map((t) => [t.id, t.isDefault])).toEqual([['A', true]]));
    expect(confirm).toHaveBeenCalledWith('1 contract uses this template; it will use the default. Remove it?');
  });
  it('use starter', async () => {
    const db = await openApp('#/settings');
    fireEvent.click(within(await panel()).getByLabelText('Use starter bill template'));
    await waitFor(async () => expect((await listTemplates(db)).map((t) => [t.kind, t.name])).toEqual([['bill', 'Bill']]));
  });
  it('placeholder list with copy', async () => {
    await openApp('#/settings');
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const p = await panel();
    const row = (await within(p).findByText('so_hop_dong')).closest('tr')!;
    fireEvent.click(within(row).getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('{so_hop_dong}');
  });
  it('check a template without saving', async () => {
    const db = await openApp('#/settings');
    const p = await panel();
    fireEvent.change(within(p).getByLabelText('Check a template'), { target: { files: [await docxFile(['{so_phieu} {tong_congg}'])] } });
    expect(await within(p).findByText(/Uses: .*so_phieu/)).toBeTruthy();
    expect(within(p).getByText('Unknown placeholder: tong_congg (did you mean tong_cong?)')).toBeTruthy();
    expect(await listTemplates(db)).toEqual([]);
  });
  it('warning text shown', async () => {
    await openApp('#/settings');
    expect(within(await panel()).getByText('Only upload templates you created or trust — templates can contain small formulas that run in this app.')).toBeTruthy();
  });
});
