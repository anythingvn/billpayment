import type { Worksheet } from 'exceljs';
import { formatDateVn } from '../domain/format';
import { vatLabel, type Report, type ReportBill } from '../domain/report';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MONEY = '#,##0';
const DATE = 'dd/mm/yyyy';
const NONE = 'Không có / None';
const TOTAL = 'Tổng cộng / Total';

/** A real Excel date for YYYY-MM-DD. Built in UTC, as ExcelJS writes dates in UTC (no day shift in Vietnam). */
const day = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

interface Column { header: string; width: number; value: (b: ReportBill, i: number) => string | number | Date | null; fmt?: string; sum?: boolean }

const col = {
  stt: { header: 'STT\nNo.', width: 6, value: (_b, i) => i + 1 } as Column,
  number: { header: 'Số phiếu\nNo.', width: 15, value: (b) => b.number } as Column,
  billDate: { header: 'Ngày lập\nBill date', width: 12, value: (b) => day(b.billDate), fmt: DATE } as Column,
  paidDate: { header: 'Ngày thanh toán\nPaid on', width: 14, value: (b) => day(b.paidDate), fmt: DATE } as Column,
  dueDate: { header: 'Hạn thanh toán\nDue date', width: 14, value: (b) => day(b.dueDate), fmt: DATE } as Column,
  customer: { header: 'Khách hàng\nCustomer', width: 34, value: (b) => b.customer } as Column,
  taxId: { header: 'MST khách hàng\nCustomer tax ID', width: 16, value: (b) => b.customerTaxId } as Column,
  contract: { header: 'Hợp đồng\nContract', width: 26, value: (b) => b.contract } as Column,
  rate: { header: 'Thuế suất\nVAT rate', width: 12, value: (b) => vatLabel(b.vatRate) } as Column,
  before: { header: 'Tiền trước thuế\nBefore VAT', width: 16, value: (b) => b.beforeVat, fmt: MONEY, sum: true } as Column,
  vat: { header: 'Tiền thuế\nVAT', width: 14, value: (b) => b.vat, fmt: MONEY, sum: true } as Column,
  total: { header: 'Tổng cộng\nTotal', width: 16, value: (b) => b.total, fmt: MONEY, sum: true } as Column,
  status: { header: 'Trạng thái\nStatus', width: 22, value: (b) => (b.status === 'paid' ? 'Đã thanh toán / Paid' : 'Đã gửi / Sent') } as Column,
  overdue: { header: 'Số ngày quá hạn\nDays overdue', width: 14, value: (b) => b.daysOverdue } as Column,
};

function header(ws: Worksheet, labels: string[]) {
  const row = ws.addRow(labels);
  row.font = { bold: true };
  row.alignment = { wrapText: true, vertical: 'middle' };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; });
}

/** One list sheet: bilingual header (frozen), one row per bill, and a total row. */
function listSheet(ws: Worksheet, columns: Column[], bills: ReportBill[]) {
  ws.columns = columns.map((c) => ({ width: c.width }));
  header(ws, columns.map((c) => c.header));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (bills.length === 0) {
    ws.addRow(['', NONE]);
    return;
  }
  bills.forEach((b, i) => {
    const row = ws.addRow(columns.map((c) => c.value(b, i)));
    columns.forEach((c, j) => { if (c.fmt) row.getCell(j + 1).numFmt = c.fmt; });
  });
  const totals = columns.map((c, j) => (c.sum ? bills.reduce((a, b) => a + (c.value(b, 0) as number), 0) : j === 1 ? TOTAL : null));
  const row = ws.addRow(totals);
  row.font = { bold: true };
  columns.forEach((c, j) => { if (c.sum) row.getCell(j + 1).numFmt = MONEY; });
}

function summarySheet(ws: Worksheet, r: Report) {
  ws.columns = [{ width: 34 }, { width: 12 }, { width: 18 }, { width: 16 }, { width: 18 }];
  ws.addRow(['BÁO CÁO THANH TOÁN / PAYMENT REPORT']).font = { bold: true, size: 14 };
  ws.addRow([r.business.name]).font = { bold: true };
  ws.addRow([`MST / Tax ID: ${r.business.taxId}`]);
  ws.addRow([`Kỳ / Period: ${formatDateVn(r.from)} – ${formatDateVn(r.to)}`]);
  ws.addRow([`Lập ngày / Made on: ${formatDateVn(r.madeOn)}`]);
  ws.addRow([]);
  ws.addRow(['Thuế GTGT theo phiếu đã thanh toán / VAT on bills paid in the period']).font = { bold: true };
  header(ws, ['Thuế suất\nVAT rate', 'Số phiếu\nBills', 'Tiền trước thuế\nBefore VAT', 'Tiền thuế\nVAT', 'Tổng cộng\nTotal']);
  const money = (row: ReturnType<Worksheet['addRow']>, from: number) => {
    for (let j = from; j <= row.cellCount; j++) row.getCell(j).numFmt = MONEY;
  };
  if (r.vat.length === 0) ws.addRow([NONE]);
  for (const v of r.vat) money(ws.addRow([vatLabel(v.rate), v.count, v.beforeVat, v.vat, v.total]), 3);
  const total = ws.addRow([TOTAL, r.vatTotal.count, r.vatTotal.beforeVat, r.vatTotal.vat, r.vatTotal.total]);
  total.font = { bold: true };
  money(total, 3);
  ws.addRow([]);
  // Count under "Bills", amount under "Total", like the VAT table above.
  money(ws.addRow(['Đã thu / Received', r.vatTotal.count, null, null, r.received]), 5);
  money(ws.addRow(['Đã lập / Billed', r.billed.count, null, null, r.billed.total]), 5);
  money(ws.addRow(['Còn phải thu / Owed at end', r.owed.count, null, null, r.owed.total]), 5);
}

/** The accountant report as an .xlsx file: Summary, Paid, Billed and Owed sheets. ExcelJS loads only when called. */
export async function reportToXlsx(report: Report): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Phiếu thanh toán';
  summarySheet(wb.addWorksheet('Tổng hợp'), report);
  listSheet(wb.addWorksheet('Đã thanh toán'),
    [col.stt, col.number, col.billDate, col.paidDate, col.customer, col.taxId, col.contract, col.rate, col.before, col.vat, col.total], report.paid);
  listSheet(wb.addWorksheet('Đã lập'), [col.stt, col.number, col.billDate, col.customer, col.total, col.status, col.paidDate], report.billedBills);
  listSheet(wb.addWorksheet('Còn phải thu'), [col.stt, col.number, col.billDate, col.dueDate, col.customer, col.total, col.overdue], report.owedBills);
  return new Blob([await wb.xlsx.writeBuffer() as BlobPart], { type: XLSX_MIME });
}
