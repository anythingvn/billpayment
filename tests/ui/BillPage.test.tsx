import { render, screen } from '@testing-library/preact';
import { BillPage, billQrPayload } from '../../src/ui/BillPage';
import { draftFromBill } from '../../src/domain/draft';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const settings: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH THIẾT KẾ SAO MAI', taxId: '0312345678',
  bankBin: '970436', accountNumber: '0071000123456', accountHolder: 'CONG TY TNHH THIET KE SAO MAI', preparedBy: 'Nguyễn Văn An',
};

const bill = draftFromBill(
  sampleBill({
    lines: [
      { nameVi: 'Thiết kế logo', nameEn: 'Logo design', unitVi: '', unitEn: '', qty: 1, unitPrice: 5000000 },
      { nameVi: 'Website gói cơ bản', nameEn: 'Basic website', unitVi: '', unitEn: '', qty: 1, unitPrice: 12000000 },
      { nameVi: 'Bảo trì website', nameEn: 'Maintenance', unitVi: 'tháng', unitEn: 'month', qty: 3, unitPrice: 800000 },
    ],
  }),
);

describe('BillPage', () => {
  it('renders the bilingual title, number, customer, lines and totals', () => {
    render(<BillPage bill={bill} settings={settings} qrDataUrl="data:image/png;base64,xx" />);
    expect(screen.getByText('PHIẾU THANH TOÁN')).toBeTruthy();
    expect(screen.getByText('PAYMENT REQUEST')).toBeTruthy();
    expect(screen.getByText('TT-2026-0012')).toBeTruthy();
    expect(screen.getByText('Công ty CP Hoa Sen Xanh')).toBeTruthy();
    expect(screen.getByText('Bảo trì website')).toBeTruthy();
    expect(screen.getByText('2.400.000')).toBeTruthy();
    expect(screen.getByText('1.552.000')).toBeTruthy();
    expect(screen.getByText('20.952.000')).toBeTruthy();
    expect(screen.getByText('Hai mươi triệu chín trăm năm mươi hai nghìn đồng.')).toBeTruthy();
    expect(screen.getByText('Twenty million nine hundred fifty-two thousand dong.')).toBeTruthy();
    expect(screen.getByText('TT20260012')).toBeTruthy();
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
    expect(screen.getByAltText('VietQR')).toBeTruthy();
  });

  it('omits the VAT row when VAT is not applicable', () => {
    render(<BillPage bill={{ ...bill, vatRate: 'none' }} settings={settings} qrDataUrl={null} />);
    expect(screen.queryByText(/Thuế GTGT/)).toBeNull();
  });

  it('marks an unnumbered draft', () => {
    render(<BillPage bill={{ ...bill, number: null }} settings={settings} qrDataUrl={null} />);
    expect(screen.getByText('(chưa đánh số / not numbered)')).toBeTruthy();
  });
});

describe('billQrPayload', () => {
  it('uses the bill total and reference', () => {
    expect(billQrPayload(bill, settings)).toContain('540820952000');
    expect(billQrPayload(bill, settings)).toContain('0810TT20260012');
  });
  it('is null without a number or bank details', () => {
    expect(billQrPayload({ ...bill, number: null }, settings)).toBeNull();
    expect(billQrPayload(bill, { ...settings, bankBin: '' })).toBeNull();
  });
});
