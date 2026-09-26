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

import { sampleBill } from '../fixtures';
const ref = (itemKey: string | null, contractId = 'k1') =>
  ({ contractId, itemKey, number: '12/2026/HĐDV-SM', signedDate: '2026-09-15', parentNumber: null, parentSignedDate: null });

describe('contract page', () => {
  it('summary', async () => {
    await openApp('#/contracts/k1', {
      contracts: [sampleContract(), sampleAddendum()],
      bills: [sampleBill({ id: 'bp', number: 'TT-2026-0101', status: 'paid', lines: [{ nameVi: 'x', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 10000000, details: [] }], contractRef: ref('i1') })],
    });
    const summary = await screen.findByTestId('contract-summary');
    expect(summary.textContent).toContain('27.000.000');
    expect(summary.textContent).toContain('10.800.000');
    expect(summary.textContent).toContain('16.200.000');
  });

  it('plan table states: Create bill, Mark ready, billed link', async () => {
    const db = await openApp('#/contracts/k1', { contracts: [sampleContract()] });
    const row1 = (await screen.findByText('Đợt 1 – Tạm ứng')).closest('tr')!;
    expect((within(row1).getByText('Create bill') as HTMLAnchorElement).getAttribute('href')).toBe('#/bills/new/contract/k1/i1');
    const row2 = screen.getByText('Đợt 2 – Nghiệm thu').closest('tr')!;
    fireEvent.click(within(row2).getByText('Mark ready'));
    await waitFor(async () => {
      const plan = (await getContract(db, 'k1'))!.plan as Extract<Contract['plan'], { type: 'instalments' }>;
      expect(plan.items[1]).toMatchObject({ ready: true, readyOn: todayIso() });
    });
    expect(await within(screen.getByText('Đợt 2 – Nghiệm thu').closest('tr')!).findByText('Create bill')).toBeTruthy();
  });

  it('billed row links to its bill', async () => {
    await openApp('#/contracts/k1', { contracts: [sampleContract()], bills: [sampleBill({ id: 'b7', number: 'TT-2026-0007', status: 'sent', contractRef: ref('i1') })] });
    const row1 = (await screen.findByText('Đợt 1 – Tạm ứng')).closest('tr')!;
    expect((within(row1).getByText('TT-2026-0007') as HTMLAnchorElement).getAttribute('href')).toBe('#/bills/b7');
  });

  it('addenda and bills listed; + New addendum', async () => {
    await openApp('#/contracts/k1', { contracts: [sampleContract(), sampleAddendum()], bills: [sampleBill({ id: 'b8', number: 'TT-2026-0008', status: 'sent', contractRef: ref(null, 'a1') })] });
    expect((await screen.findAllByText('PL01')).length).toBe(2); // addenda table + the bill's "For" column
    expect(screen.getAllByText('TT-2026-0008').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('+ New addendum'));
    await waitFor(() => expect(location.hash).toBe('#/contracts/k1/addendum'));
  });

  it('delete refused for a contract with bills; Terminate sets the status', async () => {
    const db = await openApp('#/contracts/k1', { contracts: [sampleContract()], bills: [sampleBill({ status: 'sent', contractRef: ref('i1') })] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByText('Delete'));
    expect(await screen.findByText('This contract has bills or addenda. Terminate it instead.')).toBeTruthy();
    fireEvent.click(screen.getByText('Terminate'));
    await waitFor(async () => expect((await getContract(db, 'k1'))!.status).toBe('terminated'));
  });
});
