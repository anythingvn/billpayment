# Accountant Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Reports screen that builds a payment report for any date range and exports it as a 4-sheet Excel file, downloadable and saveable to Google Drive.

**Architecture:**
- The report is split into three layers:
  - pure figures in `src/domain/report.ts`;
  - an Excel writer in `src/report/excel.ts`, which loads ExcelJS lazily;
  - a screen in `src/screens/Reports.tsx`.
- Drive reuses `runJob` in `src/drive/service.ts` with a new `report` target.
  - Its status lives in `meta` under `report-drive:<fileName>`, because a report is not a stored record.

**Tech Stack:** Vite 8, Preact, TypeScript 7, Vitest 5 (jsdom, fake-indexeddb, @testing-library/preact), `idb`, ExcelJS 4.4 (MIT, new runtime dependency).

**Spec:** `docs/superpowers/specs/2026-09-26-accountant-report-design.md`

## Global Constraints

- Drafts and cancelled bills never count (spec §4).
- **Paid in period:** `paidDate` set and `from ≤ paidDate ≤ to`.
- **Billed in period:** `from ≤ billDate ≤ to`.
- **Owed at end:** `billDate ≤ to` and (`paidDate` empty or `paidDate > to`).
  - Days overdue = max(0, days from `dueDate` to `to`).
- Amounts come only from `computeTotals(bill.lines, bill.vatRate)`.
- **Excel formatting:**
  - money cells are numbers with numFmt `#,##0`;
  - dates are real dates with numFmt `dd/mm/yyyy`;
  - headers are bilingual and use two lines: `'Số phiếu\nNo.'`;
  - header rows are bold and frozen;
  - an empty table has one row `Không có / None`.
- **Sheet names:** `Tổng hợp`, `Đã thanh toán`, `Đã lập`, `Còn phải thu`.
- **File names:**
  - `Báo cáo 2026-09.xlsx`;
  - `Báo cáo 2026-Q3.xlsx`;
  - `Báo cáo 2026.xlsx`;
  - `Báo cáo 2026-09-01 – 2026-10-15.xlsx` (spaced en dash).
- **Drive:**
  - folders `[safeName(main), 'Báo cáo', <year of To>]`;
  - a button, never automatic;
  - the same file name updates the same file.
- **Offline:** ExcelJS is only `import()`ed, and its chunk is precached. Excel export works offline.
- **Copy, verbatim:**
  - "The start date must be on or before the end date";
  - "Download Excel";
  - "Save to Google Drive" / "Update in Google Drive";
  - "Not saved: … · Retry"/"Reconnect";
  - "Connect Google Drive in Settings".
- **Presets:**
  - `This month`, `Last month`, `This quarter`, `Last quarter`, `This year`;
  - the screen opens on `Last month`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Excel date cells shifting a day.** ExcelJS stores JS `Date`s as UTC. A date built from local midnight in Vietnam (UTC+7) lands on the previous day. Pinned in Task 2 (`dates are exact days`): cells are built with `Date.UTC`.
2. **ExcelJS in the real browser.** Node tests use its Node entry, while the browser gets `dist/exceljs.min.js`. The docx-templates bug of project 2 was exactly this gap. Pinned in Task 5 by a manual check of the production build (generate, download, re-open with ExcelJS in the page).
3. **The period boundary on the last day.** A bill paid on `to` counts; one paid on `to + 1` is owed at end. Pinned in Task 1 (`edges are inclusive`).
4. **Last quarter / Last month in January** must roll back to the previous year. Pinned in Task 1 (`presets across a year`).
5. **Saving the same period twice** must update one Drive file, not create two. Pinned in Task 3 (`same file name updates one file`).

---

### Task 1: Report figures

**Files:**
- Create: `src/domain/report.ts`
- Test: `tests/domain/report.test.ts` (bills from `sampleBill` in `tests/fixtures.ts`)

**Interfaces:**
- Consumes: `computeTotals` (`src/domain/money.ts`), `Bill`, `Settings`, `VatRate`, `VAT_RATES` (`src/domain/types.ts`).
- Produces:

```ts
export interface ReportBill {
  number: string; billDate: string; dueDate: string; paidDate: string | null;
  customer: string; customerTaxId: string; contract: string; // '' | '12/2026/HĐDV-SM' | 'PL01 · 12/2026/HĐDV-SM'
  status: 'sent' | 'paid'; vatRate: VatRate; beforeVat: number; vat: number; total: number;
  daysOverdue: number; // relative to report.to; 0 when not overdue
}
export interface VatRow { rate: VatRate; count: number; beforeVat: number; vat: number; total: number }
export interface Report {
  from: string; to: string; madeOn: string; // YYYY-MM-DD
  business: { name: string; taxId: string };
  vat: VatRow[];                 // only rates with bills, in VAT_RATES order
  vatTotal: Omit<VatRow, 'rate'>;
  received: number;              // = vatTotal.total
  billed: { count: number; total: number };
  owed: { count: number; total: number };
  paid: ReportBill[];            // sorted paidDate, number
  billedBills: ReportBill[];     // sorted billDate, number
  owedBills: ReportBill[];       // sorted dueDate, number
}
export function buildReport(bills: Bill[], from: string, to: string, s: Settings, madeOn: string): Report;
export interface ReportPreset { key: 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear'; label: string; from: string; to: string }
export function reportPresets(today: string): ReportPreset[];
export function reportFileName(from: string, to: string): string;
export const vatLabel: (rate: VatRate) => string; // 'Không chịu thuế / No VAT' | '0%' | '5%' | '8%' | '10%'
```

- [ ] **Step 1: Failing tests** in `tests/domain/report.test.ts`:
  - `edges are inclusive`:
    - bills paid `2026-09-01`, `2026-09-30` and `2026-10-01`, with range `2026-09-01..2026-09-30`;
    - `paid` numbers are the first two;
    - the third is in `owedBills` when its billDate ≤ to.
  - `paid in the period but issued earlier`: billDate `2026-08-20`, paidDate `2026-09-05` → in `paid`, not in `billedBills`.
  - `drafts and cancelled never count`: a draft and a cancelled bill (with paidDate/billDate in range) appear in no list and no total.
  - `one VAT row per rate, No VAT separate from 0%`:
    - bills with vatRate `'none'`, `0`, `8`, `8` (one line 1.000.000 each);
    - `vat` equals `[{rate:'none',count:1,beforeVat:1000000,vat:0,total:1000000},{rate:0,count:1,…vat:0},{rate:8,count:2,beforeVat:2000000,vat:160000,total:2160000}]`;
    - `vatTotal.total === received === 4160000`.
  - `owed at end and days overdue`:
    - a sent bill billDate `2026-09-10`, dueDate `2026-09-20`, unpaid → `daysOverdue` 10 for to `2026-09-30`;
    - a bill due `2026-10-05` → 0;
    - a bill paid `2026-10-02` → owed at to `2026-09-30`;
    - `owed` = {count, total} of those.
  - `undone payment counts as owed`: status `sent`, paidDate `null`, billDate in range → owed.
  - `contract column`:
    - `contractRef` with `parentNumber: null` → `'12/2026/HĐDV-SM'`;
    - with `number 'PL01', parentNumber '12/2026/HĐDV-SM'` → `'PL01 · 12/2026/HĐDV-SM'`;
    - none → `''`.
  - `business from Settings`: `{ name: s.businessName, taxId: s.taxId }`.
  - `presets across a year` for `reportPresets('2026-01-15')`:
    - lastMonth `2025-12-01..2025-12-31`;
    - lastQuarter `2025-10-01..2025-12-31`;
    - thisQuarter `2026-01-01..2026-03-31`;
    - thisYear `2026-01-01..2026-12-31`.

    For `'2026-03-10'`, thisMonth is `2026-03-01..2026-03-31`. Labels are `This month`, `Last month`, `This quarter`, `Last quarter`, `This year`.
  - `file names`:
    - `('2026-09-01','2026-09-30')` → `Báo cáo 2026-09.xlsx`;
    - `('2026-07-01','2026-09-30')` → `Báo cáo 2026-Q3.xlsx`;
    - `('2026-01-01','2026-12-31')` → `Báo cáo 2026.xlsx`;
    - `('2026-09-01','2026-10-15')` → `Báo cáo 2026-09-01 – 2026-10-15.xlsx`;
    - `('2026-02-01','2026-02-28')` → `Báo cáo 2026-02.xlsx`.
- [ ] **Step 2: Run** `npx vitest run tests/domain/report.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/domain/report.ts`.
  - Date arithmetic on `YYYY-MM-DD` strings uses `Date.UTC` (no local-time drift).
  - Days overdue = `(Date.UTC(to) - Date.UTC(due)) / 86400000`, floored at 0.
- [ ] **Step 4: Run** `npx vitest run tests/domain/report.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: report figures for the accountant`

---

### Task 2: Excel file

**Files:**
- Create: `src/report/excel.ts`
- Modify: `package.json` (`npm install exceljs@^4.4.0`)
- Test: `tests/report/excel.test.ts`

**Interfaces:**
- Consumes: `Report`, `ReportBill`, `vatLabel`, `reportFileName` (Task 1).
- Produces:
  - `export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`;
  - `export async function reportToXlsx(report: Report): Promise<Blob>`, which loads ExcelJS with `await import('exceljs')`.

- [ ] **Step 1: Failing tests.** Read the blob back with `new ExcelJS.Workbook().xlsx.load(await blob.arrayBuffer())`.
  - `sheet names`: `['Tổng hợp', 'Đã thanh toán', 'Đã lập', 'Còn phải thu']`.
  - `summary`:
    - contains `BÁO CÁO THANH TOÁN / PAYMENT REPORT`, the business name, `Kỳ / Period: 01/09/2026 – 30/09/2026`;
    - the VAT row for 8% has count 2 and total 2160000 as **numbers**, with numFmt `#,##0`;
    - the `Tổng cộng / Total` row is present;
    - it has the Received, Billed and Owed-at-end lines with their numbers.
  - `paid sheet`:
    - header row 1 cell A1 = `'STT\nNo.'` and bold;
    - `ws.views[0].state === 'frozen'`;
    - a row has number `TT-2026-0012`, customer `Công ty CP Hoa Sen Xanh` (Vietnamese intact), and money cells as numbers;
    - the last row is a total whose total cell equals the sum.
  - `dates are exact days`:
    - the paid-date cell is a `Date` equal to `new Date(Date.UTC(2026, 8, 5))`;
    - numFmt `dd/mm/yyyy`.
  - `empty period`: each list sheet has its header and one row whose second cell is `Không có / None`; the summary totals are 0.
- [ ] **Step 2: Run** `npx vitest run tests/report/excel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `reportToXlsx`.
  - Columns per spec §5.2–5.4.
  - Sensible widths; header `wrapText`.
  - Return `new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME })`.
- [ ] **Step 4: Run** `npx vitest run tests/report/excel.test.ts && npm run build`.
  - Expected: PASS.
  - The build shows a separate exceljs chunk, and `dist/sw.js` lists it (grep the chunk name).
- [ ] **Step 5: Commit** `feat: Excel export of the report`

---

### Task 3: Save the report to Google Drive

**Files:**
- Modify: `src/drive/service.ts`
- Test: `tests/drive/service.test.ts`

**Interfaces:**
- Consumes: `runJob`, `recordStatus`, `recordError`, `safeName`, `uploadFile` (existing), `reportToXlsx`, `XLSX_MIME` (Task 2), `Report`, `reportFileName` (Task 1).
- Produces:
  - `export type DriveTarget = DocxTarget | { type: 'report'; id: string }` (id = file name). `Job.target` and `recordStatus` accept it.
    - For `report`, the status is read and written in `meta` key `report-drive:<id>`, with the field ignored.
  - `export function saveReportToDrive(db: AppDb, report: Report, s: Settings): Promise<DriveStatus>`.
    - Key `report:<fileName>`.
    - Folders `[safeName(s.driveFolderName), 'Báo cáo', report.to.slice(0, 4)]`.
    - The existing file id comes from meta.
  - `export async function reportDriveStatus(db: AppDb, fileName: string): Promise<DriveStatus | undefined>`.
  - `onDriveChange` listeners receive the file name for report jobs.
  - `isUploading(fileName)` works through a new key check: `isUploadingFile(id, 'report')`. Extend the union to `'pdf' | 'docx' | 'report'`.
  - `DriveDeps` gains `makeXlsx(report: Report): Promise<Blob>`, defaulting to `reportToXlsx`.

- [ ] **Step 1: Failing tests** (use the file's `setup()` with `makeXlsx: vi.fn(async () => new Blob(['PK']))`):
  - `saves a report under Báo cáo/<year>`:
    - the api `calls` create folders `Phiếu thanh toán` → `Báo cáo` → `2026`, and the file `Báo cáo 2026-09.xlsx`;
    - `reportDriveStatus(db, 'Báo cáo 2026-09.xlsx')` has a fileId and no error.
  - `same file name updates one file`: saving twice makes one create and one update (`fakeDrive` records), with the same fileId.
  - `offline records the error in meta`: `online: () => false` → status error `'Offline'`, stored in `reportDriveStatus`.
- [ ] **Step 2: Run** `npx vitest run tests/drive/service.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `refuse` returns null; `build` returns `{ doc: { blob: await deps.makeXlsx(report), fileName, folders }, mimeType: XLSX_MIME }`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: save the report to Google Drive`

---

### Task 4: Reports screen

**Files:**
- Create: `src/screens/Reports.tsx` (downloads use the existing `downloadBlob` from `src/docs/download.ts`)
- Modify: `src/router.ts` (route `{ name: 'reports' }` ↔ `#/reports`), `src/app.tsx` (NAV item `Reports` after `Contracts`, screen case)
- Test: `tests/ui/reports-ui.test.tsx`. Mock `src/drive/service` as in `tests/ui/documents-drive-ui.test.tsx`, adding `saveReportToDrive` and `reportDriveStatus` mocks. Mock `src/docs/download`.

**Interfaces:**
- Consumes: `buildReport`, `reportPresets`, `reportFileName`, `vatLabel` (Task 1), `reportToXlsx` (Task 2), `saveReportToDrive`, `reportDriveStatus`, `driveConfigured`, `isUploadingFile`, `onDriveChange`, `prepareDrive` (Task 3), `DriveStatusText` (`src/ui/DriveStatusLine.tsx`), `downloadBlob`.

- [ ] **Step 1: Failing tests:**
  - `opens on last month`: with `todayIso` giving a date in 2026-10 (pass bills dated 2026-09), the From/To fields are `2026-09-01`/`2026-09-30`.
  - `shortcuts fill the dates`: clicking `This year` → `2026-01-01`/`2026-12-31`.
  - `summary figures`: the on-screen VAT row `8%` shows count `2` and total `2.160.000`; Received, Billed and Owed at end are shown.
  - `download`: `Download Excel` calls `downloadBlob` with a Blob and `Báo cáo 2026-09.xlsx`.
  - `from after to`: setting From `2026-10-01` and To `2026-09-30` shows `The start date must be on or before the end date`, and both buttons are disabled.
  - `save to Drive`:
    - `Save to Google Drive` calls `saveReportToDrive` with a report whose `from`/`to` match;
    - with `reportDriveStatus` resolving a saved status, the button reads `Update in Google Drive` and the status line shows `Saved to Drive …`.
  - `menu`: the nav shows `Reports`, and clicking it goes to `#/reports`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/reports-ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The screen loads bills with `listBills`, and recomputes the report when the dates change.
  - `prepareDrive` runs on mount.
  - The Drive status reloads on `onDriveChange(name)` for the current file name.
  - Tables use `.table-scroll`.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Reports screen`

---

### Task 5: Docs and manual check

**Files:** Modify `README.md` (a Features bullet "Accountant report", a Use line, and the code map `src/report/`) and `docs/manual-test-checklist.md` (a new section "9. Accountant report" from spec §8 Manual, plus a Last run row).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Manual browser check** on the test port (`bills-test`, 5199) and the production preview (`bills-preview`, 5198), with test data only:
  1. Seed bills across two months with different VAT rates.
  2. Open Reports and pick Last month.
  3. Check the on-screen figures by hand.
  4. Download Excel with the anchor click intercepted, fetch the blob, load it with ExcelJS in the page (dev) or check the zip signature and size (production), and confirm the sheet names and one money cell.
  5. Confirm no console errors.

  Record the result in the ledger.
- [ ] **Step 3: Commit** `docs: accountant report in README and checklist`

---

## Self-review notes
- **Spec coverage:**
  - §3 screen: Task 4;
  - §3 file names: Task 1;
  - §4 rules: Task 1;
  - §5 sheets: Task 2;
  - §6 Drive and meta: Task 3;
  - §6 offline/precache: Task 2 Step 4;
  - §7 edge cases: Tasks 1, 2 and 4;
  - §8 manual: Task 5.
- **Types:**
  - `Report`, `ReportBill`, `VatRow` and `reportFileName` are defined in Task 1 and used unchanged in Tasks 2–4;
  - `DriveTarget` is added in Task 3;
  - `isUploadingFile` is extended in Task 3 and used in Task 4.
