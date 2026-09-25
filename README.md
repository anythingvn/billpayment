# Phiếu thanh toán — Payment bill app

Offline browser app for creating bilingual (Vietnamese/English) payment requests with a VietQR code.
This is **not** an official VAT e-invoice; issue those through a licensed e-invoice provider.

**Live app:** https://anythingvn.github.io/billpayment/ — open it in Chrome or Edge and choose “Install app”. Your data stays in that browser only; use Backup / Restore to move it.

## Use
- Every push to `main` runs the tests and publishes to GitHub Pages (`.github/workflows/deploy-pages.yml`).
- To run locally: `npm install`, then `npm run dev`.
- Open it in Chrome or Edge and use "Install app" to add it to your desktop.
- Fill in **Settings** first (business, bank and account for VietQR).
- Your data stays in this browser. Use **Backup / Restore** weekly and keep the file safe.

## Develop
- `npm run dev` for the dev server, `npm test` for the unit tests.
- Design: docs/superpowers/specs/2026-09-25-payment-bill-app-design.md
- Manual checks: docs/manual-test-checklist.md
