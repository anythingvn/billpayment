# Word Documents for Contracts, Addenda and Bills — Design Spec (Project 2 of 2)

Date: 2026-09-26 · Status: awaiting review
Builds on: `2026-09-26-contracts-design.md` (Project 1), `2026-09-26-google-drive-upload-design.md`

## 1. Purpose and scope

The owner wants contracts, addenda and payment bills as **Word (.docx)** files on their own **company letterhead**, with their own contract wording. The app fills the owner's Word templates with the data it already holds, downloads the result, and saves it to Google Drive.

**Success**
- The owner edits a template once in Word (letterhead, clauses) and uploads it.
- From then on, every contract, addendum and bill can be produced as a correctly filled .docx in one click.
- The .docx is saved to Drive automatically alongside the PDF when a bill is exported, and when a contract or addendum is activated.

**In scope**
- Template management in Settings: several contract templates (one default), one addendum template, one bill template.
- Starter templates shipped with the app.
- A placeholder catalogue and a template checker.
- Generation in the browser.
- Download.
- Saving to Google Drive, manually and automatically.
- Templates included in backups.

**Out of scope**
- Word → PDF conversion.
- Editing templates inside the app.
- Templates from URLs or email.
- Mail merge of several documents into one file.
- Per-brand bill or addendum templates.
- E-signatures.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Wording source | The owner's own Word templates with placeholders; starter templates provided |
| Library | `docx-templates` (MIT), browser build, delimiters `{` `}` |
| Templates per type | Contracts: several, one default, chosen per contract. Addendum: one. Bill: one |
| Output | Download .docx, plus save to Google Drive |
| Automatic Drive saving | Bill .docx on "Save & export PDF"; contract/addendum .docx on "Save & activate" — both only when `driveAutoUpload` is on, Drive is configured, and a template exists |
| Drive folders | Contracts and addenda: `<main folder> / Hợp đồng / <year of signing> / <customer> /`. Bill .docx: the same folder as the bill's PDF |
| Placeholder names | Vietnamese without diacritics, snake_case (§4) |

## 3. Screens and flow

### 3.1 Settings → Documents (new panel)

**Contract templates** — a list, one row per template:
- name (editable, e.g. "Hợp đồng thiết kế"), file name, uploaded date;
- **Default** (radio), **Download**, **Replace**, **Remove**;
- **+ Upload contract template** (asks for a name).

**Addendum template** and **Bill template** — one slot each: file name and date, **Upload** / **Replace**, **Download**, **Remove**.

**Starter templates:**
- **Download** buttons for the contract, addendum and bill starters.
- **Use starter** installs one directly as a template: contract "Hợp đồng mẫu", or the addendum/bill slot.

**Placeholders:** a collapsible list grouped as in §4. Each entry shows the placeholder, a description (VI / EN), an example value, and a **Copy** button that copies the exact text to type, e.g. `{so_hop_dong}` or a whole `FOR` row pattern.

**Check a template:** choose a .docx to see the placeholders it uses (known ones ticked, unknown ones highlighted with a suggestion) and any syntax errors, without saving it.

**Warning line:** "Only upload templates you created or trust — templates can contain small formulas that run in this app."

### 3.2 Contracts
- **Contract editor:** a new **Document template** select (the contract templates; default preselected). It is stored as `Contract.templateId` (`null` = use the default). Addenda have no select; they use the addendum template.
- **Contract page:**
  - **Word (.docx)** downloads the document;
  - **Save to Google Drive** / **Update in Google Drive** with a status line, like bills: "Word saved to Drive dd/mm/yyyy hh:mm · Open", or "Not saved: … · Retry/Reconnect";
  - each addendum row gets **Word** and a Drive action.
- **Save & activate** of a contract or addendum starts the automatic Drive upload of its .docx (§2).

### 3.3 Bills
- **Bill view:** a **Word (.docx)** button next to Export PDF.
  - For drafts, the document is labelled as a draft. In the bill template, `{IF la_ban_nhap}` lets the template show "BẢN NHÁP / DRAFT", and the QR is left empty for drafts.
  - The Drive status line shows PDF and Word separately ("PDF: saved … · Word: saved …") with separate Retry.
- **Save & export PDF:** after the PDF upload starts, the .docx upload is queued (same queue, same connection).

### 3.4 Missing template
- The Word buttons show "Add a template in Settings → Documents" (a link) instead of a download.
- Automatic Drive saving silently skips the .docx.

## 4. Placeholders

Values are text: money formatted `20.952.000`, dates `dd/mm/yyyy`. Unknown values print as empty text, never "undefined" or "null".

**Syntax (docx-templates, delimiters `{` `}`)**
- Value: `{so_hop_dong}`
- Repeat table rows: put `{FOR d IN dich_vu}` alone in the row **above** the repeating row and `{END-FOR d}` alone in the row **below**; the repeating row uses `{$d.ten}` etc. Both marker rows disappear from the result. (FOR and END-FOR in the same row would repeat columns instead.)
- Condition: `{IF co_vat}` … `{END-IF}`
- Image: `{IMAGE qr()}`, `{IMAGE logo()}`

**Bên A (business).** Taken from the record's saved copy when present (sent bill, active contract); otherwise from Settings.

| Placeholder | Value |
|---|---|
| `ben_a_ten` | name |
| `ben_a_mst` | tax ID |
| `ben_a_dia_chi` | address |
| `ben_a_dien_thoai` | phone |
| `ben_a_email` | email |
| `nguoi_lap` | "Prepared by" |

**Bên B (customer)**, from the record's customer copy:

| Placeholder | Value |
|---|---|
| `ben_b_ten` | name |
| `ben_b_mst` | tax ID |
| `ben_b_dia_chi` | address |
| `ben_b_nguoi_lien_he` | contact person |
| `ben_b_dien_thoai` | phone |
| `ben_b_email` | email |

**Contract** (in contract and addendum documents; in an addendum document these describe the **parent** contract):

| Placeholder | Value |
|---|---|
| `so_hop_dong`, `ten_hop_dong` | number, title |
| `ngay_ky` | `15/09/2026` |
| `ngay_ky_chu` | `ngày 15 tháng 09 năm 2026` |
| `ngay_bat_dau`, `ngay_ket_thuc` | dates (`ngay_ket_thuc` empty if open-ended) |
| `gia_tri_truoc_thue`, `thue_suat`, `tien_thue`, `gia_tri` | value before VAT; rate text (`8%`, `0%`, or `Không áp dụng`); VAT amount; value including VAT (using `contractValue` rules, including periodic plans) |
| `gia_tri_bang_chu`, `gia_tri_bang_chu_en` | the value including VAT in words |
| `dieu_khoan_thanh_toan`, `so_ngay_thanh_toan` | payment terms text and days |
| `hinh_thuc_thanh_toan` | `Theo đợt` / `Theo tháng` / `Theo quý` / `Theo thực tế sử dụng` |

**Addendum** (addendum documents only; the "Contract" values above describe the parent):

| Placeholder | Value |
|---|---|
| `so_phu_luc`, `ten_phu_luc` | number, title |
| `ngay_ky_phu_luc`, `ngay_ky_phu_luc_chu` | signing date (numeric and in words) |
| `loai_phu_luc` | `Bổ sung công việc` / `Thay đổi điều khoản` |
| `ngay_hieu_luc` | effective date (empty for adds-work) |
| `pl_gia_tri_truoc_thue`, `pl_tien_thue`, `pl_gia_tri`, `pl_gia_tri_bang_chu`, `pl_gia_tri_bang_chu_en` | the addendum's own values |
| `pl_dieu_khoan_thanh_toan`, `pl_so_ngay_thanh_toan`, `pl_hinh_thuc_thanh_toan` | the addendum's terms |

In addendum documents, `dich_vu`, `dot_thanh_toan` and `ky_thanh_toan` are the **addendum's**.

**Bill:**

| Placeholder | Value |
|---|---|
| `so_phieu`, `ngay_phieu`, `han_thanh_toan` | bill number and dates |
| `can_cu_hop_dong` | the Vietnamese reference line (`Căn cứ Hợp đồng số … ký ngày …`), empty without a contract |
| `can_cu_hop_dong_en` | the English reference line, empty without a contract |
| `ngan_hang`, `so_tai_khoan`, `chu_tai_khoan` | from the bill's bank account |
| `noi_dung_ck` | the payment reference |
| `ghi_chu_cuoi` | the footer note |
| `tong_truoc_thue`, `thue_suat`, `tien_thue`, `tong_cong` | totals |
| `tong_bang_chu`, `tong_bang_chu_en` | the total in words |

**Tables**

| Table | Row fields |
|---|---|
| `dich_vu` | `stt`, `ten`, `ten_en`, `chi_tiet` (detail lines joined with line breaks), `dvt`, `dvt_en`, `so_luong`, `don_gia`, `thanh_tien` |
| `dot_thanh_toan` (instalment plans; empty otherwise) | `stt`, `ten`, `ty_le` (`50%` or empty), `so_tien` (before VAT), `thoi_han` (`Khi ký hợp đồng`, `Khi nghiệm thu`, or `dd/mm/yyyy`) |
| `ky_thanh_toan` (periodic plans; empty otherwise) | `stt`, `ky` (`Tháng 10/2026` or `Quý 4/2026`), `so_tien` (before VAT) |

**Flags (true/false):**
- `co_vat` — the VAT rate is not "Không áp dụng";
- `co_hop_dong` — a bill linked to a contract;
- `la_phu_luc` — an addendum document;
- `theo_dot`, `theo_ky`, `theo_thuc_te` — the billing method;
- `la_ban_nhap` — a draft bill, or a draft contract/addendum.

**Images:**
- `qr()` — bills only; the VietQR PNG, 3 × 3 cm. Empty for drafts, for bills with no QR, and in contract documents.
- `logo()` — the Settings logo (or the record's business copy), max 4 cm wide with the aspect ratio kept; empty when there is no logo.

## 5. Architecture

| Unit | Responsibility |
|---|---|
| `src/docs/placeholders.ts` | Pure functions `contractDocData(c, parent, settings)`, `addendumDocData(a, parent, settings)` and `billDocData(bill, settings, qrPng)` returning the §4 data (no images; the images are passed separately). Reuses `computeTotals`, words, contract plan/terms and the reference line |
| `src/docs/catalog.ts` | `PLACEHOLDERS`: `{ key, group, vi, en, example, kinds: ('contract' \| 'addendum' \| 'bill')[] }[]` for the help panel, checker and suggestions |
| `src/docs/render.ts` | `renderDocx(template: ArrayBuffer, data, images: { qr?: Uint8Array; logo?: Uint8Array }): Promise<Blob>` — `createReport` with `cmdDelimiter ['{','}']`, `additionalJsContext` providing `qr()`/`logo()`, `rejectNullish: false`, and errors translated to `DocTemplateError { kind: 'unknown' \| 'syntax' \| 'loop' \| 'if' \| 'image' \| 'other', message, command? }`. Imported dynamically |
| `src/docs/inspect.ts` | `inspectTemplate(template, kind): Promise<{ used: string[]; unknown: { name, suggestion }[]; errors: string[] }>` using `listCommands` |
| `src/docs/starters/*.docx` | Starter templates, generated by `scripts/make-starters.ts` (dev-only `docx` library) and committed; loaded as URL assets |
| `src/docs/fileNames.ts` | The .docx file names (§6) |
| `src/storage/db.ts` | DB **v3**: store `templates` (keyPath `id`) holding `DocTemplate { id, kind: 'contract' \| 'addendum' \| 'bill', name, fileName, data: ArrayBuffer, uploadedAt, isDefault }`; CRUD; at most one default contract template |
| `src/domain/types.ts` | `Contract.templateId: string \| null`; `Contract.drive?: DriveStatus`; `Bill.driveDocx?: DriveStatus` |
| `src/drive/*` | Generalised to upload any file (`name`, `mimeType`, folder path); `saveBillToDrive` unchanged in behaviour; new `saveDocxToDrive(db, target: { type: 'bill' \| 'contract'; id }, s)` using the same queue, join and offline rules |

## 6. File names and Drive paths

**File names**
- Contract: `HĐ {number with / → -} – {customer}.docx`
- Addendum: `{PLnn} – HĐ {parent number with / → -}.docx`
- Bill: `{bill number}_{customer}.docx`, with `_DRAFT` for drafts.
- Names are cleaned by the same rules as PDF names, and `safeName` is applied for Drive.

**Drive paths**
- Contracts and addenda: `[driveFolderName, 'Hợp đồng', YYYY of signing (the parent's for addenda), safeName(customer)]`.
- Bill .docx: the bill PDF's folder (`[driveFolderName, YYYY, customer]`), with the .docx name.
- Draft bills are never uploaded (as today).

## 7. Backups and migration

- **DB v2 → v3** adds the `templates` store; existing data is untouched. Contracts saved before v3 have no `templateId`, which means the default.
- **Backup:** `templates: { id, kind, name, fileName, dataBase64, uploadedAt, isDefault }[]`. The schema version stays 1, and a missing `templates` means `[]`.
  - Restore validates: the kind; strings; base64 decodes to bytes starting with the ZIP signature `PK`; size ≤ 5 MB.
  - The bill and contract Drive fields are validated like existing ones.

## 8. Errors and safety

| Situation | Behaviour |
|---|---|
| Upload of a non-.docx (bad ZIP signature), or a file > 5 MB | Refused: "This isn't a Word .docx file" / "The template is larger than 5 MB" |
| Unknown placeholders | Listed on upload with suggestions (closest known name, edit distance ≤ 2). Saving is allowed. Generating is refused with "Unknown placeholder: X (did you mean Y?)" |
| Syntax error (unterminated FOR, IF, bad expression) | Generation refused: "The template has an error near {…}: …" |
| No template for the kind | The Word button becomes the Settings link; auto-upload skips |
| Removing a contract template in use | Allowed after confirming "N contracts use this template; they will use the default"; their `templateId` is set to null |
| Drive upload of a .docx fails | Recorded in `drive`/`driveDocx` with Retry/Reconnect; the PDF status is independent |

**Safety**
- Templates run with `docx-templates`' default sandbox.
- `additionalJsContext` exposes only the data object and the two image functions.
- Templates come only from owner uploads or the bundled starters.
- The warning line in Settings.

## 9. Testing

**Unit tests (written first):**
- `placeholders`:
  - a contract with instalments;
  - a periodic contract (values from `contractValue`, `ky_thanh_toan` rows);
  - an addendum (parent values and its own `pl_*` values);
  - bills with and without VAT or a contract, and a draft bill (`la_ban_nhap`, no QR);
  - `ngay_ky_chu`;
  - words;
  - `chi_tiet` joining;
  - empty strings, never null.
- `render`: each starter rendered with sample data → a valid ZIP whose `word/document.xml` text contains the number, customer, one row per service, totals and the reference line. The bill has an image part when a QR is given and none without a logo. A template with `{so_hop_dongg}` gives `DocTemplateError` `unknown`; one with an unterminated FOR gives `loop`.
- `inspect`: the used/unknown/suggestion lists; syntax errors.
- `fileNames`, and the Drive paths for contracts and addenda.
- Storage: v2 → v3 upgrade keeps data (including contracts); template CRUD; the single-default rule; backup round trip with templates; old backups; damaged templates rejected.
- Drive: the generic upload creates, replaces and moves; `saveDocxToDrive` records status; auto-upload on export (PDF then .docx) and on activation; a missing template skips.

**Screen tests:** Settings upload / default / remove-in-use / check; contract template select; Word buttons and the missing-template state; the Drive status for Word.

**Manual:**
- Open each starter output in Word and Google Docs.
- Edit a starter (letterhead + a clause), upload it, generate.
- Check Drive gets `Hợp đồng/<year>/<customer>/…docx`, and a bill .docx next to its PDF.
