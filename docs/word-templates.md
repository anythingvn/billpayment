# Word templates

The app fills your own Word (.docx) files with the details of a contract, an addendum or a bill,
so the documents match your company letterhead. You upload templates in **Settings → Documents**.

> **Only upload templates you created or trust — templates can contain small formulas that run in this app.**

## Start from a starter

1. Settings → Documents → **Starter templates** → **Download** the contract, addendum or bill starter.
2. Open it in Word, change the letterhead, fonts and clauses, and keep the `{…}` placeholders you need.
3. Upload it: **+ Upload contract template** (give it a name, e.g. *Hợp đồng thiết kế*), or **Upload** for the addendum and bill slots.

Or click **Use starter** to use a starter as it is.

You can keep several contract templates. The **Default** one is used unless a contract picks another
in its editor (**Document template**). Addenda use the addendum template and bills use the bill template.

## Placeholders

Type a placeholder in curly brackets, e.g. `{so_hop_dong}` or `{ben_b_ten}`.
Settings → Documents → **Placeholders** lists them all, with examples and a **Copy** button.

- Spelling must be exact. A typo (e.g. `{so_hop_dongg}`) is reported on upload:
  *Unknown placeholder: so_hop_dongg (did you mean so_hop_dong?)*. Nothing is generated until it is fixed.
- Type the placeholder in one go (or paste it). If Word splits it while you edit, the app still reads it.
- Values with several lines (such as `chi_tiet`) keep their line breaks.
- **Check a template** shows the placeholders a file uses and any problems, without saving it.

## Tables (one row per service, instalment or period)

A table repeats one row for each item. Put the loop markers in **their own rows**, above and below the row that repeats:

| STT | Dịch vụ | Số lượng | Đơn giá | Thành tiền |
|---|---|---|---|---|
| `{FOR d IN dich_vu}` | | | | |
| `{$d.stt}` | `{$d.ten}` | `{$d.so_luong}` | `{$d.don_gia}` | `{$d.thanh_tien}` |
| `{END-FOR d}` | | | | |

The two marker rows disappear from the finished document.
Do **not** put `{FOR …}` and `{END-FOR …}` in the same row (that repeats columns instead of rows).

Tables: `dich_vu` (services), `dot_thanh_toan` (instalments), `ky_thanh_toan` (monthly/quarterly periods).

## Conditions

Show text only in some cases: `{IF co_vat}` … `{END-IF}`.
For example, `{IF la_ban_nhap}BẢN NHÁP / DRAFT{END-IF}` marks a draft bill.
Conditions: `co_vat`, `co_hop_dong`, `la_phu_luc`, `la_ban_nhap`, `theo_dot`, `theo_ky`, `theo_thuc_te`.

## Images

- `{IMAGE logo()}` — your logo from Settings (at most 4 cm wide). Nothing is shown when there is no logo.
- `{IMAGE qr()}` — the VietQR code, 3 × 3 cm (bills only; empty for drafts).

## Where the files go

- **Download:** **Word (.docx)** on the contract page, **Word** in each addendum row, and **Word (.docx)** on a bill.
- **Google Drive:** contracts and addenda go to `Phiếu thanh toán / Hợp đồng / <year> / <customer> /`.
  A bill's .docx goes next to its PDF. Saving is automatic on **Save & activate** and **Save & export PDF**
  (when *Upload automatically* is on), or with the Drive buttons.
