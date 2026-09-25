# Manual test checklist

Run before first real use, and after any change to the bill page, VietQR or backup.

## VietQR with real banking apps
Use your real bank details in Settings. Create a bill for 10.000 ₫ and export the PDF.
Scan the QR (from screen and from a printed/PDF copy) with at least 3 apps, e.g. Vietcombank, MB Bank, Techcombank:
- [ ] Bank and account number are filled in and the account holder name shown by the app is correct
- [ ] Amount is 10.000 ₫ and cannot be mistaken
- [ ] Transfer content shows the reference (e.g. TT20260001)
- [ ] (Optional) Make the 10.000 ₫ transfer and confirm it arrives with that content
Also confirm your bank's BIN in src/domain/banks.ts against https://api.vietqr.io/v2/banks.

## PDF / print (Chrome and Edge)
- [ ] 3-line bill: one A4 page, nothing cut off, Vietnamese accents correct, QR sharp
- [ ] 25-line bill: table continues on page 2 with the header row repeated; words, QR and signatures stay together
- [ ] Suggested file name is <number>_<customer>
- [ ] VAT "Not applicable": no VAT row; 0%: VAT row with 0
- [ ] Logo (if set) appears and is not stretched

## Backup
- [ ] Back up → clear site data → restore → bills, customers, services, settings identical
- [ ] New bill after restore continues numbering
- [ ] Restoring a non-backup file shows an error and changes nothing

## Offline
- [ ] Installed app opens with Wi-Fi off and can create and export a bill
