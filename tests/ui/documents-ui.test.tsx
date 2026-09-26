import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';
import { makeDocx, docxText, docxMedia } from '../docs/makeDocx';

vi.mock('../../src/docs/download', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../src/ui/useQrDataUrl', async (orig) => {
  const { PNG_1PX } = await import('../docs/makeDocx');
  const url = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_1PX))}`;
  return { ...(await orig<object>()), qrToDataUrl: vi.fn(async () => url), useQrDataUrl: () => url };
});

vi.mock('../../src/docs/starters', () => ({
  loadStarter: vi.fn(async () => (await import('../docs/makeDocx')).makeDocx(['{so_phieu}'])),
}));

import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putCustomer, putContract, putTemplate, listTemplates, getContract, putBill, type AppDb } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Bill, type Contract, type DocTemplate } from '../../src/domain/types';
import { sampleContract, sampleAddendum } from '../contractFixtures';
import { sampleBill } from '../fixtures';
import { downloadBlob } from '../../src/docs/download';

let n = 0;
export async function openApp(hash: string, data: { contracts?: Contract[]; templates?: DocTemplate[]; bills?: Bill[] } = {}): Promise<AppDb> {
  const db = await openAppDb(`documents-ui-${n++}`);
  await putSettings(db, {
    ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false,
    bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
  });
  await putCustomer(db, { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
  for (const c of data.contracts ?? []) await putContract(db, c);
  for (const t of data.templates ?? []) await putTemplate(db, t);
  for (const b of data.bills ?? []) await putBill(db, b);
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); vi.mocked(downloadBlob).mockClear(); });

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
  it('warns about placeholders another kind of document fills', async () => {
    const db = await openApp('#/settings');
    const p = await panel();
    fireEvent.change(within(p).getByLabelText('Upload bill template'), { target: { files: [await docxFile(['{so_phieu} {so_hop_dong}'])] } });
    expect(await within(p).findByText("so_hop_dong isn't filled in bill documents (it prints empty)")).toBeTruthy();
    await waitFor(async () => expect((await listTemplates(db)).map((t) => t.kind)).toEqual(['bill']));
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
  it('Use starter twice keeps one contract starter', async () => {
    const db = await openApp('#/settings');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(await panel()).getByLabelText('Use starter contract template'));
    await waitFor(async () => expect(await listTemplates(db)).toHaveLength(1));
    const [first] = await listTemplates(db);
    await new Promise((r) => setTimeout(r, 5)); // so the replacement gets a later upload time
    fireEvent.click(within(await panel()).getByLabelText('Use starter contract template'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Replace the current contract template “Hợp đồng mẫu” with the starter?'));
    await waitFor(async () => expect((await listTemplates(db))[0].uploadedAt).not.toBe(first.uploadedAt));
    expect((await listTemplates(db)).map((t) => [t.id, t.name, t.isDefault])).toEqual([[first.id, 'Hợp đồng mẫu', true]]);
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
    expect(await within(p).findByText('✓ so_phieu')).toBeTruthy();
    expect(within(p).getByText('✗ tong_congg').classList.contains('unknown')).toBe(true);
    expect(within(p).getByText('Unknown placeholder: tong_congg (did you mean tong_cong?)')).toBeTruthy();
    expect(await listTemplates(db)).toEqual([]);
  });
  it('warning text shown', async () => {
    await openApp('#/settings');
    expect(within(await panel()).getByText('Only upload templates you created or trust — templates can contain small formulas that run in this app.')).toBeTruthy();
  });
});

describe('contracts — Word', () => {
  it('template select', async () => {
    const db = await openApp('#/contracts/k1/edit', {
      contracts: [sampleContract({ status: 'draft' })],
      templates: [await tpl({ id: 'A', name: 'Mẫu A', isDefault: true }), await tpl({ id: 'B', name: 'Mẫu B' })],
    });
    const select = await screen.findByLabelText(/^Document template/) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect(select.value).toBe('');
    expect(select.options[select.selectedIndex].text).toBe('Default (Mẫu A)');
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(async () => expect(location.hash).toBe('#/contracts/k1'));
    expect((await getContract(db, 'k1'))!.templateId).toBeNull();
    location.hash = '#/contracts/k1/edit';
    fireEvent.change(await screen.findByLabelText(/^Document template/), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(async () => expect((await getContract(db, 'k1'))!.templateId).toBe('B'));
  });
  it('addendum editor has no template select', async () => {
    await openApp('#/contracts/k1/addendum', { contracts: [sampleContract()], templates: [await tpl({ id: 'A', isDefault: true })] });
    await screen.findByText(/Addendum of contract/);
    expect(screen.queryByLabelText(/^Document template/)).toBeNull();
  });
  it('Word download', async () => {
    await openApp('#/contracts/k1', { contracts: [sampleContract()], templates: [await tpl({ id: 'A', isDefault: true })] });
    fireEvent.click(await screen.findByText('Word (.docx)'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe('HĐ 12-2026-HĐDV-SM – Công ty CP Hoa Sen Xanh.docx');
    expect(await docxText(blob)).toContain('12/2026/HĐDV-SM');
  });
  it('addendum row Word', async () => {
    await openApp('#/contracts/k1', {
      contracts: [sampleContract(), sampleAddendum()],
      templates: [await tpl({ id: 'A', isDefault: true }), await tpl({ id: 'P', kind: 'addendum', data: await makeDocx(['{so_phu_luc}']) })],
    });
    const row = (await screen.findByText('PL01')).closest('tr')!;
    fireEvent.click(within(row).getByText('Word'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe('PL01 – HĐ 12-2026-HĐDV-SM.docx');
    expect(await docxText(blob)).toContain('PL01');
  });
  it('missing template', async () => {
    await openApp('#/contracts/k1', { contracts: [sampleContract(), sampleAddendum()] });
    const links = await screen.findAllByText('Add a template in Settings → Documents');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('#/settings');
    expect(screen.queryByText('Word (.docx)')).toBeNull();
  });
  it('unknown placeholder at download', async () => {
    await openApp('#/contracts/k1', { contracts: [sampleContract()], templates: [await tpl({ id: 'A', isDefault: true, data: await makeDocx(['{so_hop_dongg}']) })] });
    fireEvent.click(await screen.findByText('Word (.docx)'));
    expect(await screen.findByText('Unknown placeholder: so_hop_dongg (did you mean so_hop_dong?)')).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

describe('bills — Word', () => {
  const billTpl = async () => tpl({ id: 'BT', kind: 'bill', data: await makeDocx(['{so_phieu}', '{IMAGE qr()}']) });
  it('bill Word download', async () => {
    await openApp('#/bills/b1', { bills: [sampleBill({ status: 'sent' })], templates: [await billTpl()] });
    fireEvent.click(await screen.findByText('Word (.docx)'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe('TT-2026-0012_Công ty CP Hoa Sen Xanh.docx');
    expect(await docxText(blob)).toContain('TT-2026-0012');
    expect((await docxMedia(blob)).length).toBe(1);
  });
  it('draft bill Word has _DRAFT and no QR', async () => {
    await openApp('#/bills/b1', { bills: [sampleBill()], templates: [await billTpl()] });
    fireEvent.click(await screen.findByText('Word (.docx)'));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe('TT-2026-0012_Công ty CP Hoa Sen Xanh_DRAFT.docx');
    expect(await docxMedia(blob)).toEqual([]);
  });
  it('bill without template shows the Settings link', async () => {
    await openApp('#/bills/b1', { bills: [sampleBill({ status: 'sent' })] });
    expect((await screen.findByText('Add a template in Settings → Documents')).getAttribute('href')).toBe('#/settings');
    expect(screen.queryByText('Word (.docx)')).toBeNull();
  });
});

describe('contract editor keeps the Drive status', () => {
  it('a Drive upload finishing while the editor is open is not overwritten', async () => {
    const db = await openApp('#/contracts/k1/edit', { contracts: [sampleContract()] });
    await screen.findByText('Save');
    const drive = { fileId: 'f1', link: 'l', savedAt: '2026-09-26T07:05:00.000Z', error: null };
    await putContract(db, { ...(await getContract(db, 'k1'))!, drive });
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Tên mới' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(async () => expect((await getContract(db, 'k1'))!.title).toBe('Tên mới'));
    expect((await getContract(db, 'k1'))!.drive).toEqual(drive);
  });
});
