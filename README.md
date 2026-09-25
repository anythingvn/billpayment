# Phiếu thanh toán — Payment bill app

Offline browser app for creating bilingual (Vietnamese/English) payment requests with a VietQR code.
This is **not** an official VAT e-invoice; issue those through a licensed e-invoice provider.

## Use
- `npm install`, then `npm run build`. Host the `dist/` folder on any static host (e.g. GitHub Pages) or run `npm run preview`.
- Open it in Chrome or Edge and use "Install app" to add it to your desktop.
- Fill in **Settings** first (business, bank and account for VietQR).
- Your data stays in this browser. Use **Backup / Restore** weekly and keep the file safe.

## Develop
- `npm run dev` for the dev server, `npm test` for the unit tests.
- Design: docs/superpowers/specs/2026-09-25-payment-bill-app-design.md
- Manual checks: docs/manual-test-checklist.md
