# Manual test checklist

Run before first real use, and again after changes to the bill page, VietQR, backup or Google Drive.
Automatic tests (`npm test`) cover the calculations and rules; this list covers what only a person,
a real printer, a real bank app or a real Google account can confirm.

Use Chrome or Edge on a computer unless a line says otherwise. The online app is
https://anythingvn.github.io/billpayment/ — the same checks apply to `http://localhost:5173`.

## Last run
| Date | Who | Result |
|---|---|---|
| 2026-09-26 | Owner | Google Drive: Connect and first upload OK (Chrome, localhost:5173) |
| 2026-09-26 | Automated test | Bank list = all 65 banks of the official VietQR list, BINs match (`npm test`) |
| 2026-09-26 | Automated print check | 3-line bill = 1 page, 25-line bill = 2 pages (no row cut, end block together), draft PDF label/watermark, no grey background, hidden Drive copy adds no page |

Add a row each time you run the list.

## 1. VietQR with real banking apps (most important)
Use your real bank account in Settings. Create a bill for 10.000 ₫ and export the PDF.
Scan the QR (from screen and from a printed/PDF copy) with at least 3 apps, e.g. Vietcombank, MB Bank, Techcombank:
- [ ] Bank and account number are filled in; the account holder name shown by the bank app is correct
- [ ] Amount is exactly 10.000 ₫
- [ ] Transfer content shows the reference (e.g. TT20260001)
- [ ] (Optional) Make the 10.000 ₫ transfer and confirm it arrives with that content
- [ ] **Second bank account:** repeat the scan with a bill that uses your other account (Bill options → Bank account)
- [ ] Your banks' BINs match https://api.vietqr.io/v2/banks (automatic: `npm test` compares all 65 with the saved copy in `tests/data/vietqr-banks.json`)
- [ ] **A bank newly added to the list** (e.g. SCB, NCB, CAKE, Timo, MoMo): if you or a customer use one, scan a bill's QR with that bank's app — some entries (e.g. ViettelMoney, VNPT Money, HSBC, most foreign branches) are marked by VietQR as not supporting QR transfers
- [ ] When VietQR's official list changes: refresh `tests/data/vietqr-banks.json` from the link above and update `src/domain/banks.ts` until `npm test` passes

## 2. PDF / print
- [ ] 3-line bill: one A4 page, nothing cut off, Vietnamese accents correct, QR sharp, **white** page (no grey area)
- [ ] 3 services with detail lines: still one page
- [ ] 25-line bill: table continues on page 2 with the header row repeated; totals, words, QR and signatures stay together
- [ ] Detail lines print as "– …" under their service, smaller, and don't change amounts
- [ ] Suggested file name is `<number>_<customer>`; a customer name made only of symbols gives just `<number>`
- [ ] VAT "Not applicable": no VAT row; 0%: VAT row with 0
- [ ] Footer note: the one chosen on the bill prints; an empty footer prints nothing
- [ ] Logo (if set) appears and is not stretched

## 3. Bills
- [ ] New bill, step 1 **Bill options** starts with your default VAT, default footer note and default bank account
- [ ] Changing the bill date keeps the same number of days to the due date (e.g. a 20-day gap stays 20 days)
- [ ] A numbered draft re-dated into next year gets that year's next number when saved
- [ ] Save & export marks the bill Sent; the bill is then locked (Duplicate to change it)
- [ ] **Business details:** send a bill, change your business name in Settings, re-export the old bill → it still shows the old name; a new bill shows the new name
- [ ] Draft view: red "BẢN NHÁP / DRAFT" label and watermark, no QR, "not for payment"; **Download draft PDF** saves `<number>_<customer>_DRAFT` and the bill stays a Draft
- [ ] **← Back to bills** returns to the list from any bill

## 4. Settings
- [ ] Bank dropdown lists 65 banks, with Vietcombank, VietinBank, BIDV, Agribank, Techcombank, MB Bank at the top
- [ ] Two bank accounts: add, pick the default, remove one; a number like `99x` is refused with a message
- [ ] Footer notes: add, edit, pick default or "No footer by default"; blank notes disappear on Save
- [ ] Settings survive a page reload

## 5. Backup
- [ ] Back up → clear site data → restore → bills, customers, services, settings (bank accounts, footer notes) identical
- [ ] New bill after restore continues numbering
- [ ] Restoring a non-backup file shows an error and changes nothing
- [ ] After a restore, Settings → Google Drive still shows "Connected as …" on this device

## 6. Online app and offline
- [ ] The online address opens and can be installed (Install app / Add to Home screen)
- [ ] Installed app opens with Wi-Fi off and can create and export a bill
- [ ] Moving data: Backup on localhost:5173 → Restore on the online app → everything is there

## 7. Google Drive
Uses the built-in Client ID (see `docs/google-drive-setup.md`). The Google client must list both origins:
`https://anythingvn.github.io` and `http://localhost:5173`. Sign in from a normal browser (not an app's built-in browser).
- [x] Settings → Google Drive → Connect (no Client ID typed): Google's window opens; afterwards "Connected as <email>" *(2026-09-26, localhost)*
- [x] Save & export a bill: the save dialog opens as usual, and Drive gets `Phiếu thanh toán/<year>/<customer>/<number>.pdf` *(2026-09-26, localhost)*
- [ ] The same two checks on the **online app** (GitHub Pages address)
- [ ] The Drive PDF opens and looks like the on-screen bill (accents, QR, totals, detail lines)
- [ ] Bill view shows "Saved to Drive <date time> · Open in Drive" and the link opens the file
- [ ] Update in Google Drive: still one file; Drive's "Manage versions" shows a new version
- [ ] Delete the file in Drive, then Update: a new file is created in the same folder
- [ ] A customer with an apostrophe (e.g. `Nhà hàng Mama's`) gets its own folder, no error
- [ ] Rename the main folder in Settings, then Update an old bill: the file moves into the new folder path
- [ ] Offline (DevTools → Network → Offline), export: printing still works; bill shows "Not saved to Drive: Offline · Retry"; Retry online works
- [ ] After more than an hour, an upload either works or shows "Google access expired · Reconnect"; Reconnect works
- [ ] Browser blocking pop-ups: Connect shows "Your browser blocked Google's sign-in window…"
- [ ] Disconnect in Settings, then Connect again works
- [ ] Phone (online address): connect, then Save & export uploads
