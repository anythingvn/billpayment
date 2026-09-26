import { formatVnd, formatDateVn, todayIso, addDays, pdfFileName } from '../../src/domain/format';

describe('formatVnd', () => {
  it('uses dot thousand separators', () => {
    expect(formatVnd(0)).toBe('0');
    expect(formatVnd(800000)).toBe('800.000');
    expect(formatVnd(20952000)).toBe('20.952.000');
    expect(formatVnd(12345678901)).toBe('12.345.678.901');
  });
});

describe('dates', () => {
  it('formats ISO dates as dd/mm/yyyy', () => {
    expect(formatDateVn('2026-09-05')).toBe('05/09/2026');
  });
  it('gives today in local time', () => {
    expect(todayIso(new Date(2026, 8, 25, 23, 59))).toBe('2026-09-25');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-09-25', 10)).toBe('2026-10-05');
    expect(addDays('2026-12-28', 10)).toBe('2027-01-07');
  });
});

describe('pdfFileName', () => {
  it('joins number and customer and strips characters not allowed in filenames', () => {
    expect(pdfFileName('TT-2026-0012', 'Công ty CP Hoa Sen Xanh')).toBe(
      'TT-2026-0012_Công ty CP Hoa Sen Xanh',
    );
    expect(pdfFileName('TT-2026-0013', 'A/B: "C" <D>*?|\\')).toBe('TT-2026-0013_A B C D');
  });
});

describe('draft file name', () => {
  it('adds a DRAFT suffix', () => {
    expect(pdfFileName('TT-2026-0005', 'Hoa Sen Xanh', true)).toBe('TT-2026-0005_Hoa Sen Xanh_DRAFT');
  });
});

describe('file name when the customer name is only symbols', () => {
  it('falls back to the bill number alone', () => {
    expect(pdfFileName('TT-2026-0001', '/:*?')).toBe('TT-2026-0001');
    expect(pdfFileName('TT-2026-0001', '  ', true)).toBe('TT-2026-0001_DRAFT');
  });
});
