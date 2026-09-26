import { safeName, billDrivePath } from '../../src/drive/paths';
import { sampleBill } from '../fixtures';

describe('Drive names', () => {
  it('keeps Vietnamese names and replaces characters Drive/file systems dislike', () => {
    expect(safeName('Công ty CP Hoa Sen Xanh')).toBe('Công ty CP Hoa Sen Xanh');
    expect(safeName('A/B: "C" <D>*?|\\')).toBe('A B C D');
    expect(safeName(' \t ')).toBe('_');
    expect(safeName('x'.repeat(300))).toHaveLength(100);
  });
  it('builds main / year / customer / number.pdf from the bill date', () => {
    const p = billDrivePath({ number: 'TT-2027-0001', billDate: '2027-01-02', customer: { ...sampleBill().customer, name: 'Mama/s' } }, 'Phiếu thanh toán');
    expect(p).toEqual({ folders: ['Phiếu thanh toán', '2027', 'Mama s'], fileName: 'TT-2027-0001.pdf' });
  });
});
