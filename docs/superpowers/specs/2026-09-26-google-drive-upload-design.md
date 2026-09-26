# Save Final Bills to Google Drive — Design Spec

Date: 2026-09-26 · Status: awaiting review
Builds on: `2026-09-25-payment-bill-app-design.md`

## 1. Purpose and scope

The owner wants every final bill (payment request) saved to Google Drive as a PDF with one click or automatically, from any device the app runs on (desktop or phone), without a save dialog or Google Drive for desktop.

**Success:** after "Save & export PDF" on a connected device, the bill's PDF is in Drive at `My Drive / <main folder> / <year> / <customer> / <bill number>.pdf` within seconds, and the bill view says so with a link. Nothing about exporting gets worse when Drive is not connected or fails.

**In scope**
- A Google Drive connection (sign-in) from the browser, with a Client ID the owner creates once.
- Automatic upload on "Save & export PDF", plus a manual "Save to / Update in Google Drive" button on Sent and Paid bills.
- Client-side PDF generation for the upload.
- Upload status saved on each bill.

**Out of scope**
- Uploading drafts or cancelled bills.
- Reading, listing or choosing arbitrary Drive files or folders (no Google Picker).
- Changing how the local export works: it stays the browser print dialog.
- Sharing links with customers or setting Drive permissions.
- Background retries when the app is closed.

## 2. Decisions made

| Topic | Decision |
|---|---|
| When to upload | Automatically on "Save & export PDF" (if connected and enabled), and a manual button on Sent/Paid bills |
| Without a connection | Export works exactly as today (print dialog, user picks save location); no Google prompts |
| Folder layout | `My Drive / <main folder> / <year of bill date> / <customer name> / <bill number>.pdf` |
| Main folder | Named in Settings, default `Phiếu thanh toán` |
| Re-upload | Replaces the contents of the same Drive file (keeps Drive version history); recreated if deleted |
| PDF for Drive | Snapshot of the on-screen A4 bill (`html2canvas` → `jsPDF`), 2× resolution, A4 pages |
| Permission | OAuth scope `https://www.googleapis.com/auth/drive.file` only |
| Sign-in library | Google Identity Services (GIS) token client, loaded from `https://accounts.google.com/gsi/client` |

## 3. User-facing behaviour

### 3.1 Settings → "Google Drive" panel
- **Google Client ID** (text). Empty means Drive features are off.
- **Main folder name** (text, default `Phiếu thanh toán`, required when a Client ID is set; must not contain `/`).
- **Upload automatically on export** (checkbox, default on).
- **Connect Google Drive / Disconnect** button, plus the connected Google account's email when known.
- A one-line link to `docs/google-drive-setup.md` on GitHub.

### 3.2 Bill view (Sent and Paid bills only)
- Status line:
  - *Uploading to Google Drive…*
  - *Saved to Drive dd/mm/yyyy hh:mm · Open in Drive* (link opens the file's `webViewLink` in a new tab)
  - *Not saved to Drive: <reason> · Retry*
  - nothing, when never uploaded and Drive is not configured
- Button **Save to Google Drive**, or **Update in Google Drive** when `drive.fileId` exists. When no Client ID is set, the button is replaced by the text "Connect Google Drive in Settings" (a link).
- Drafts and cancelled bills show neither the status nor the button.

### 3.3 Save & export PDF (editor step 3)
When a Client ID is set and auto-upload is on:
1. Save the bill as Sent (as today).
2. Start the Drive upload (token request first, per the popup rule in §4).
3. Open the print dialog (as today) and move to the bill view.

The upload continues in the background, and its result is saved on the bill. The export never waits for or depends on it. Otherwise the export works exactly as today.

## 4. Google connection

- Load the GIS script on demand (first connect or upload), not at app start.
- The token client uses the Client ID from Settings and scope `drive.file`.
- **Access token:** kept in memory only (module variable) with its expiry. It is never persisted, logged, or included in backups. If it is missing or expires within 60 s, request a new one: `prompt: ''` when previously connected on this device, otherwise `prompt: 'consent'`.
- **Connected state on this device:** meta key `driveConnected` = `{ email: string | null, at: string }`. The email comes from the Drive `about` endpoint (`fields=user(emailAddress)`), which works with the `drive.file` scope.
- **Disconnect:** call `google.accounts.oauth2.revoke(token)` if a token is held, then clear the in-memory token and `driveConnected`.
- **Popup rule:** token requests must happen while the triggering click is still active, i.e. within the browser's user-activation window (about 5 s). Connect and Save to Drive request the token first, before any other await. Save & export requests it right after the bill is saved, before building the PDF and before opening the print dialog. If the browser still blocks the popup, the result is a normal failure with Retry.

## 5. PDF generation (`src/ui/billPdf.ts`)

- Render `<BillPage bill settings qrDataUrl>` into an off-screen container (fixed position, off-viewport) at the A4 CSS width (210 mm), with the print margins applied as padding (14 mm top/bottom, 15 mm left/right) and no box shadow.
- `html2canvas` at scale 2 with a white background.
- Paging: the printable page height in canvas pixels is `(297 − 28) mm` scaled. Page cut points are chosen with `pageCuts(blocks, pageHeight)`, a pure function. It takes the vertical extents of the unsplittable blocks (header area, each service row, the `.bill-end` block) and returns cut positions:
  - a cut never falls inside a block;
  - a block taller than a page is cut at the page height;
  - when a service table continues on a new page, the table header is not repeated. This is an accepted difference from the printed version; the header appears on page 1 only.
- `jsPDF` (A4, mm) adds each slice as a JPEG (quality 0.92) positioned at the margins, and returns a `Blob` (`application/pdf`).
- `html2canvas` and `jsPDF` are imported dynamically inside `billPdf.ts`, so they are not in the main bundle.

## 6. Drive upload (`src/drive/*`)

Units:

| Unit | Responsibility | Depends on |
|---|---|---|
| `drive/api.ts` | Thin `fetch` wrapper for Drive REST v3 (`files.list`, `files.create` (folder), multipart upload, media update, `files.get`, `about.get`). Takes a `getToken()` function; maps HTTP errors to `DriveError { kind: 'auth' \| 'notFound' \| 'offline' \| 'origin' \| 'other', message }` | `fetch` |
| `drive/paths.ts` | `safeName(s)` (replace `/ \ : * ? " < > \|` and control chars with space, collapse spaces, trim, fall back to `_`), `billDrivePath(bill, mainFolder)` → `{ folders: [main, year, customer], fileName: '<number>.pdf' }` | — |
| `drive/folders.ts` | `ensureFolderPath(api, names, cache)`: for each level, use the cached id if `files.get` shows it exists and is not trashed; else search `name = X and mimeType = folder and 'parent' in parents and trashed = false`; else create. Cache is the meta key `driveFolders` (`Record<path, id>`) | `api` |
| `drive/upload.ts` | `uploadBillPdf(api, bill, pdf, settings, cache)`: ensure folders; if `bill.drive?.fileId` exists and is not trashed, PATCH its media (and name); else multipart-create in the customer folder. Returns `{ fileId, link, savedAt }` | `api`, `folders`, `paths` |
| `drive/auth.ts` | GIS loading, token client, `getToken()`, `connect()`, `disconnect()` | GIS script |
| `drive/saveBillToDrive.ts` | Orchestrates one save for a bill id: guards against double clicks (one in-flight upload per bill id), builds the PDF, uploads, writes `drive` on the bill (success or error) via storage, and notifies listeners so the bill view updates | all of the above, `storage`, `billPdf` |

**Bill record addition** (optional field, missing on older bills):
```
drive?: { fileId: string | null; link: string | null; savedAt: string | null; error: string | null }
```
Success sets `fileId`, `link`, `savedAt` and `error: null`. Failure keeps the previous `fileId/link/savedAt` and sets `error`. The field is locked-bill-safe: changing it is not a content edit and is allowed on Sent/Paid bills.

**Settings additions:** `googleClientId: string` (default `''`), `driveFolderName: string` (default `'Phiếu thanh toán'`), `driveAutoUpload: boolean` (default `true`). These are converted by `normalizeSettings` for older settings.

**Backups:** `drive` on bills is validated (optional; each property a string or null); the new settings are validated (strings/boolean). The in-memory token and `driveConnected` are never exported. `driveFolders` is not exported either: folder ids are per Google account and are re-found by name.

## 7. Errors

| Situation | Result |
|---|---|
| No Client ID | No upload attempted; bill view shows "Connect Google Drive in Settings" |
| Offline (`navigator.onLine === false` or network error) | `error: 'Offline'`, Retry |
| Popup closed / access denied | `error: 'Not connected to Google Drive'`, Retry |
| Token expired mid-upload (401) | One silent token refresh and one retry; then error, Retry |
| Folder or file deleted/trashed in Drive | Recreated on the next upload |
| Origin not registered (GIS `idpiframe`/`origin_mismatch` error) | Error naming `location.origin` to add in Google Cloud |
| Double click / auto-upload while a manual upload runs | Second request joins the in-flight one |
| PDF generation failure | `error: 'Could not create the PDF'`, Retry |

An upload failure never changes the bill's status and never blocks the print dialog.

## 8. Security

- Only the `drive.file` scope; the app can access only files it created.
- No client secret anywhere in the app or repository. Web clients don't use one.
- The access token is kept in memory only; never in IndexedDB, localStorage, logs, error messages or backups.
- Network calls: only `accounts.google.com` (GIS) and `www.googleapis.com` (Drive). The service worker must not cache these (they are cross-origin, so they are not in the precache).
- The Client ID is public by design and is restricted to the registered origins.

## 9. Testing

**Unit tests (Vitest; Google simulated with a fake `api` / fake `fetch`):**
- `safeName` and `billDrivePath` (Vietnamese names kept; illegal characters replaced; year from the bill date).
- `ensureFolderPath`: creates the missing chain; reuses the cache; recreates a trashed or deleted cached folder; finds an existing folder by name instead of duplicating it.
- `uploadBillPdf`: first upload creates; second updates the same `fileId`; a deleted file is recreated.
- `drive/api` error mapping: 401 → auth, 404 → notFound, network error → offline.
- `saveBillToDrive`: writes success and failure to the bill; keeps the old link on failure; concurrent calls produce one upload.
- `pageCuts`: never cuts inside a block; oversized block handling; totals block moved whole.
- `normalizeSettings` and backups for the new fields.
- Bill view: the button appears only on Sent/Paid; "Connect Google Drive in Settings" without a Client ID.
- Editor: export with auto-upload calls the upload and still prints when the upload rejects; export without a Client ID never calls it.

**Manual tests with the owner's Client ID** (added to `docs/manual-test-checklist.md`):
- Connect in Settings, and the email shows.
- Export a bill; the folder chain and file appear in Drive; the PDF opens and looks like the preview.
- Update in Drive: still one file, with a new version in Drive's version history.
- Delete the file in Drive, then Update: a new file is created.
- Offline export: prints, shows Retry; Retry online works.
- On a phone (GitHub Pages address): connect and upload.

## 10. Setup documentation

`docs/google-drive-setup.md` contains the owner's one-time Google Cloud steps:
1. Create a new project.
2. Enable the Google Drive API.
3. Set up the consent screen as External, with the owner as a test user or published; `drive.file` needs no verification.
4. Add the `drive.file` scope.
5. Create a **Web application** OAuth client with JavaScript origins `https://anythingvn.github.io` and `http://localhost:5173`.
6. Paste the Client ID in Settings.

It explains that Desktop-type clients and client secret files do not work and must not be committed.
