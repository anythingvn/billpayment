import { crc16, buildVietQrPayload, paymentReference } from '../../src/domain/vietqr';
import { bankByBin, BANKS } from '../../src/domain/banks';

describe('crc16', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('paymentReference', () => {
  it('removes hyphens from the bill number', () => {
    expect(paymentReference('TT-2026-0012')).toBe('TT20260012');
  });
});

describe('buildVietQrPayload', () => {
  it('builds the exact payload for the spec example', () => {
    expect(
      buildVietQrPayload({
        bankBin: '970436',
        accountNumber: '0071000123456',
        amount: 20952000,
        reference: 'TT20260012',
      }),
    ).toBe(
      '00020101021238570010A00000072701270006970436011300710001234560208QRIBFTTA53037045408209520005802VN62140810TT202600126304F243',
    );
  });

  it('strips spaces and dots from the account number', () => {
    const a = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071 0001.23456', amount: 20952000, reference: 'TT20260012' });
    const b = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 20952000, reference: 'TT20260012' });
    expect(a).toBe(b);
  });

  it('omits the amount and uses a static code when the total is 0', () => {
    expect(
      buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 0, reference: 'TT20260013' }),
    ).toBe(
      '00020101021138570010A00000072701270006970436011300710001234560208QRIBFTTA53037045802VN62140810TT202600136304F54A',
    );
  });

  it('supports amounts of 1 tỷ and more', () => {
    const p = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 12345678901, reference: 'TT20260014' });
    expect(p).toContain('541112345678901');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it('rejects invalid input', () => {
    expect(() => buildVietQrPayload({ bankBin: '', accountNumber: '123', amount: 1, reference: 'X' })).toThrow();
    expect(() => buildVietQrPayload({ bankBin: '970436', accountNumber: 'abc', amount: 1, reference: 'X' })).toThrow();
  });
});

describe('banks', () => {
  it('finds a bank by BIN and has unique BINs', () => {
    expect(bankByBin('970436')?.shortName).toBe('Vietcombank');
    expect(new Set(BANKS.map((b) => b.bin)).size).toBe(BANKS.length);
  });
});

describe('normalizeAccount', () => {
  it('strips spaces, dots and dashes so validation and the QR agree', async () => {
    const { normalizeAccount } = await import('../../src/domain/vietqr');
    expect(normalizeAccount(' 0071-0001 23.456 ')).toBe('0071000123456');
    const a = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071-0001-23456', amount: 1, reference: 'X' });
    const b = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 1, reference: 'X' });
    expect(a).toBe(b);
  });
});
