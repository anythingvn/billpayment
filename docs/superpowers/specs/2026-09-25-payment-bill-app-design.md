# Payment Bill App — Design Spec

Date: 2026-09-25 · Status: awaiting review

## 1. Purpose and scope

A small business in Vietnam bills customers for services, about 10 bills a month. The owner, as the only user, needs to create a professional **bilingual (Vietnamese / English) payment request (Phiếu thanh toán / Payment request)** with a VietQR code, export it as PDF, send it themselves (email / Zalo), and always know which bills are unpaid.

**Success:** create and export a bill in under 2 minutes; unpaid and overdue amounts visible at a glance.

**Out of scope**
- Official VAT e-invoices (hóa đơn điện tử). Under Decree 123/2020, Circular 78/2021 and Decree 70/2025 these must be issued through a licensed e-invoice provider. The business will use a provider separately; this app produces payment requests only.
- Sending email or Zalo messages from the app.
- Multiple users, logins, servers or sync.
- Currencies other than VND.
- Different VAT rates on different lines of the same bill.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Document type | Payment request, not a tax invoice |
| Platform | Offline browser app (installable), single user |
| Data | Stored in the browser (IndexedDB) + JSON backup file |
| Language on bill | Vietnamese labels with English beneath each |
| Bill style | "A · Classic Vietnamese document": bordered table, signature blocks (see `mockups/bill-style.html`) |
| Editor | 3-step: Customer → Services → Review & export (see `mockups/app-screens.html`, option B) |
| PDF | Browser print → "Save as PDF", A4 print stylesheet |

## 3. Screens

1. **Bills (home):** three summary boxes: Unpaid (amount + count), Overdue (amount + count) and Paid this month (amount + count). A bill list (number, customer, date, due date, total, status badge) with a status filter and search by customer or bill number. The primary action is **+ New bill**. Opening a bill shows its full preview with actions: mark Sent / Paid, Cancel, Duplicate, Export PDF again, and Edit (drafts only).
2. **New / edit bill (3 steps):**
   - **Step 1 · Customer:** choose a saved customer (searchable) or add a new one inline.
   - **Step 2 · Services:** add lines from saved services (Vietnamese name, English name, unit and price fill in) or custom lines, and set the quantity for each. Set the bill-level VAT rate, the bill date (default today) and the due date (default: bill date + the default payment days in Settings). A running subtotal, VAT and total are shown.
   - **Step 3 · Review & export:** a full-size A4 preview drawn by the Bill page part. Buttons: **Save draft** and **Save & export PDF**. The second saves, marks the bill Sent and opens the browser print dialog.
3. **Customers:** list plus add, edit and delete. Fields: name (required), address, tax ID (MST), contact person, email, phone. A customer used on any bill cannot be deleted, only archived.
4. **Services:** list plus add, edit and archive. Fields: Vietnamese name (required), English name, unit Vietnamese / English (e.g. tháng / month), default unit price.
5. **Settings:** business name, tax ID, address, phone, email, logo (optional image), bank (chosen from the NAPAS bank list), account number, account holder, "Prepared by" name, bill number prefix (default `TT`), default VAT rate, default payment days (default 10), optional footer note (default: "Hóa đơn GTGT điện tử sẽ được xuất sau khi thanh toán / An official VAT e-invoice will be issued after payment").
6. **Backup / Restore:** download all data as one `.json` file, or restore from one.

## 4. Bill life cycle

`Draft → Sent → Paid`, plus `Cancelled`.

- **Overdue** is not stored. It is shown when a bill's status is Sent and today is after its due date.
- Drafts can be edited freely.
- Sent, Paid and Cancelled bills are **locked**: they can be viewed, re-exported, duplicated (into a new Draft) or have their status changed, but their content cannot be edited.
- Allowed status changes: Draft → Sent; Sent → Paid; Sent → Cancelled; Draft → Cancelled; Paid → Sent (to undo a mistake). The date is recorded when a bill becomes Paid.

## 5. Content rules

- **Numbering:** `{prefix}-{YYYY}-{NNNN}`, e.g. `TT-2026-0012`. The number is assigned when the bill is first saved, including as a draft. The counter is per year (based on the bill date) and resets to 0001 each year. Numbers are never reused, even after a cancellation.
- **Money:** whole VND (integers). Line amount = qty × unit price. Subtotal = sum of line amounts. VAT = round(subtotal × rate), rounded half up to the nearest đồng. Total = subtotal + VAT. Displayed with dot thousand separators (`20.952.000`).
- **VAT rate options:** Not applicable (no VAT row printed), 0%, 5%, 8%, 10%.
- **Amount in words:** Vietnamese, following standard reading rules (*mốt*, *lăm*, *linh*, *mươi*, *không trăm*), e.g. 20.952.000 → "Hai mươi triệu chín trăm năm mươi hai nghìn đồng". English on the next line, e.g. "Twenty million nine hundred fifty-two thousand dong". The first letter is capitalised and the text ends with a full stop.
- **Payment reference:** the bill number without hyphens (`TT20260012`).
- **VietQR:** generated offline to the NAPAS VietQR / EMVCo merchant-presented format: bank BIN, account number, transaction currency 704, amount = bill total, additional data = payment reference, with a CRC16 checksum. It is shown next to the bank name, account number, account holder and reference.
- **Bill page (A4, style A):** business block and bill number/date at the top; the title **PHIẾU THANH TOÁN** / *PAYMENT REQUEST*; the customer block (Kính gửi / To, address, MST); a bordered table (STT/No., service Vietnamese / English, SL/Qty, unit, Đơn giá/Unit price, Thành tiền/Amount); subtotal, VAT and total rows; amount in words; due date; the VietQR and bank block; the "Người lập phiếu / Prepared by" and "Khách hàng / Customer" signature blocks; the optional footer note. Table rows may run onto page 2; the header row repeats and the totals, QR and signatures stay together.

## 6. Architecture

TypeScript + Preact + Vite, built as static files and made installable (PWA with a service worker for offline use). There is no backend.

| Unit | Responsibility | Depends on |
|---|---|---|
| `storage` | IndexedDB access for customers, services, bills, settings and counters. The only unit that touches stored data. Requests persistent storage. | — |
| `money` | Line, subtotal, VAT and total calculation; VND formatting; amount in words (Vietnamese and English). Pure functions. | — |
| `numbering` | Allocates the next number per year, stored in `storage` in a single transaction, and formats it. | `storage` |
| `vietqr` | Builds the VietQR payload string and renders a QR image. The payload builder is a pure function. | a QR encoding library |
| `bill-page` | Draws a bill (screen preview and print) from a bill record plus settings. Used by both the preview and the PDF. | `money`, `vietqr` |
| `backup` | Exports all data to JSON with a schema version; validates and restores. | `storage` |
| `screens/*` | Home, Editor (3 steps), Customers, Services, Settings, Backup. Presentation only. | all of the above |

**Bill record:** id, number, status, billDate, dueDate, paidDate?, customer snapshot (copied at save time, so later edits to the customer don't change old bills), lines [{nameVi, nameEn, unitVi, unitEn, qty, unitPrice}], vatRate, createdAt, updatedAt. The totals are recomputed by `money`, not stored.

**Export flow:** Step 3 → `numbering` (if the bill is new) → `storage.save` → status Sent → `bill-page` renders in a print view → `window.print()`, where the user chooses "Save as PDF". The suggested filename (via the document title) is `TT-2026-0012_<customer>.pdf`.

## 7. Preventing mistakes

- **Export blocked** until there is a customer, at least one line, and the business name, bank and account number are set in Settings. The message names what is missing and links to it.
- **Input checks:** qty is an integer ≥ 1; unit price is an integer ≥ 0 (0 allowed for free items); the due date must be on or after the bill date.
- **Restore:** the file is validated (schema version, required fields) before anything changes; the app shows a summary ("42 bills, 15 customers") and asks for confirmation; it automatically downloads a backup of the current data before replacing it.
- **Backup reminder:** a banner appears on Home when the last backup is more than 7 days old or has never been made.
- **Unsaved changes:** leaving the editor with unsaved edits asks for confirmation.
- **Storage failure** (IndexedDB unavailable or quota exceeded): a clear error with advice to back up and use a normal (non-private) Chrome or Edge window.

## 8. Testing

- **Unit tests (Vitest):** `money` (VAT rounding, totals, formatting; words for 0, 5, 15, 21, 105, 1.005.015, 21.000.000, 1.000.000.000); `numbering` (sequence, year reset, no reuse after cancel); `vietqr` (payload matches the official format and CRC for known examples); `backup` (round trip is identical; invalid files are rejected); status transition rules.
- **Manual tests:** scan the generated QR with 2–3 Vietnamese banking apps and confirm the bank, account, amount and reference fill in; export PDFs with 3 and 25 lines and check A4 layout, accents and page breaks in Chrome and Edge; back up, clear the site data, restore, and confirm the data is identical.
