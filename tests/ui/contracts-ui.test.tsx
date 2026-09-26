import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';
import { App } from '../../src/app';
import { openAppDb, putSettings, getSettings, putCustomer, putContract, listContracts, getContract, putBill, type AppDb } from '../../src/storage/db';
import { DEFAULT_SETTINGS, type Contract, type Bill } from '../../src/domain/types';
import { todayIso } from '../../src/domain/format';
import { sampleContract, sampleAddendum } from '../contractFixtures';

let n = 0;
const settings = {
  ...DEFAULT_SETTINGS, businessName: 'Sao Mai', driveAutoUpload: false,
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1',
};
export async function openApp(hash: string, data: { contracts?: Contract[]; bills?: Bill[] } = {}): Promise<AppDb> {
  const db = await openAppDb(`contracts-ui-${n++}`);
  await putSettings(db, settings);
  await putCustomer(db, { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });
  for (const c of data.contracts ?? []) await putContract(db, c);
  for (const b of data.bills ?? []) await putBill(db, b);
  location.hash = hash;
  render(<App db={db} initialSettings={await getSettings(db)} />);
  return db;
}
afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
async function fillBasics() {
  fireEvent.change(await screen.findByLabelText(/^Customer/), { target: { value: 'c1' } });
  fireEvent.input(field(/^Title/), { target: { value: 'Hợp đồng thiết kế website' } });
  fireEvent.click(screen.getByText('+ Custom line'));
  fireEvent.input(screen.getByPlaceholderText('Tên dịch vụ'), { target: { value: 'Website' } });
  fireEvent.input(screen.getAllByLabelText('Unit price')[0], { target: { value: '20000000' } });
}

describe('contract editor', () => {
  it('new contract suggests the next number', async () => {
    await openApp('#/contracts/new');
    await waitFor(() => expect(field(/^Contract number/).value).toBe(`1/${todayIso().slice(0, 4)}/HĐDV`));
  });

  it('Save & activate blocks unbalanced instalments; Save draft still saves', async () => {
    const db = await openApp('#/contracts/new');
    await fillBasics();
    fireEvent.change(screen.getByLabelText(/^Billing method/), { target: { value: 'instalments' } });
    fireEvent.click(screen.getByText('+ Add instalment'));
    fireEvent.click(screen.getByText('+ Add instalment'));
    const shares = screen.getAllByLabelText('Share');
    fireEvent.input(shares[0], { target: { value: '50' } });
    fireEvent.input(shares[1], { target: { value: '40' } });
    const names = screen.getAllByLabelText('Instalment name');
    fireEvent.input(names[0], { target: { value: 'Đợt 1' } });
    fireEvent.input(names[1], { target: { value: 'Đợt 2' } });
    fireEvent.click(screen.getByText('Save & activate'));
    expect(await screen.findByText(/Instalments add up to 90%, not 100%/)).toBeTruthy();
    expect(await listContracts(db)).toEqual([]);
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(async () => expect((await listContracts(db)).map((c) => c.status)).toEqual(['draft']));
  });

  it('activating copies customer and business details', async () => {
    const db = await openApp('#/contracts/new');
    await fillBasics();
    fireEvent.click(screen.getByText('Save & activate'));
    await waitFor(async () => {
      const [c] = await listContracts(db);
      expect(c).toMatchObject({ status: 'active', customer: { name: 'Công ty CP Hoa Sen Xanh' }, business: { businessName: 'Sao Mai' }, plan: { type: 'perUse' } });
    });
  });

  it('duplicate number warns but saves', async () => {
    const db = await openApp('#/contracts/new', { contracts: [sampleContract()] });
    await fillBasics();
    fireEvent.input(field(/^Contract number/), { target: { value: '12/2026/HĐDV-SM' } });
    expect(await screen.findByText('Another contract already uses this number')).toBeTruthy();
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(async () => expect(await listContracts(db)).toHaveLength(2));
  });

  it('addendum editor', async () => {
    const db = await openApp('#/contracts/k1/addendum', { contracts: [sampleContract()] });
    await waitFor(() => expect(field(/^Addendum number/).value).toBe('PL01'));
    expect(screen.getByText(/of contract 12\/2026\/HĐDV-SM/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Effect/), { target: { value: 'changesTerms' } });
    fireEvent.input(field(/^Title/), { target: { value: 'Phụ lục 01' } });
    fireEvent.click(screen.getByText('+ Custom line'));
    fireEvent.input(screen.getByPlaceholderText('Tên dịch vụ'), { target: { value: 'Bảo trì' } });
    fireEvent.click(screen.getByText('Save & activate'));
    expect(await screen.findByText(/Choose the date the new terms apply from/)).toBeTruthy();
    fireEvent.input(field(/^Effective date/), { target: { value: '2027-01-01' } });
    fireEvent.click(screen.getByText('Save & activate'));
    await waitFor(async () => {
      const add = (await listContracts(db)).find((c) => c.kind === 'addendum');
      expect(add).toMatchObject({ parentId: 'k1', number: 'PL01', effect: 'changesTerms', effectiveDate: '2027-01-01', status: 'active', customerId: 'c1' });
    });
  });

  it('asks before changing the plan of an active contract', async () => {
    const db = await openApp('#/contracts/k1/edit', { contracts: [sampleContract()] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(await screen.findByLabelText(/^Billing method/), { target: { value: 'perUse' } });
    fireEvent.click(screen.getByText('Save'));
    expect(confirm).toHaveBeenCalledWith('This contract is active. Consider an addendum instead. Change the plan anyway?');
    expect((await getContract(db, 'k1'))!.plan.type).toBe('instalments');
  });
});

describe('contracts list', () => {
  it('shows contracts with value and filters by status', async () => {
    await openApp('#/contracts', { contracts: [sampleContract(), sampleContract({ id: 'k2', number: '1/2026/HĐDV', status: 'draft', title: 'Hợp đồng nháp' }), sampleAddendum()] });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('12/2026/HĐDV-SM')).toBeTruthy();
    expect(within(table).getByText('27.000.000')).toBeTruthy(); // 21.600.000 + addendum 5.400.000
    expect(within(table).queryByText('PL01')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Status/), { target: { value: 'draft' } });
    expect(within(table).queryByText('12/2026/HĐDV-SM')).toBeNull();
    expect(within(table).getByText('1/2026/HĐDV')).toBeTruthy();
  });
});
