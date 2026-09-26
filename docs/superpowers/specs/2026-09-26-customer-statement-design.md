# Customer statement — design

Project 4 of the payment bill app. Status: approved in conversation on 2026-09-26; the written spec is awaiting review.

## 1. Purpose

A per-customer **statement of account** that serves two uses:
- **Chasing payment.** Send it to a customer who owes money. It lists their unpaid bills and how late each is, and gives one VietQR for the total owed.
- **Reconciliation (đối chiếu công nợ).** A formal statement for a period that both sides sign: opening balance, bills issued, payments received and closing balance. Accountants often ask for one at year end.

One document covers both. For chasing, use a period ending today. For reconciliation, use the whole year.

## 2. Decisions

| Topic | Decision |
|---|---|
| Documents | One statement with balances, details, unpaid bills, a QR for the balance, and signatures |
| Format | A built-in PDF in the bill's bilingual A4 style, plus Word when a **Statement** template is uploaded |
| Drive | A **Save to Google Drive** button (not automatic) to `Phiếu thanh toán/Đối chiếu/<year of To>/<customer>/`. The .docx goes next to the PDF when a template exists. Saving the same statement again updates the same files. |
| Entry point | A **Statement** button on each customer in **Customers**, opening `#/customers/<id>/statement` |
| Default period | This year, from 1 January up to today |

## 3. Rules

Drafts and cancelled bills never count. A bill counts in full on its payment date (the app has no partial payments). Amounts come from `computeTotals(bill.lines, bill.vatRate)`, so they match the bill PDFs.

For customer `C` and the period `from … to`, only the bills of `C` (`bill.customerId === C`) are used:

- **Opening balance:** bills with `billDate < from` and (no `paidDate`, or `paidDate ≥ from`).
- **Billed in period:** bills with `from ≤ billDate ≤ to`.
- **Paid in period:** bills with `from ≤ paidDate ≤ to`.
- **Closing balance** = opening + billed − paid. It is always equal to the total of bills with `billDate ≤ to` and (no `paidDate`, or `paidDate > to`).
- **Unpaid at the end of the period:** the bills in that closing set.
  - Their days overdue are counted from `dueDate` to `min(to, today)`, never below 0 (the same rule as the report).

## 4. The statement

- **Title:** BẢNG ĐỐI CHIẾU CÔNG NỢ / STATEMENT OF ACCOUNT.
- **Number:** `ĐC-<YYYYMMDD of To>-<code>`.
- **Payment reference:** `DC<YYYYMMDD of To><code>`. It uses letters and digits only, and is at most 25 characters.
  - **code:** the last 4 digits of the customer's tax ID.
  - When the customer has no tax ID, the code is the first letters of up to 4 words of the name, without accents and upper-case (e.g. "Công ty CP Hoa Sen Xanh" → `CCHS`), or `KH` when the name has no letters.

Sections, in order:
1. **Header:**
   - your business details (from Settings, as on bills);
   - the number;
   - "Ngày lập / Date";
   - "Kỳ đối chiếu / Period dd/mm/yyyy – dd/mm/yyyy";
   - "Kính gửi / To" with the customer's current details: name, address, tax ID and contact.
2. **Balances:** four lines, each in Vietnamese / English with its amount:
   - Số dư đầu kỳ / Opening balance;
   - Phát sinh trong kỳ / Billed in period;
   - Đã thanh toán trong kỳ / Paid in period;
   - Số dư cuối kỳ / Closing balance, in bold, with the amount in words in Vietnamese and English.
3. **Details, "Chi tiết trong kỳ / Details":**
   - one row per bill billed or paid in the period, sorted by date (the bill date, or the payment date when only paid in the period), then by number;
   - columns: STT, Số phiếu, Ngày lập, Hợp đồng, Phát sinh / Billed (the amount when billed in the period), Ngày thanh toán, Thanh toán / Paid (the amount when paid in the period);
   - a total row;
   - "Không có / None" when there are no rows.
4. **Unpaid, "Chưa thanh toán đến cuối kỳ / Unpaid at end of period":**
   - one row per unpaid bill, sorted by due date, then by number;
   - columns: STT, Số phiếu, Ngày lập, Hạn thanh toán, Số ngày quá hạn, Số tiền;
   - a total row;
   - "Không có / None" when there are no rows.
5. **Payment** (only when the closing balance is above 0 and a bank account exists):
   - the bank, account number, holder and reference;
   - a VietQR for the closing balance.
6. **Confirmation:**
   - "Đề nghị Quý khách kiểm tra, xác nhận số dư trên và phản hồi trước ngày …" (the date is 10 days after the statement date) / "Please check and confirm the balance above by …";
   - signature boxes for **Bên A / Party A** (your prepared-by name) and **Bên B / Customer**.

The page reuses the bill page styles:
- rows never split across pages;
- the balances and the payment + confirmation block each stay together;
- there is no grey background in print.

### File names
- The period part follows the report's names:
  - `2026` for a whole calendar year;
  - `2026-Q3` for a quarter;
  - `2026-09` for a month;
  - otherwise `2026-01-01 – 2026-09-26`.
- **PDF:** `Đối chiếu <customer> <period>.pdf`, e.g. `Đối chiếu Công ty CP Hoa Sen Xanh 2026.pdf`. The customer part goes through `safeName`.
- **Word:** the same name with `.docx`.

## 5. Word template

- A new `DocKind` value, `statement`. Settings → Documents gets a **Statement template** slot with Upload / Replace / Download / Remove, a starter `statement.docx`, and **Use starter** (name "Statement").
- **Placeholders**, added to the catalog and the checker with kind `statement`:
  - `ben_a_*` and `ben_b_*` (existing, now also for statements);
  - `so_doi_chieu`, `ngay_lap`, `tu_ngay`, `den_ngay`;
  - `so_du_dau_ky`, `phat_sinh`, `da_thanh_toan`, `so_du_cuoi_ky`, `so_du_cuoi_ky_chu`, `so_du_cuoi_ky_chu_en`;
  - `ngan_hang`, `so_tai_khoan`, `chu_tai_khoan`, `noi_dung_ck`, `han_xac_nhan`;
  - the flag `con_no` (closing balance above 0);
  - the table `chi_tiet_cong_no`, whose rows have `stt`, `so_phieu`, `ngay`, `hop_dong`, `phat_sinh`, `ngay_thanh_toan`, `thanh_toan`;
  - the table `chua_thanh_toan`, whose rows have `stt`, `so_phieu`, `ngay`, `han`, `so_ngay_qua_han`, `so_tien`;
  - the images `{IMAGE qr()}` (only when `con_no`) and `{IMAGE logo()}`.
- The safe command rules, the unknown-placeholder check and "isn't filled in statement documents" apply as for other kinds.
- **Starter:** generated by `scripts/make-starters.ts`, with fixed-width tables and marker-row loops like the other starters.

## 6. Screen

`#/customers/<id>/statement`:
- **Period shortcuts:**
  - This year (1 January to today), which is the default;
  - Last year;
  - This quarter (the quarter start to today);
  - Last quarter;
  - All time (the earliest bill date of this customer to today).
- **From** / **To** fields.
- **Buttons:**
  - **Export PDF**, which uses the print dialog like bills;
  - **Word (.docx)**, or the link "Add a template in Settings → Documents";
  - **Save to Google Drive** / **Update in Google Drive**, with a status line like the report's.
- **Preview:** the statement page, as on the bill screen.
- **Messages:**
  - when From is after To, the buttons are disabled with "The start date must be on or before the end date";
  - with no bank account, the note "Add a bank account in Settings to show the VietQR".
- **Customers list:** each customer row gets a **Statement** button. It also appears for archived customers, when they are shown.

## 7. Architecture

- **`src/domain/statement.ts`:**
  - `buildStatement(bills, customer, from, to, today): Statement`;
  - `statementCode(customer)`;
  - `statementPresets(today, bills)`;
  - `statementFileBase(customer, from, to)`.

  It reuses `computeTotals`, the report's date helpers and the period naming.
- **`src/ui/StatementPage.tsx`:** the A4 page. It uses the bill page styles, adding classes to `bill-page.css`.
- **The PDF for Drive:** it reuses the off-screen render of `src/ui/billPdf.tsx`, generalised to render any page component.
- **Word:**
  - `statementDocData(statement, s)` in `src/docs/placeholders.ts`;
  - `buildStatementDocx` in `src/docs/documents.ts`;
  - the catalog entries;
  - the `statement` kind in storage, backup validation and Settings → Documents.
- **Drive:** `saveStatementToDrive(db, statement, s)` uploads the PDF, then the .docx when a template exists.
  - It uses the shared queue.
  - The statuses are stored in meta as `statement-drive:<file name>` and carried in backups (a `statementDrive` field, like `reportDrive`).
- **Screen:** `src/screens/Statement.tsx`, with the route `customerStatement`, and a button in `src/screens/Customers.tsx`.

## 8. Edge cases

- **Nothing owed:** the closing balance is 0, the unpaid table shows "Không có / None", and there is no QR or payment block.
- **No bills in the period:** the balances are shown (the opening balance may be above 0), and the details table shows "Không có / None".
- **A customer renamed after bills were sent:** the header uses the current details, and rows show each bill's number and date.
- **No tax ID:** the code comes from the name (§4).
- **From after To:** the buttons are disabled.
- **A long statement:** the rows break across pages, and the blocks stay together.
- **No bank account:** there is no QR and no bank block, the on-screen note is shown, and export still works.
- **Drive errors:** the same wording as bills and reports.
- **A customer with no bills at all:** "All time" is from today to today, and everything is 0.

## 9. Testing

Tests are written first.

- **`statement.ts`:**
  - the four balances, including a bill issued before the period and paid inside it;
  - drafts and cancelled bills are left out;
  - both edges of the period count;
  - other customers' bills are ignored;
  - days overdue use `min(to, today)`;
  - the code and reference (the tax ID's last 4 digits, the name fallback without accents, `KH`, length ≤ 25, letters and digits only);
  - presets, including All time;
  - file names;
  - for 50 random bill sets, closing = opening + billed − paid = the total of the unpaid rows.
- **`StatementPage`:**
  - the rows and totals are shown;
  - the QR appears only when the balance is above 0 and a bank account exists;
  - there are two signature boxes;
  - the "Không có / None" rows appear.
- **Word:**
  - `statementDocData` values;
  - the starter renders with no leftover `{…}`;
  - the checker reports "isn't filled in statement documents" for `so_hop_dong`.
- **Screen:**
  - the Statement button in Customers;
  - the shortcuts;
  - the preview figures;
  - Export PDF calls print with the file name;
  - Word downloads, or shows the Settings link;
  - Save to Google Drive calls the upload with the folders `[main, 'Đối chiếu', year, customer]`;
  - From after To disables the buttons.
- **Drive and backup:**
  - saving twice updates the same files;
  - the status is stored in meta and survives a backup restore.
- **Manual:**
  - print or save a 1-page and a multi-page statement;
  - scan the QR with a bank app;
  - open the .docx in Word;
  - save it to Drive.
