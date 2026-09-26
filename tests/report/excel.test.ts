import ExcelJS from 'exceljs';
import { reportToXlsx, XLSX_MIME } from '../../src/report/excel';
import { buildReport } from '../../src/domain/report';
import { DEFAULT_SETTINGS, type Bill } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const s = { ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH SAO MAI', taxId: '0312345678' };
const line = { nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details: [] };
const bills: Bill[] = [
  sampleBill({ id: 'a', number: 'TT-2026-0012', status: 'paid', billDate: '2026-09-01', paidDate: '2026-09-05', lines: [line], vatRate: 8 }),
  sampleBill({ id: 'b', number: 'TT-2026-0013', status: 'paid', billDate: '2026-09-02', paidDate: '2026-09-06', lines: [line], vatRate: 8 }),
  sampleBill({ id: 'c', number: 'TT-2026-0014', status: 'sent', billDate: '2026-09-10', dueDate: '2026-09-20', lines: [line], vatRate: 'none' }),
];
async function load(b: Bill[]) {
  const blob = await reportToXlsx(buildReport(b, '2026-09-01', '2026-09-30', s, '2026-10-02'));
  expect(blob.type).toBe(XLSX_MIME);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}
/** All cell values of a sheet, row by row. */
const values = (ws: ExcelJS.Worksheet) => {
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => out.push((row.values as unknown[]).slice(1)));
  return out;
};
const findRow = (ws: ExcelJS.Worksheet, text: string) => {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => { if (!found && (row.values as unknown[]).some((v) => typeof v === 'string' && v.includes(text))) found = row; });
  if (!found) throw new Error(`no row with ${text}`);
  return found;
};
const nums = (row: ExcelJS.Row) => (row.values as unknown[]).filter((v): v is number => typeof v === 'number');

describe('reportToXlsx', () => {
  it('sheet names', async () => {
    expect((await load(bills)).worksheets.map((w) => w.name)).toEqual(['Tổng hợp', 'Đã thanh toán', 'Đã lập', 'Còn phải thu']);
  });

  it('summary', async () => {
    const ws = (await load(bills)).getWorksheet('Tổng hợp')!;
    const text = values(ws).flat().filter((v) => typeof v === 'string').join('\n');
    expect(text).toContain('BÁO CÁO THANH TOÁN / PAYMENT REPORT');
    expect(text).toContain('CÔNG TY TNHH SAO MAI');
    expect(text).toContain('Kỳ / Period: 01/09/2026 – 30/09/2026');
    const vat8 = findRow(ws, '8%');
    expect(nums(vat8)).toEqual([2, 2000000, 160000, 2160000]);
    const moneyCell = vat8.getCell(5);
    expect([moneyCell.value, moneyCell.numFmt]).toEqual([2160000, '#,##0']);
    expect(nums(findRow(ws, 'Tổng cộng / Total'))).toEqual([2, 2000000, 160000, 2160000]);
    expect(nums(findRow(ws, 'Đã thu / Received'))).toEqual([2160000]);
    expect(nums(findRow(ws, 'Đã lập / Billed'))).toEqual([3, 3160000]);
    expect(nums(findRow(ws, 'Còn phải thu / Owed at end'))).toEqual([1, 1000000]);
  });

  it('paid sheet', async () => {
    const ws = (await load(bills)).getWorksheet('Đã thanh toán')!;
    expect(ws.getCell('A1').value).toBe('STT\nNo.');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.views[0].state).toBe('frozen');
    const row = findRow(ws, 'TT-2026-0012');
    expect(row.values).toContain('Công ty CP Hoa Sen Xanh');
    expect(nums(row).slice(-3)).toEqual([1000000, 80000, 1080000]);
    const last = ws.getRow(ws.rowCount);
    expect(nums(last).slice(-3)).toEqual([2000000, 160000, 2160000]);
  });

  it('dates are exact days', async () => {
    const ws = (await load(bills)).getWorksheet('Đã thanh toán')!;
    const row = findRow(ws, 'TT-2026-0012');
    const dates = (row.values as unknown[]).filter((v): v is Date => v instanceof Date);
    expect(dates.map((d) => d.getTime())).toEqual([Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 5)]);
    const cell = row.getCell(3);
    expect(cell.numFmt).toBe('dd/mm/yyyy');
  });

  it('billed and owed sheets', async () => {
    const wb = await load(bills);
    const billed = wb.getWorksheet('Đã lập')!;
    expect(findRow(billed, 'TT-2026-0014').values).toContain('Đã gửi / Sent');
    expect(findRow(billed, 'TT-2026-0012').values).toContain('Đã thanh toán / Paid');
    const owed = wb.getWorksheet('Còn phải thu')!;
    expect(nums(findRow(owed, 'TT-2026-0014'))).toEqual([1, 1000000, 10]);
  });

  it('empty period', async () => {
    const wb = await load([]);
    for (const name of ['Đã thanh toán', 'Đã lập', 'Còn phải thu']) {
      const ws = wb.getWorksheet(name)!;
      expect(ws.getRow(2).getCell(2).value).toBe('Không có / None');
    }
    expect(nums(findRow(wb.getWorksheet('Tổng hợp')!, 'Đã thu / Received'))).toEqual([0]);
  });
});
