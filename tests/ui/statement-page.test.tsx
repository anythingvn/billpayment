import { render, screen, cleanup } from '@testing-library/preact';
import { StatementPage, statementQrPayload } from '../../src/ui/StatementPage';
import { buildStatement } from '../../src/domain/statement';
import { DEFAULT_SETTINGS, type Bill, type Customer, type Settings } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const customer: Customer = { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: '', email: '', phone: '', archived: false };
const withBank: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH SAO MAI', preparedBy: 'Nguyễn Văn An',
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: 'SAO MAI' }], defaultBankAccountId: 'a1',
};
const noBank: Settings = { ...withBank, bankAccounts: [], defaultBankAccountId: '' };
const line = { nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details: [] };
let n = 0;
const bill = (billDate: string, paidDate: string | null = null): Bill => {
  n++;
  return sampleBill({ id: `b${n}`, number: `TT-2026-00${10 + n}`, customerId: 'c1', billDate, dueDate: billDate, paidDate, status: paidDate ? 'paid' : 'sent', lines: [line], vatRate: 8 });
};
const bills = [bill('2025-12-10', '2026-01-05'), bill('2025-11-01'), bill('2026-03-01', '2026-03-20'), bill('2026-11-01'), bill('2026-12-20', '2027-01-03')];
const st = buildStatement(bills, customer, '2026-01-01', '2026-12-31', '2027-01-10');
const empty = buildStatement([], customer, '2026-01-01', '2026-12-31', '2027-01-10');
afterEach(cleanup);

describe('StatementPage', () => {
  it('shows balances and rows', () => {
    render(<StatementPage statement={st} settings={withBank} qrDataUrl="data:image/png;base64,AA" />);
    expect(screen.getByText('BẢNG ĐỐI CHIẾU CÔNG NỢ')).toBeTruthy();
    expect(screen.getByText('ĐC-20261231-6543')).toBeTruthy();
    expect(screen.getByText(/01\/01\/2026 – 31\/12\/2026/)).toBeTruthy();
    const balances = document.querySelector('.stmt-balances')!.textContent!;
    for (const amount of ['2.160.000', '3.240.000']) expect(balances).toContain(amount);
    expect(balances).toContain('Ba triệu hai trăm bốn mươi nghìn đồng');
    for (const b of bills) expect(document.body.textContent).toContain(b.number);
    expect(document.querySelectorAll('.stmt-total').length).toBe(2);
  });
  it('None rows and no QR when nothing is owed', () => {
    render(<StatementPage statement={empty} settings={withBank} qrDataUrl="data:image/png;base64,AA" />);
    expect(screen.getAllByText('Không có / None')).toHaveLength(2);
    expect(screen.queryByAltText('VietQR')).toBeNull();
  });
  it('QR only when owed and a bank exists', () => {
    render(<StatementPage statement={st} settings={withBank} qrDataUrl="data:image/png;base64,AA" />);
    expect(screen.getByAltText('VietQR')).toBeTruthy();
    expect(document.body.textContent).toContain('DC202612316543');
    cleanup();
    render(<StatementPage statement={st} settings={noBank} qrDataUrl={null} />);
    expect(screen.queryByAltText('VietQR')).toBeNull();
    expect(document.querySelector('.stmt-bank')).toBeNull();
  });
  it('QR payload', () => {
    const p = statementQrPayload(st, withBank)!;
    expect(p).toContain('54073240000');
    expect(p).toContain('DC202612316543');
    expect(statementQrPayload(empty, withBank)).toBeNull();
    expect(statementQrPayload(st, noBank)).toBeNull();
  });
  it('two signature boxes', () => {
    render(<StatementPage statement={st} settings={withBank} qrDataUrl={null} />);
    expect(screen.getByText('Bên A / Party A')).toBeTruthy();
    expect(screen.getByText('Bên B / Customer')).toBeTruthy();
    expect(document.body.textContent).toContain('20/01/2027');
    expect(document.body.textContent).toContain('Nguyễn Văn An');
  });
  it('keep blocks are marked', () => {
    render(<StatementPage statement={st} settings={withBank} qrDataUrl={null} />);
    expect(document.querySelectorAll('.stmt-keep').length).toBe(st.details.length + st.unpaid.length + 2);
  });
});
