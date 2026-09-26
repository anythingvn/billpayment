# Manual test checklist

Run before first real use, and again after changes to the bill page, VietQR, backup, Google Drive or Word templates.
Automatic tests (`npm test`) cover the calculations and rules; this list covers what only a person,
a real printer, a real bank app or a real Google account can confirm.

Use Chrome or Edge on a computer unless a line says otherwise. The online app is
https://anythingvn.github.io/billpayment/ — the same checks apply to `http://localhost:5173`.

## Last run
| Date | Who | Result |
|---|---|---|
| 2026-09-26 | Claude (browser, test data, localhost:5199) | Word review minors: bill and contract .docx line breaks are real Word breaks (library option), no leftover placeholders; Settings no longer scrolls sideways on a narrow screen |
| 2026-09-26 | Claude (browser, test data, localhost:5199 dev + 5198 production build) | Word: 3 starters installed via Use starter; contract, addendum, sent bill (QR image) and draft bill (no QR, BẢN NHÁP) generated in the browser with no leftover placeholders; typo template → "Unknown placeholder: so_phieuu (did you mean so_phieu?)"; .txt refused; production build Word (.docx) download OK |
| 2026-09-26 | Owner | Google Drive: Connect and first upload OK (Chrome, localhost:5173) |
| 2026-09-26 | Automated test | Bank list = all 65 banks of the official VietQR list, BINs match (`npm test`) |
| 2026-09-26 | Claude (browser, test data) | Contracts: 50/50 contract activated (50+40 refused); bill from Đợt 1 filled in with reference line; cancel → back in To bill + banner; Mark ready; adds-work monthly PL01 bill names "Phụ lục số 01"; DB upgraded to version 2 |
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

## 3b. Contracts
**First open after updating:** your existing bills, customers and settings are all still there (the app upgrades its stored data once).

Contract basics
- [x] New contract: number suggested as `n/YYYY/HĐDV[-suffix]` (Settings → Bill defaults sets type and suffix); editable; a duplicate number warns *(2026-09-26)*
- [x] 2 instalments (50% on signing, 50% on acceptance): Save & activate works; 50% + 40% is refused with a message *(2026-09-26)*
- [ ] Clearing a price or quantity box and saving (draft or activate) is refused with "Line 1: … must be a whole number…", nothing half-saved
- [ ] Monthly contract, 800.000 ₫ × 12 months + 8% VAT: the contract page shows value **10.368.000**, not just one month
- [ ] Contract page: value / billed / paid / left add up after a bill is marked Paid

Billing from a contract
- [x] Create bill from Đợt 1: customer, line "… – 50% giá trị hợp đồng", VAT and due date filled in; the bill shows "Căn cứ Hợp đồng số … ký ngày …" *(2026-09-26)*
- [x] Cancel that bill: Đợt 1 is back in **To bill** on Home, with the reminder banner *(2026-09-26)*
- [x] Đợt 2 shows **Mark ready**, then **Create bill** *(2026-09-26)*
- [ ] Trying to bill the same item twice (two drafts) → "This contract item is already billed"
- [ ] Print a contract bill: the reference line sits under the customer block, on one A4 page
- [ ] Bill options → Contract picker: lists active contracts, items (not-ready ones greyed) and "Other"; clearing it keeps the lines
- [ ] Bill view shows "Contract …" linking to the contract page

Addenda (phụ lục)
- [x] "Adds work" with a monthly plan: its periods appear on the contract page; its bill names "Phụ lục số 01" *(2026-09-26)*
- [ ] "Changes terms" from a date: later unbilled periods show "Replaced by PLnn"; already billed ones stay
- [ ] Two "Changes terms" addenda (e.g. from 01/2027 and 06/2027): each month appears **once** in To bill, from the latest change
- [ ] A "Changes terms" addendum with an "on signing" instalment before its effective date: that instalment is still billable
- [ ] Addenda row: **Terminate** works; **Delete** works for a draft addendum

Home, deletes and backup
- [ ] Home: To bill lists due items; the banner appears when one has waited more than 3 days
- [ ] Delete a contract with bills or addenda → refused, Terminate offered; a customer with contracts is archived, not deleted
- [ ] Backup → restore: contracts and addenda come back; the next contract number continues
- [ ] Open the app in two tabs, then load a new version in one: the other tab reloads (or you're asked to close it)

## 4. Settings
- [ ] Bank dropdown lists 65 banks, with Vietcombank, VietinBank, BIDV, Agribank, Techcombank, MB Bank at the top
- [ ] Two bank accounts: add, pick the default, remove one; a number like `99x` is refused with a message
- [ ] Footer notes: add, edit, pick default or "No footer by default"; blank notes disappear on Save
- [ ] Settings survive a page reload
- [x] On a phone-width screen Settings doesn't scroll sideways *(2026-09-26, browser pane)*

## 5. Backup
- [ ] Back up → clear site data → restore → bills, customers, services, settings (bank accounts, footer notes) identical
- [ ] New bill after restore continues numbering
- [ ] Restoring a non-backup file shows an error and changes nothing
- [ ] After a restore, Settings → Google Drive still shows "Connected as …" on this device
- [ ] Back up with two contract templates, restore: templates are back and exactly one is Default (the one the contract editor names)

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

## 8. Word documents
Guide: `docs/word-templates.md`. Items marked *(generated in browser)* were checked by unzipping the file, not by opening it in Word.
- [ ] Settings → Documents → Download each starter; open it in **Word**: tables keep their column widths, marker rows `{FOR …}`/`{END-FOR …}` are visible
- [x] **Use starter** for contract, addendum and bill; contract starter is the Default *(2026-09-26, localhost dev + production build)*
- [ ] **Use starter** for contracts a second time: asks to replace "Hợp đồng mẫu"; still one starter template
- [ ] Contract page → **Word (.docx)**: opens in Word and in **Google Docs**; number, customer, services table, totals, words, instalments are right; marker rows are gone *(generated in browser 2026-09-26: text right, no placeholders left)*
- [ ] Addendum row → **Word**: parent contract number and the addendum's own values *(generated in browser 2026-09-26)*
- [ ] Bill → **Word (.docx)**: QR 3 × 3 cm scans in a bank app; a draft is named `…_DRAFT.docx`, shows "BẢN NHÁP / DRAFT" and has no QR *(generated in browser 2026-09-26: QR image only in the sent bill; not yet scanned)*
- [ ] Detail lines of a service appear on separate lines in Word and Google Docs *(generated in browser 2026-09-26: real Word line breaks)*
- [ ] A monthly contract's period table reads "Kỳ tháng 10/2026", a quarterly one "Quý 4/2026"
- [ ] Your logo (PNG and JPEG, including a progressive JPEG) appears in the header at most 4 cm wide, not stretched
- [ ] Edit a starter (letterhead + one clause), upload it, generate: your changes are kept
- [ ] Upload a template with a typo (`{so_hop_dongg}`): "Unknown placeholder: so_hop_dongg (did you mean so_hop_dong?)"; Word download shows the same message *(Check a template message seen 2026-09-26)*
- [ ] **Check a template**: known placeholders show a green ✓, unknown ones a red ✗
- [ ] Put a contract placeholder in the bill template (e.g. `{so_hop_dong}`): upload says "so_hop_dong isn't filled in bill documents (it prints empty)"; the bill's Word file generates with it empty
- [ ] Put a formula in a template (e.g. `{ben_b_ten + "x"}`): Check and upload say "Only simple placeholders are allowed: …"; Word download refuses it
- [x] A non-Word file (.txt) is refused: "This isn't a Word .docx file" *(2026-09-26)*
- [ ] Two contract templates: pick the second in the contract editor → its Word file uses it; Remove it → the contract uses the Default
- [ ] Customer with a very long name: the contract .docx name is shortened (Drive and download)
- [ ] Save & activate a contract with Drive connected: `Phiếu thanh toán/Hợp đồng/<year>/<customer>/HĐ … – <customer>.docx`; the contract page shows "Word saved to Drive …"
- [ ] Save & activate, open **Edit** right away, wait for the upload to finish, then Save; **Update in Google Drive** replaces the same file (no second file in Drive)
- [ ] The same Save & activate as the **first** Drive action after opening the app (also in Safari): Google's window is not blocked
- [ ] Addendum row → **Save to Drive**: the addendum's .docx lands in the same customer folder
- [ ] Save & export a bill with a bill template: the .docx lands next to the PDF; the bill shows "PDF: saved …" and "Word: saved …"
- [ ] Offline, Update in Google Drive on a bill: both lines show "not saved: Offline"; each Retry works online
- [ ] No template: Word buttons show "Add a template in Settings → Documents"; export still uploads the PDF
- [ ] The same Word download on the **online app** and on a phone
- [ ] Backup, then Restore: templates come back
