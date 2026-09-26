# Customer Statement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-customer statement of account (balances, details, unpaid bills, QR for the balance, signatures), available as PDF, Word and in Google Drive.

**Architecture:**
- **Figures:** pure functions in `src/domain/statement.ts`.
- **PDF:** an A4 page `src/ui/StatementPage.tsx` in the bill style. It is printed like bills, and made as a Drive PDF by a generalised `makePagePdf`.
- **Word:** a new `statement` template kind, reusing the Word pipeline.
- **Drive:** `saveStatementToDrive` on the shared queue, with statuses in `meta` (`statement-drive:<file>`) that are carried in backups.
- **Screen:** `#/customers/<id>/statement`.

**Tech Stack:** Vite 8, Preact, TypeScript 7, Vitest 5, `idb`, `qrcode`, `html2canvas` + `jspdf`, `docx-templates` (browser bundle).

**Spec:** `docs/superpowers/specs/2026-09-26-customer-statement-design.md`

## Global Constraints

- **Rules (spec §3):**
  - Only the customer's bills count (`bill.customerId === customer.id`); drafts and cancelled bills never count.
  - Amounts come from `computeTotals(lines, vatRate).total`.
  - **Opening balance:** `billDate < from` and (`paidDate` empty or `paidDate ≥ from`).
  - **Billed in the period:** `from ≤ billDate ≤ to`.
  - **Paid in the period:** `from ≤ paidDate ≤ to`.
  - **Closing balance:** opening + billed − paid. This must equal the total of the unpaid rows (`billDate ≤ to` and (`paidDate` empty or `paidDate > to`)).
  - **Days overdue:** from `dueDate` to `min(to, today)`, never below 0.
- **Number and reference:**
  - number `ĐC-<YYYYMMDD of To>-<code>`;
  - reference `DC<YYYYMMDD><code>`: letters and digits only, at most 25 characters;
  - code: the last 4 digits of the tax ID, else the first letters of up to 4 name words (no accents, upper case), else `KH`.
- **Confirm-by date:** statement date + 10 days.
- **File names:**
  - `Đối chiếu <safeName(customer)> <period>.pdf` and the same with `.docx`;
  - the period part is the report's: `2026`, `2026-Q3`, `2026-09`, or `2026-01-01 – 2026-09-26`.
- **Drive:**
  - folders `[safeName(main), 'Đối chiếu', <year of To>, safeName(customer)]`;
  - saved with a button (never automatic);
  - the same file name updates the same file.
- **Copy, verbatim:**
  - the page title "BẢNG ĐỐI CHIẾU CÔNG NỢ / STATEMENT OF ACCOUNT";
  - "Không có / None";
  - "The start date must be on or before the end date";
  - "Add a bank account in Settings to show the VietQR";
  - "Add a template in Settings → Documents";
  - "Export PDF", "Word (.docx)", "Save to Google Drive" / "Update in Google Drive";
  - the button in Customers: "Statement".
- **Presets:**
  - `This year` (1 January to today), the default;
  - `Last year`;
  - `This quarter` (quarter start to today);
  - `Last quarter`;
  - `All time` (the customer's earliest bill date, or today if none, to today).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The closing balance must equal the total of the unpaid rows for any bill set.** The statement is signed, so a mismatch is a real dispute. Pinned in Task 1 (`balances always reconcile`, a loop over 50 seeded random sets).
2. **Multi-page print/PDF:**
   - rows must not split;
   - the balances and the payment + signature block must each stay together;
   - the page must not add a blank page.

   Pinned in Task 2 (`keep blocks are marked`: rows and blocks carry the keep class the PDF slicer uses) and in the Task 6 manual check with 40 bills.
3. **The QR amount and reference must match the closing balance and the printed reference.** A wrong QR is lost money. Pinned in Task 2 (`QR payload`: decode the amount and reference from `statementQrPayload`).
4. **The Word `statement` kind must work through the whole template path:** storage, backup validation, Settings slot and starter. A kind list missed in one place breaks restore or upload. Pinned in Task 3 (`statement kind everywhere`).
5. **Statement Drive status must survive a backup restore,** or the next save makes duplicate files. Pinned in Task 4 (`statement Drive status survives restore`).

---

### Task 1: Statement figures

**Files:**
- Create: `src/domain/statement.ts`
- Modify: `src/domain/report.ts` (export `periodName(from, to)`; `reportFileName` = `` `Báo cáo ${periodName(from, to)}.xlsx` ``)
- Test: `tests/domain/statement.test.ts` (bills from `sampleBill`)

**Interfaces:**
- Consumes: `computeTotals`, `Bill`, `Customer`, `safeName` (`src/drive/paths.ts`).
- Produces:

```ts
export interface StatementRow {
  number: string; billDate: string; dueDate: string; paidDate: string | null; contract: string; total: number;
  billed: number | null;   // total when billed in the period, else null (details rows)
  paid: number | null;     // total when paid in the period, else null (details rows)
  date: string;            // sort date: billDate if billed in period, else paidDate
  daysOverdue: number;     // unpaid rows
}
export interface Statement {
  customer: Customer; from: string; to: string; today: string;
  number: string; reference: string; confirmBy: string;
  opening: number; billed: number; paid: number; closing: number;
  details: StatementRow[];   // sorted date, number
  unpaid: StatementRow[];    // sorted dueDate, number
}
export function buildStatement(bills: Bill[], customer: Customer, from: string, to: string, today: string): Statement;
export function statementCode(customer: Pick<Customer, 'name' | 'taxId'>): string;
export interface StatementPreset { key: 'thisYear' | 'lastYear' | 'thisQuarter' | 'lastQuarter' | 'allTime'; label: string; from: string; to: string }
export function statementPresets(today: string, customerBills: Bill[]): StatementPreset[];
export function statementFileBase(customerName: string, from: string, to: string): string; // no extension
// in report.ts:
export function periodName(from: string, to: string): string;
```

- [ ] **Step 1: Failing tests:**
  - `four balances`:
    - customer `c1`; range `2026-01-01..2026-12-31`, today `2027-01-10`;
    - bills:
      - A: billDate `2025-12-10`, paidDate `2026-01-05`;
      - B: billDate `2025-11-01`, unpaid;
      - C: billDate `2026-03-01`, paidDate `2026-03-20`;
      - D: billDate `2026-11-01`, unpaid;
      - E: billDate `2026-12-20`, paidDate `2027-01-03`;
    - each bill has one line of 1.000.000 at VAT 8% (total 1.080.000);
    - expected: opening = A+B = 2.160.000; billed = C+D+E = 3.240.000; paid = A+C = 2.160.000; closing = 3.240.000 = B+D+E, whose numbers are `unpaid`.
  - `other customers, drafts and cancelled are ignored`.
  - `edges are inclusive`: billDate = `from` counts as billed; paidDate = `to` counts as paid; paidDate = `to + 1` stays unpaid.
  - `details rows`:
    - A has billed null and paid 1.080.000, dated `2026-01-05`;
    - C has billed and paid both 1.080.000, dated `2026-03-01`;
    - the sort is by date, then number.
  - `days overdue stop at today`: with to `2026-12-31`, today `2026-10-05` and a bill due `2026-09-25` unpaid → 10.
  - `number, reference and confirm-by`:
    - with taxId `0109876543` and to `2026-12-31`: number `ĐC-20261231-6543`, reference `DC202612316543`;
    - confirmBy is today + 10 days (`2027-01-20` for today `2027-01-10`).
  - `code falls back to the name`:
    - `{ name: 'Công ty CP Hoa Sen Xanh', taxId: '' }` → `CTCH`;
    - `{ name: 'Đức Anh', taxId: '' }` → `DA`;
    - `{ name: '---', taxId: '' }` → `KH`;
    - every reference matches `/^[A-Z0-9]{1,25}$/`.
  - `balances always reconcile`:
    - a deterministic LCG over seeds 1..50 builds 0–12 bills;
    - it mixes random billDate/paidDate in 2025–2027, statuses sent/paid/draft/cancelled, other customers and VAT rates;
    - it asserts `opening + billed − paid === closing === sum(unpaid.total)`.
  - `presets`:
    - `statementPresets('2026-05-10', bills)` with the earliest customer bill `2025-03-02`:
      - thisYear `2026-01-01..2026-05-10`;
      - lastYear `2025-01-01..2025-12-31`;
      - thisQuarter `2026-04-01..2026-05-10`;
      - lastQuarter `2026-01-01..2026-03-31`;
      - allTime `2025-03-02..2026-05-10`;
    - with no bills, allTime is `2026-05-10..2026-05-10`;
    - the labels are `This year`, `Last year`, `This quarter`, `Last quarter`, `All time`.
  - `file base`:
    - `('Công ty CP Hoa Sen Xanh', '2026-01-01', '2026-12-31')` → `Đối chiếu Công ty CP Hoa Sen Xanh 2026`;
    - `('A/B', '2026-01-01', '2026-09-26')` → `Đối chiếu A B 2026-01-01 – 2026-09-26`.
  - In `tests/domain/report.test.ts`, `periodName` returns `2026-09`, `2026-Q3`, `2026`, and the dated range.
- [ ] **Step 2: Run** `npx vitest run tests/domain/statement.test.ts tests/domain/report.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Strip accents with `normalize('NFD').replace(/[̀-ͯ]/g, '')`, and map `đ/Đ` to `d/D` first.
  - Date arithmetic uses UTC, as in report.ts.
- [ ] **Step 4: Run** `npx vitest run tests/domain`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: customer statement figures`

---

### Task 2: Statement page and PDF

**Files:**
- Create: `src/ui/StatementPage.tsx`
- Modify:
  - `src/ui/bill-page.css` (statement classes);
  - `src/ui/billPdf.tsx`: extract `makePagePdf(page: VNode, keepSelector: string): Promise<Blob>`, used by `makeBillPdf` with `'.bill-table:not(.bill-sum) > tbody > tr, .bill-end'`, plus a new `makeStatementPdf`.
- Test: `tests/ui/statement-page.test.tsx`

**Interfaces:**
- Consumes: `Statement` (Task 1), `defaultBankAccount` (`src/domain/settings.ts`), `buildVietQrPayload`, `vndToWordsVi`/`vndToWordsEn`, `formatVnd`, `formatDateVn`, `bankByBin`.
- Produces:
  - `statementQrPayload(st: Statement, s: Settings): string | null`. It returns null when `closing ≤ 0` or there's no default bank account. The amount is `closing`; the reference is `st.reference`.
  - `StatementPage({ statement, settings, qrDataUrl }): JSX`. The root is `class="bill-sheet stmt"`.
    - Every details row and unpaid row, and the blocks `.stmt-balances` and `.stmt-end` (payment + confirmation + signatures), carry the class `stmt-keep`.
  - `makeStatementPdf(st: Statement, s: Settings): Promise<Blob>` (keep selector `.stmt-keep`).

- [ ] **Step 1: Failing tests:**
  - `shows balances and rows`:
    - the title `BẢNG ĐỐI CHIẾU CÔNG NỢ` is shown, with the number and the period `01/01/2026 – 31/12/2026`;
    - the four balance amounts are shown formatted;
    - the closing amount in words (VI) is shown;
    - each details and unpaid bill number is shown;
    - the total rows are shown.
  - `None rows`: a statement with no details and no unpaid bills shows `Không có / None` twice, and no QR image.
  - `QR only when owed and a bank exists`:
    - closing > 0 with a default bank account → an `img` with alt `VietQR`;
    - no bank account → no image, and no bank block.
  - `QR payload`: `statementQrPayload` contains the amount as `54` + length + closing (the VietQR amount field) and the reference `DC202612316543` (the `62` additional data field).
  - `two signature boxes`: `Bên A / Party A` and `Bên B / Customer`, and the confirm-by date appears.
  - `keep blocks are marked`: the count of `.stmt-keep` equals details rows + unpaid rows + 2.
- [ ] **Step 2: Run** `npx vitest run tests/ui/statement-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Reuse the bill page classes (`bill-head`, `bill-table`, `.en`).
  - Add `.stmt-keep { break-inside: avoid; }` and the balance table styles.
  - `makePagePdf` keeps `makeBillPdf` behaviour identical: the existing print/PDF tests stay green.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: statement page and PDF`

---

### Task 3: Statement Word template

**Files:**
- Modify:
  - `src/domain/types.ts` (`DocKind` adds `'statement'`);
  - `src/storage/backup.ts` (`validTemplate` kinds);
  - `src/docs/catalog.ts`: statement placeholders (spec §5), with `ben_a_*`/`ben_b_*`/`logo` kinds including `statement` and `qr` kinds `['bill', 'statement']`;
  - `src/docs/placeholders.ts` (`statementDocData`);
  - `src/docs/documents.ts` (`buildStatementDocx`);
  - `src/docs/starters.ts` (a `statement` URL);
  - `scripts/make-starters.ts` (the statement starter);
  - `src/screens/SettingsDocuments.tsx`: a Statement slot; `KIND_LABEL.statement = 'statement'`; `STARTER_NAME.statement = 'Statement'`.
- Create: `src/docs/starters/statement.docx` (run `npm run make-starters`).
- Test: `tests/docs/statement-doc.test.ts`, `tests/storage/backup.test.ts`, `tests/ui/documents-ui.test.tsx`

**Interfaces:**
- Consumes: `Statement`, `statementFileBase` (Task 1), `statementQrPayload` (Task 2), `renderDocx`, `logoImage`, `templateFor`.
- Produces:
  - `statementDocData(st: Statement, s: Settings): DocData`, with:
    - scalars `so_doi_chieu`, `ngay_lap`, `tu_ngay`, `den_ngay`, `so_du_dau_ky`, `phat_sinh`, `da_thanh_toan`, `so_du_cuoi_ky`, `so_du_cuoi_ky_chu`, `so_du_cuoi_ky_chu_en`, `ngan_hang`, `so_tai_khoan`, `chu_tai_khoan`, `noi_dung_ck`, `han_xac_nhan`;
    - the flag `con_no`;
    - the tables `chi_tiet_cong_no` (`stt, so_phieu, ngay, hop_dong, phat_sinh, ngay_thanh_toan, thanh_toan`) and `chua_thanh_toan` (`stt, so_phieu, ngay, han, so_ngay_qua_han, so_tien`);
    - `ben_a_*` and `ben_b_*`.
  - `buildStatementDocx(db: AppDb, st: Statement, s: Settings): Promise<BuiltDoc | null>`:
    - the fileName is `${statementFileBase(…)}.docx`;
    - folders `[main, 'Đối chiếu', to.slice(0, 4), customer]`;
    - the QR only when `statementQrPayload` isn't null.

- [ ] **Step 1: Failing tests:**
  - `statement doc data`:
    - `so_du_cuoi_ky` is `3.240.000` and `con_no` is true;
    - `chua_thanh_toan` has 3 rows;
    - `noi_dung_ck` is the reference;
    - `tu_ngay` is `01/01/2026`;
    - `han_xac_nhan` is the confirm-by date as dd/mm/yyyy;
    - no value is null or undefined.
  - `statement starter renders`: `loadStarter`-equivalent bytes from `src/docs/starters/statement.docx` (read with fs) render with `statementDocData`. The text has no `{`, and contains the closing amount and each unpaid number.
  - `checker kind`: `inspectTemplate(makeDocx(['{so_du_cuoi_ky} {so_hop_dong}']), 'statement')` gives `unavailable` `['so_hop_dong']`.
  - `statement kind everywhere`:
    - a backup with a `kind: 'statement'` template parses;
    - Settings → Documents shows `Statement template`;
    - **Use starter statement template** installs a template named `Statement`.
- [ ] **Step 2: Run** `npx vitest run tests/docs tests/storage tests/ui/documents-ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement,** then run `npm run make-starters`. The starter has:
  - header logo;
  - title;
  - number, period and date;
  - the Kính gửi block;
  - a 2-column balances table;
  - the details table and the unpaid table, both with marker rows;
  - `{IF con_no}` bank lines + `{IMAGE qr()}` `{END-IF}`;
  - the confirmation sentence;
  - a 2-column signature table.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS; `dist/sw.js` lists `statement-*.docx`.
- [ ] **Step 5: Commit** `feat: statement Word template`

---

### Task 4: Save the statement to Google Drive

**Files:**
- Modify: `src/drive/service.ts`, `src/storage/backup.ts`
- Test: `tests/drive/service.test.ts`, `tests/storage/backup.test.ts`

**Interfaces:**
- Consumes: `runJob`, `recordStatus`, `DriveTarget` (existing), `makeStatementPdf` (Task 2), `buildStatementDocx` (Task 3), `statementFileBase` (Task 1).
- Produces:
  - `DriveTarget` adds `{ type: 'statement'; id: string }` (id = file name), with its status in meta `statement-drive:<id>`;
  - `DriveDeps` adds:
    - `makeStatementPdf(st: Statement, s: Settings): Promise<Blob>`;
    - `makeStatementDocx(st: Statement, s: Settings, db: AppDb): Promise<BuiltDoc | null>`;
  - `saveStatementToDrive(db, st, s): Promise<{ pdf: DriveStatus; docx: DriveStatus | null }>`:
    - it queues the PDF, then the docx (null when there's no template);
    - keys `statement:<pdfName>` / `statement:<docxName>`;
  - `statementDriveStatus(db, fileName): Promise<DriveStatus | undefined>`;
  - `isUploadingFile(id, 'statement')`;
  - `BackupData.statementDrive: Record<string, DriveStatus>` (parsed and restored like `reportDrive`; old backups → `{}`).

- [ ] **Step 1: Failing tests:**
  - `saves a statement PDF and Word under Đối chiếu`:
    - api calls create `Phiếu thanh toán` → `Đối chiếu` → `2026` → `Công ty CP Hoa Sen Xanh`;
    - then the files `Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf` and `.docx`.
  - `no statement template: PDF only`: `docx` is null, and only the PDF is created.
  - `same statement updates the same files`.
  - `statement Drive status survives restore`: a backup round trip keeps `statement-drive:<name>`; an old backup gives `statementDrive` `{}`; a damaged one is refused.
- [ ] **Step 2: Run** `npx vitest run tests/drive tests/storage`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: save statements to Google Drive`

---

### Task 5: Statement screen

**Files:**
- Create: `src/screens/Statement.tsx`
- Modify:
  - `src/router.ts`: route `{ name: 'customerStatement'; id: string }` ↔ `#/customers/<id>/statement`;
  - `src/app.tsx`: the screen case; the Customers menu item matches `customerStatement`;
  - `src/screens/Customers.tsx`: a `Statement` button per row, archived rows included.
- Test: `tests/ui/statement-ui.test.tsx`. Mock `src/drive/service` (as in `reports-ui.test.tsx`, adding `saveStatementToDrive` and `statementDriveStatus`), `src/docs/download`, `src/ui/print` (`printBill`) and `src/ui/useQrDataUrl`. Fake only `Date`, set to 2026-10-15.

**Interfaces:**
- Consumes:
  - Tasks 1–4;
  - `DriveStatusText`;
  - `downloadBlob`;
  - `printBill(fileTitle)`;
  - `useQrDataUrl`;
  - `buildStatementDocx`;
  - `templateFor(db, 'statement')`.

- [ ] **Step 1: Failing tests:**
  - `Customers has a Statement button`: clicking it opens `#/customers/c1/statement`.
  - `opens on This year`: From `2026-01-01`, To `2026-10-15`, with the preview's closing balance shown.
  - `shortcuts`: `Last year` sets `2025-01-01`/`2025-12-31`.
  - `export PDF`: `printBill` is called with `Đối chiếu Công ty CP Hoa Sen Xanh 2026-01-01 – 2026-10-15`.
  - `Word`:
    - with a statement template, `Word (.docx)` calls `downloadBlob` with `….docx`;
    - without one, the link `Add a template in Settings → Documents` goes to `#/settings`.
  - `Save to Google Drive`: calls `saveStatementToDrive` with the statement for c1 and the dates.
  - `from after to`: shows the message, and the buttons are disabled.
  - `no bank account`: shows `Add a bank account in Settings to show the VietQR`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/statement-ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The status reload and re-render on `onDriveChange` follow Reports.tsx (with the `tick` state).
  - The preview is `<div class="preview-wrap"><StatementPage …/></div>`, and print prints `.bill-sheet`.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: customer statement screen`

---

### Task 6: Docs and manual check

**Files:** Modify `README.md` (a Feature bullet, a Use line, the Drive folder list, the backup note, a spec link), `docs/manual-test-checklist.md` (section "10. Customer statement" from spec §9 Manual, and a Last run row), and `docs/word-templates.md` (the Statement template and its placeholders).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Manual browser check** on the dev server (`bills-test`, 5199) and the production preview (`bills-preview`, 5198), with test data only. Reload after the service worker takes over.
  1. Seed a customer with 40 bills over 2025–2026.
  2. Open the Statement screen, and check the balances by hand.
  3. Print to PDF with headless Chrome from a fixture, or check the page count and that no row is split, using a Quick Look render of `makeStatementPdf` output.
  4. Generate the Word file from the starter, and confirm there are no leftover braces.
  5. Confirm no console errors.

  Record the result in the ledger.
- [ ] **Step 3: Commit** `docs: customer statement in README, checklist and template guide`

---

## Self-review notes
- **Spec coverage:**
  - §3 rules: Task 1;
  - §4 page: Task 2;
  - §4 file names and reference: Task 1;
  - §5 Word: Task 3;
  - §6 screen and Customers button: Task 5;
  - §7 Drive and backup: Task 4;
  - §8 edge cases: Tasks 1, 2 and 5;
  - §9 manual: Task 6.
- **Types:**
  - `Statement`, `StatementRow`, `statementFileBase` and `periodName` are defined in Task 1;
  - `statementQrPayload` and `makeStatementPdf` are defined in Task 2;
  - `buildStatementDocx` is defined in Task 3;
  - `saveStatementToDrive` and `statementDriveStatus` are defined in Task 4;
  - all are used unchanged later.
