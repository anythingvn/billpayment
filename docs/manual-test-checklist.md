# Manual test checklist

Run before first real use, and again after changes to the bill page, VietQR, backup, Google Drive or Word templates.
Automatic tests (`npm test`) cover the calculations and rules; this list covers what only a person,
a real printer, a real bank app or a real Google account can confirm.

Use Chrome or Edge on a computer unless a line says otherwise. The online app is
https://anythingvn.github.io/billpayment/ — the same checks apply to `http://localhost:5173`.

## Last run
| Date | Who | Result |
|---|---|---|
| 2026-09-26 | Automated tests + independent review | Customer statement review fixes: a bill paid before its bill date counts as paid on the bill date (no false balance, no crash); same-name customers keep separate Drive files; PDF and Word Drive status shown separately (460 tests) |
| 2026-09-26 | Claude (browser, test data, localhost:5199 dev + 5198 production build) | Customer statement: 40-bill customer — balances reconcile (opening + billed − paid = closing = unpaid total), days overdue to today, QR + reference shown; PDF 2 pages (this year) / 3 pages (all time) with page breaks between rows; bill PDF still 1 page after the shared PDF change; Word from the starter with no leftover placeholders (bank block and QR only when owed); production build: starter installed, Word download OK, no console errors |
| 2026-09-26 | Automated tests + independent review | Accountant report review fixes: report Drive status kept through backup/restore; "Uploading to Google Drive…" on a period's first save; days overdue counted to today for a period not yet ended (422 tests) |
| 2026-09-26 | Claude (browser, test data, localhost:5199 dev + 5198 production build) | Accountant report: Last month figures match a hand calculation (bill issued in July and paid in August counted as paid, not billed; draft left out); Excel download has 4 sheets, exact dates, `#,##0` money, Vietnamese intact; works in the production build |
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
- [ ] After a new version is published: the first visit may still show the old version; reload once and the new one appears (e.g. the **Reports** menu item)

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

## 9. Accountant report
- [x] Reports opens on **Last month**; the shortcuts fill From/To *(2026-09-26)*
- [x] On-screen Received / Billed / Owed at end and the VAT table match a hand calculation (a bill paid in the period but issued earlier counts as paid, not billed; drafts and cancelled bills don't count) *(2026-09-26, test data)*
- [x] **Download Excel** names the file `Báo cáo 2026-08.xlsx` (a month), `Báo cáo 2026-Q3.xlsx` (a quarter), `Báo cáo 2026.xlsx` (a year) *(month checked 2026-09-26 in dev and the production build; others by automatic tests)*
- [ ] **Download Excel** on the **online app** and on a phone (Safari/iPhone may need a second tap)
- [ ] Open the file in **Excel** and in **Google Sheets**: four sheets (Tổng hợp, Đã thanh toán, Đã lập, Còn phải thu); Vietnamese text correct; column widths readable
- [ ] Money columns add up with `=SUM(…)`; dates sort as dates and show as dd/mm/yyyy (not a day off)
- [ ] VAT per rate matches the e-invoices you issued for the same period
- [ ] Start date after end date: "The start date must be on or before the end date"; buttons disabled
- [ ] **Save to Google Drive**: the screen shows "Uploading to Google Drive…", then "Saved to Drive …"; the file lands in `Phiếu thanh toán/Báo cáo/<year>/`
- [ ] Save the same period again: **Update in Google Drive** replaces the same file (no second copy)
- [ ] Installed app offline: **Download Excel** still works; Save shows "Not saved: Offline · Retry"
- [ ] Back up, restore, then **Update in Google Drive** for a saved period: still one file in Drive
- [ ] With **This month**, the Owed sheet counts days overdue up to today, not to the end of the month
- [ ] A bill paid after the period shows "Paid" on the Billed sheet and also appears on the Owed sheet (it was still owed at the end of the period); check your accountant is fine with this
- [ ] Give the file to your accountant: does it have what they need?

## 10. Customer statement
- [x] Customers → **Statement** opens the statement for **This year** up to today *(2026-09-26, test data)*
- [x] Opening + billed − paid = closing balance = total of the unpaid table *(2026-09-26, 40 test bills)*
- [x] A long statement (40 bills) breaks across pages between rows, never through one *(2026-09-26, Drive PDF builder)*
- [x] Word from the starter has no leftover `{…}`; the bank block, QR and reference appear only when something is owed *(2026-09-26, dev and production build)*
- [ ] **Export PDF** → Save as PDF: 1-page and multi-page statements look like your bills; the table headings repeat on each page; the balances and the signature block aren't split; a section heading isn't left alone at the bottom of a page (known possible; note it if you see it)
- [ ] Scan the statement's QR with your bank app: the amount is the closing balance and the reference is `DC…`
- [ ] A customer who owes nothing: closing balance 0, "Không có / None" under unpaid, no QR
- [ ] Advance payment: a bill dated next month and marked paid today shows as billed and paid, not as owed; the balance never goes negative
- [ ] A customer with no tax ID: the reference uses the name's initials (e.g. `DC20261231CTCH`) and the bank app accepts it
- [ ] Settings → Documents → **Use starter** for the Statement template, then **Word (.docx)**: open it in Word; balances and both tables are right
- [ ] Edit the statement starter with your letterhead, upload it, generate again
- [ ] **Save to Google Drive**: the PDF (and .docx) land in `Phiếu thanh toán/Đối chiếu/<year>/<customer>/`; saving again the same day updates the same files (a "This year" statement saved on another day is a new file, because its end date changes)
- [ ] With a Statement template, the screen shows "PDF: saved …" and "Word: saved …" separately; a Word problem shows "Word: not saved: … · Retry"
- [ ] Two customers with the same name: each one's **Save to Google Drive** makes its own files, never updating the other's
- [ ] Back up, restore, then **Update in Google Drive** for a saved statement: still one file of each in Drive
- [ ] Send one to a customer and ask them to sign and return it

## 11. Shared server (branch feat/shared-server)
Setup guide: `docs/server-setup.md`.
- [ ] `npm run make-env && npm run build && npm run build:server && node server/dist/main.js` → http://localhost:8080 shows **Set up the server**
- [ ] Setup asks for the **setup code** printed in the server's terminal/log; a wrong code is refused
- [x] Docker image builds and runs (answers, serves the app, runs as a non-root user, writes to /data) *(2026-09-26, Docker Desktop)*
- [ ] On the Linux server: `mkdir -p data && sudo chown 1000:1000 data`, then `docker compose up -d --build`; `docker compose logs app` shows the setup code
- [ ] Set up the Admin, then **Import** a backup from the current app: bills, customers, contracts, templates and settings are there; the next bill continues the numbering
- [ ] **Users**: add a Manager and an Order Creator; each signs in and must choose their own password first
- [ ] 5 wrong passwords lock the username for 15 minutes (same message as a wrong password)
- [x] Two tabs edit the same customer: the second save shows the conflict message with Reload and keeps its input *(2026-09-26, local server)*
- [ ] Two browsers (or a normal + private window) as two users edit the same customer: the second save says "Someone else changed this — reload to see their changes" and keeps what was typed
- [ ] Both create a bill at the same moment: different numbers
- [ ] A bill shows "Created by … · changed by …"; a new bill's "Prepared by" is the signed-in person
- [x] Server stopped: the app opens from its offline copy with the banner, bills open, save buttons greyed *(2026-09-26, local server)*
- [ ] On a phone, turn off Wi-Fi: the banner "Offline — viewing only · last updated hh:mm"; bills, contracts and statements open and print; save buttons are greyed with "Needs a connection"
- [ ] Sign out, sign in as someone else: they don't see the first person's offline copy
- [ ] **Activity** (Admin) lists sign-ins, failed sign-ins, deletions, user changes
- [ ] Settings → Google Drive → **Connect Google Drive** (Admin, after adding the Web client to `.env`): a bill, a contract, a report and a statement save to the company Drive; other users' saves go there too
- [ ] **Download backup** (Admin) contains no passwords or Google token; **Restore** needs the word RESTORE and keeps the users
- [ ] Next morning: `data/backups/billpayment-<date>.db` exists
- [ ] Save a draft, reopen it and save again, then send it: no "Someone else changed this"
- [ ] Mark a bill paid, then Undo paid on the same screen: no conflict message
- [ ] `docker compose exec app node server/dist/resetPassword.js admin` lets the Admin back in with a new password
- [ ] On your server: HTTPS with your domain (`PUBLIC_URL=https://…`), then the checks above once more

## 12. Roles (server)
Add one user of each role (Users → Add user), then sign each in, two at a time (a normal and a private window).
- [ ] **Order Creator:** no Reports in the menu, and `#/reports` says "Your role can't open this page"
- [ ] Order Creator: makes a bill and sends it (Save & export PDF); on the sent bill there is no Mark as paid or Cancel bill
- [ ] Order Creator: a draft contract has Edit and Save & activate, but no Terminate, Mark completed or Delete
- [ ] Order Creator: Customers has Edit but no Delete and no Statement; Services has Edit but no Archive
- [ ] **Accountant:** no + New bill or + New contract; `#/bills/new` says "Your role can't open this page"
- [ ] Accountant: marks a sent bill paid, then Undo paid; no Duplicate, Cancel bill or Save to Google Drive on the bill
- [ ] Accountant: Reports → Download Excel and Save to Google Drive work; a customer's Statement opens and saves to Drive
- [ ] **Manager:** cancels a bill, terminates a contract, archives a customer; Settings shows "Only an Admin can change settings" and nothing can be changed
- [ ] **Admin:** everything as before; Settings can be changed
- [ ] Forced request: as the Order Creator, in the browser console run `fetch('/api/customers/<id>', {method: 'DELETE', headers: {'X-Requested-With': 'billpayment'}}).then(r => r.status)` → 403; Activity (Admin) shows "Refused: record.remove"
- [ ] The Admin changes someone's role: after they reload, their menu and buttons follow the new role
