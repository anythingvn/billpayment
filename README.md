# Phiếu thanh toán — Payment bill app

Offline browser app for a small business in Vietnam to create **bilingual (Vietnamese / English) payment requests**
with a **VietQR** code, export them as A4 PDFs, track what's been paid, manage **contracts and addenda**,
fill your own **Word templates** (company letterhead), and optionally save everything to Google Drive.

> This is **not** an official VAT e-invoice (hóa đơn điện tử). Issue those through a licensed e-invoice provider.

**Live app:** https://anythingvn.github.io/billpayment/

## Features
- **Bills in 3 steps:** Bill options + customer → services → review & export. Classic Vietnamese A4 layout with English under each label.
- **Per bill:** VAT (none / 0 / 5 / 8 / 10 %), footer note (picked from saved notes and editable) and bank account (picked from your saved accounts).
- **Service detail lines:** text-only notes printed under a service ("– …"); amounts are unchanged.
- **VietQR:** generated offline with the exact amount and a payment reference (`TT20260012`); all **65 banks** of the official VietQR list.
- **Money in words** in Vietnamese and English; bill numbers `TT-2026-0001`, restarting each year and never reused.
- **Status tracking:** Draft → Sent → Paid, Cancelled; Overdue is shown automatically. Home shows Unpaid / Overdue / Paid this month.
- **Drafts** show a red "BẢN NHÁP / DRAFT" label and no QR; *Download draft PDF* keeps them as drafts.
- **Sent bills are locked** and keep the business details, bank account and footer they were sent with.
- **Contracts and addenda (phụ lục):** numbered `12/2026/HĐDV-SM` / `PL01`; billed by instalments, a fixed amount per month/quarter, or per use.
  Addenda add work or change the terms from a date. Bills fill in from a contract item and print *"Căn cứ Hợp đồng số … ký ngày …"*;
  each contract shows value, billed, paid and left; Home lists what's **to bill** and reminds you after 3 days.
- **Word documents:** your own .docx templates with `{placeholders}` for contracts, addenda and bills, so documents match your letterhead.
  - Several contract templates (one default, chosen per contract), one addendum and one bill template; three starters to begin from.
  - **Check a template** ticks known placeholders and flags typos (*"did you mean so_hop_dong?"*) and ones the document type doesn't fill; only plain placeholders are accepted, so a template can't run code.
  - Bills get the VietQR code; drafts are named `…_DRAFT.docx` and have no QR. See [docs/word-templates.md](docs/word-templates.md).
- **Accountant report:** Reports → pick a period (This/Last month, This/Last quarter, This year, or any dates) → an Excel file (`Báo cáo 2026-09.xlsx`, `Báo cáo 2026-Q3.xlsx`, …):
  - **Tổng hợp / Summary:** VAT per rate for bills **paid** in the period (the e-invoice is issued after payment), money received, billed and still owed;
  - **Đã thanh toán / Paid**, **Đã lập / Billed** and **Còn phải thu / Owed** (with days overdue, up to today for a period not yet ended);
  - real numbers and dates, so SUM and sorting work; the same figures are shown on screen.
- **Customer statement (đối chiếu công nợ):** Customers → **Statement** → pick a period (This year, Last year, quarters, All time, or any dates):
  opening balance, billed, paid and closing balance; every bill in the period; what's unpaid with days overdue; a VietQR for the balance;
  and signature boxes for both sides. Export PDF (same look as bills), **Word** from your own Statement template, or save both to Drive.
- **Google Drive (optional)**, automatically or with a button:
  - bills: `My Drive / Phiếu thanh toán / <year> / <customer> / <bill number>.pdf` on export, with the Word file next to it when you have a bill template;
  - contracts and addenda: `Phiếu thanh toán / Hợp đồng / <year> / <customer> / HĐ … .docx` on **Save & activate**;
  - reports: `Phiếu thanh toán / Báo cáo / <year> / Báo cáo … .xlsx` with a button; saving the same period again updates the same file;
  - customer statements: `Phiếu thanh toán / Đối chiếu / <year> / <customer> / Đối chiếu … .pdf` (and `.docx`) with a button.
- **Works offline** and installs as an app (desktop or phone). **Backup / Restore** to a single file (Word templates and the Drive links of saved reports and statements included).

## Use
1. Open the live app in Chrome, Edge or Safari. Install it: the install icon in the address bar, or *Add to Home screen* on a phone.
2. **Settings:** business details, one or more **bank accounts** (pick the default), footer notes, bill defaults.
3. Add **Customers** and **Services**, then **Bills → + New bill** (or **Contracts → + New contract** and bill from its plan).
4. **Save & export PDF** marks the bill Sent and opens the save dialog. Send the PDF by email or Zalo.
   When the customer pays, **Mark as paid** (the report counts VAT by payment date).
5. **Back up weekly** (Backup / Restore). Your data lives only in the browser you use — nothing is sent to a server.
   To move to another device or browser, back up there and restore here.
6. **Updates:** after a new version is published, the app may open the old version once; reload and the new one appears.

**Word templates:** Settings → Documents → **Use starter** (or download a starter, edit it in Word and upload it).
Then use **Word (.docx)** on a contract, addendum or bill. How to write templates: [docs/word-templates.md](docs/word-templates.md).

**Chasing a payment or year-end reconciliation:** Customers → **Statement** on the customer → pick the period → **Export PDF**
(or **Word**, or **Save to Google Drive**), send it, and ask the customer to sign and return it.

**Report for your accountant:** Reports → pick the period (e.g. **Last month** or **Last quarter**) → **Download Excel**
or **Save to Google Drive**. Compare its VAT per rate with the e-invoices you issued for the same period.

**Google Drive:** Settings → Google Drive → **Connect Google Drive**, choose your account and allow access (once per browser).
No setup is needed; the app only sees the files it creates. Sign in from a normal browser, not an app's built-in browser.
Details and troubleshooting: [docs/google-drive-setup.md](docs/google-drive-setup.md).

**Before real use**, scan a bill's QR code with your banking apps — see [docs/manual-test-checklist.md](docs/manual-test-checklist.md).

## Develop
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # type-check + production build into dist/
```
- **Stack:** Vite, Preact, TypeScript, IndexedDB (`idb`), `qrcode`, `vite-plugin-pwa`. Drive PDFs use `html2canvas` + `jspdf`, loaded only when uploading. Word files use `docx-templates`, loaded only when generating; Excel reports use `exceljs`, loaded only on export.
- **Code map:**
  - `src/domain/` — money, words, VietQR, banks, status and validation rules, contract plans/terms/auto-fill
  - `src/storage/` — IndexedDB, numbering, backup
  - `src/report/` — accountant report Excel file (ExcelJS, loaded only on export); figures in `src/domain/report.ts`; customer statements in `src/domain/statement.ts`
  - `src/docs/` — Word templates: placeholders, checker, render, starters (`npm run make-starters`)
  - `src/drive/` — Google sign-in, Drive API, folders, upload
  - `src/ui/` — bill and statement pages, PDF, lines editor, Drive status line
  - `src/screens/` — the app's screens
- **Deploy:** every push to `main` runs the tests and publishes to GitHub Pages (`.github/workflows/deploy-pages.yml`); nothing is published if a test fails.
- **Word in the browser:** `docx-templates` must be imported from `docx-templates/lib/browser.js` (its Node entry breaks in browsers); a test enforces this. Tests build sample .docx files with `docx` and read them with `jszip` (dev only).
- **Bank list:** `src/domain/banks.ts` is checked against the saved official list in `tests/data/vietqr-banks.json`.
- **Secrets:** only the public Google Client ID is in the code. Never commit `client_secret*.json` files (they're git-ignored).

## Docs
- Design specs: [first version](docs/superpowers/specs/2026-09-25-payment-bill-app-design.md), [contracts](docs/superpowers/specs/2026-09-26-contracts-design.md), [Google Drive](docs/superpowers/specs/2026-09-26-google-drive-upload-design.md), [Word documents](docs/superpowers/specs/2026-09-26-word-documents-design.md), [accountant report](docs/superpowers/specs/2026-09-26-accountant-report-design.md), [customer statement](docs/superpowers/specs/2026-09-26-customer-statement-design.md)
- Build plans: [docs/superpowers/plans/](docs/superpowers/plans/)
- Word templates: [docs/word-templates.md](docs/word-templates.md)
- Google Drive setup: [docs/google-drive-setup.md](docs/google-drive-setup.md)
- Manual test checklist: [docs/manual-test-checklist.md](docs/manual-test-checklist.md)
- Sample bill: [docs/sample-bill.pdf](docs/sample-bill.pdf)
