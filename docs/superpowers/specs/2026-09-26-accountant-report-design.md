# Accountant report — design

Project 3 of the payment bill app. Status: approved in conversation 2026-09-26, pending written-spec review.

## 1. Purpose

The owner gives the accountant a report for a chosen period. The accountant uses it for:
- **the VAT declaration** (monthly or quarterly): output VAT and taxable amounts per rate;
- **the books**: what was billed, what was received, and what is still owed.

The owner issues the official e-invoice **after payment** (see the default footer note), so the VAT figures count bills by **payment date**.

The report is supporting data for the accountant, not a tax filing. The official figures remain the e-invoices.

## 2. Decisions

| Topic | Decision |
|---|---|
| Uses | VAT declaration and books |
| Period | Any From–To date range, with shortcuts: This month, Last month, This quarter, Last quarter, This year |
| VAT basis | Bills **paid** in the period (`from ≤ paidDate ≤ to`) |
| Format | Excel `.xlsx`, four sheets, bilingual headers |
| Library | ExcelJS 4.4 (MIT), loaded only on export, cached for offline use |
| Drive | A **Save to Google Drive** button (not automatic) to `Phiếu thanh toán/Báo cáo/<year>/`; saving the same period again updates the same file |

## 3. The Reports screen

- A new **Reports** menu item and route `#/reports`.
- **From** and **To** date fields. The shortcut buttons fill them:
  - This month; Last month;
  - This quarter; Last quarter (from January, this is Q4 of last year);
  - This year.

  The screen opens on **Last month**.
- An on-screen summary with the same figures as the Summary sheet (§5.1).
- **Download Excel** saves the file.
- **Save to Google Drive** / **Update in Google Drive**, with a status line like the bill's:
  - "Saved to Drive dd/mm/yyyy hh:mm · Open in Drive";
  - "Not saved: … · Retry" (or Reconnect when Google access expired);
  - without Drive configured, "Connect Google Drive in Settings".
- When From is after To, both buttons are disabled and the screen says "The start date must be on or before the end date".

### File name
- A whole calendar month: `Báo cáo 2026-09.xlsx`.
- A whole calendar quarter: `Báo cáo 2026-Q3.xlsx`.
- A whole calendar year: `Báo cáo 2026.xlsx`.
- Anything else: `Báo cáo 2026-09-01 – 2026-10-15.xlsx`.

The Drive folder year is the year of **To**.

## 4. Which bills count

Drafts and cancelled bills never count. The other bills (Sent, Paid) are placed as follows:

- **Paid in the period:** `paidDate` is set and `from ≤ paidDate ≤ to`. The bill date doesn't matter.
- **Billed in the period:** `from ≤ billDate ≤ to`.
- **Owed at the end of the period:** `billDate ≤ to`, and either `paidDate` is empty or `paidDate > to`.
  - **Days overdue** = days from `dueDate` to `to`, or 0 if not yet due.

A bill whose payment was undone has no `paidDate`, so it counts as owed. The report always reflects the bills as they are now.

Amounts come from each bill's saved lines and VAT rate, using `computeTotals`, the same calculation as the bill page. The report therefore always matches the PDFs.

## 5. The Excel file

- Headers are bilingual: Vietnamese on the first line, English on the second (e.g. `Số phiếu / No.`).
- Money cells are numbers with the `#,##0` format.
- Dates are real Excel dates shown as `dd/mm/yyyy`.
- Header rows are bold and frozen, and columns get sensible widths.
- A table with no rows shows one row "Không có / None".

### 5.1 Tổng hợp / Summary
- **Heading:**
  - the title "BÁO CÁO THANH TOÁN / PAYMENT REPORT";
  - the business name and tax ID from Settings;
  - "Kỳ / Period: dd/mm/yyyy – dd/mm/yyyy";
  - "Lập ngày / Made on: dd/mm/yyyy".
- **The VAT table, bills paid in the period:** one row per rate that has bills, in this order:
  - Không chịu thuế / No VAT;
  - 0%;
  - 5%;
  - 8%;
  - 10%.

  Each row has the rate, the number of bills, the amount before VAT, the VAT and the total. A **Tổng cộng / Total** row follows.
- **Totals:**
  - **Đã thu / Received:** total of bills paid in the period.
  - **Đã lập / Billed:** the number of bills and their total, for bills dated in the period.
  - **Còn phải thu / Owed at end:** the number of bills and their total.

### 5.2 Đã thanh toán / Paid
One row per bill paid in the period, sorted by paid date, then number.

Columns:
- STT;
- Số phiếu;
- Ngày lập;
- Ngày thanh toán;
- Khách hàng;
- MST khách hàng;
- Hợp đồng: the reference number, e.g. `12/2026/HĐDV-SM` or `PL01 · 12/2026/HĐDV-SM`;
- Thuế suất;
- Tiền trước thuế;
- Tiền thuế;
- Tổng cộng.

A total row follows.

### 5.3 Đã lập / Billed
One row per bill dated in the period, sorted by bill date, then number.

Columns:
- STT;
- Số phiếu;
- Ngày lập;
- Khách hàng;
- Tổng cộng;
- Trạng thái (Đã gửi / Sent, or Đã thanh toán / Paid);
- Ngày thanh toán.

A total row follows.

### 5.4 Còn phải thu / Owed
One row per bill owed at the end of the period, sorted by due date, then number.

Columns:
- STT;
- Số phiếu;
- Ngày lập;
- Hạn thanh toán;
- Khách hàng;
- Tổng cộng;
- Số ngày quá hạn.

A total row follows.

## 6. Architecture

- **`src/domain/report.ts`** is pure logic with no screen or file code:
  - `buildReport(bills, from, to, s): Report` returns the four tables and the totals;
  - `reportPresets(today): { key, label, from, to }[]`;
  - `reportFileName(from, to): string`.
- **`src/report/excel.ts`:** `reportToXlsx(report): Promise<Blob>`, which loads ExcelJS with `import('exceljs')`.
- **`src/screens/Reports.tsx`:** the screen. `src/router.ts` gains the route `reports`, and `src/app.tsx` gains the menu item.
- **Google Drive** uses the existing connection and queue:
  - `saveReportToDrive(db, report, s)` in `src/drive/service.ts` runs through the same `runJob`, with key `report:<fileName>`;
  - its status (`DriveStatus`) is stored in `meta` under `report-drive:<fileName>`, so a later save updates that file;
  - `reportDriveStatus(db, fileName)` reads it.
- **Offline:** the ExcelJS chunk is precached by the service worker, so Excel export works without internet.

## 7. Edge cases

- **An empty period:** the file is still made, with zeros and "Không có / None" rows.
- **From after To:** the buttons are disabled.
- **A bill paid before its bill date:** it is placed by the rules in §4, with no special case.
- **Drive errors** use the same wording as bills.
- **A report file removed in Drive:** the next save makes a new file, as for bills.

## 8. Testing

Tests are written first.

- **`report.ts`:**
  - both edges of the period are included;
  - a bill paid in the period but issued earlier counts under Paid;
  - drafts and cancelled bills are left out;
  - one VAT row per rate, with No VAT separate from 0%;
  - totals equal the sum of the rows;
  - owed at the end and days overdue;
  - an undone payment counts as owed;
  - presets, including Last quarter from January and Last month from January;
  - file names: month, quarter, year, custom range.
- **`excel.ts`:** load the generated file with ExcelJS and check:
  - the sheet names;
  - the headers;
  - a money cell's value and `#,##0` format;
  - a date cell;
  - the total rows;
  - Vietnamese text;
  - the empty-period file.
- **Screen:**
  - the shortcuts fill the dates;
  - the summary figures;
  - Download gives the right file name;
  - From after To disables the buttons;
  - Save to Google Drive calls the upload with folders `[main, 'Báo cáo', year]`.
- **Drive:** saving the same file name twice updates one file; the status is stored in meta.
- **Manual:**
  - open the file in Excel and Google Sheets;
  - check that SUM works on money columns;
  - check that dates sort correctly;
  - give the file to the accountant.
