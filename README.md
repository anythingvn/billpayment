# Phiếu thanh toán — Payment bill app

Offline browser app for a small business in Vietnam to create **bilingual (Vietnamese / English) payment requests**
with a **VietQR** code, export them as A4 PDFs, track what's been paid, and optionally save them to Google Drive.

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
- **Google Drive (optional):** final bills saved to `My Drive / Phiếu thanh toán / <year> / <customer> / <bill number>.pdf`, automatically on export or with a button.
- **Works offline** and installs as an app (desktop or phone). **Backup / Restore** to a single file.

## Use
1. Open the live app in Chrome, Edge or Safari. Install it: the install icon in the address bar, or *Add to Home screen* on a phone.
2. **Settings:** business details, one or more **bank accounts** (pick the default), footer notes, bill defaults.
3. Add **Customers** and **Services**, then **Bills → + New bill**.
4. **Save & export PDF** marks the bill Sent and opens the save dialog. Send the PDF by email or Zalo.
5. **Back up weekly** (Backup / Restore). Your data lives only in the browser you use — nothing is sent to a server.
   To move to another device or browser, back up there and restore here.

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
- **Stack:** Vite, Preact, TypeScript, IndexedDB (`idb`), `qrcode`, `vite-plugin-pwa`. Drive PDFs use `html2canvas` + `jspdf`, loaded only when uploading.
- **Code map:**
  - `src/domain/` — money, words, VietQR, banks, status and validation rules, contract plans/terms/auto-fill
  - `src/storage/` — IndexedDB, numbering, backup
  - `src/drive/` — Google sign-in, Drive API, folders, upload
  - `src/ui/` — bill page, PDF
  - `src/screens/` — the app's screens
- **Deploy:** every push to `main` runs the tests and publishes to GitHub Pages (`.github/workflows/deploy-pages.yml`); nothing is published if a test fails.
- **Bank list:** `src/domain/banks.ts` is checked against the saved official list in `tests/data/vietqr-banks.json`.
- **Secrets:** only the public Google Client ID is in the code. Never commit `client_secret*.json` files (they're git-ignored).

## Docs
- Design specs: [first version](docs/superpowers/specs/2026-09-25-payment-bill-app-design.md), [Google Drive](docs/superpowers/specs/2026-09-26-google-drive-upload-design.md)
- Build plans: [docs/superpowers/plans/](docs/superpowers/plans/)
- Google Drive setup: [docs/google-drive-setup.md](docs/google-drive-setup.md)
- Manual test checklist: [docs/manual-test-checklist.md](docs/manual-test-checklist.md)
- Sample bill: [docs/sample-bill.pdf](docs/sample-bill.pdf)
