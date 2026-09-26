# Save Final Bills to Google Drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload each final (Sent/Paid) bill as a PDF to `My Drive / <main folder> / <year> / <customer> / <bill number>.pdf`, automatically on "Save & export PDF" and via a button, without changing how export works when Drive isn't connected.

**Architecture:** Small units under `src/drive/`:
- `paths` and `api` handle naming and the Drive REST calls;
- `folders` and `upload` handle Drive layout;
- `auth` wraps Google Identity Services;
- `service` orchestrates one save and is the only unit screens call.

PDF bytes come from `src/ui/billPdf.ts`: an off-screen `BillPage` → `html2canvas` → `jsPDF`, using pure paging maths in `src/ui/pdfPaging.ts`. Screens only call `service`.

**Tech Stack:** existing Vite + Preact + TS + Vitest; add `html2canvas`, `jspdf` (dynamically imported); Google Identity Services script `https://accounts.google.com/gsi/client`; Drive REST v3 via `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-26-google-drive-upload-design.md` — read §3–§8 before starting.

## Global Constraints

- OAuth scope exactly `https://www.googleapis.com/auth/drive.file`. No other scope, no client secret anywhere.
- Access token lives only in memory. Never write it to IndexedDB, localStorage, logs, error text, or backups.
- Network hosts: only `accounts.google.com` and `www.googleapis.com`.
- Drive path: `[driveFolderName, <YYYY of billDate>, safeName(customer.name)]`, file name `<bill.number>.pdf`.
- Only bills with status `sent` or `paid` are ever uploaded.
- An upload failure never changes bill status and never blocks or delays the print dialog.
- New settings defaults: `googleClientId: ''`, `driveFolderName: 'Phiếu thanh toán'`, `driveAutoUpload: true`.
- Bill field: `drive?: { fileId: string | null; link: string | null; savedAt: string | null; error: string | null }`. Failure keeps previous `fileId/link/savedAt`.
- Meta keys: `driveConnected` (`{ email: string | null; at: string }`), `driveFolders` (`Record<string, string>`, key = folder names joined by `/`). Neither is exported in backups.
- UI copy (English UI): "Save to Google Drive", "Update in Google Drive", "Connect Google Drive in Settings", "Uploading to Google Drive…", "Saved to Drive <dd/mm/yyyy hh:mm> · Open in Drive", "Not saved to Drive: <reason> · Retry".
- Existing tests must keep passing (`npm test`), and `npm run build` must stay clean. `html2canvas`/`jspdf` must not be in the main bundle chunk.

## Review Focus

1. **Customer name with an apostrophe** (e.g. `Nhà hàng Mama's`) must not break the Drive folder search query. Pinned in Task 3 (`findFolder escapes quotes`).
2. **Two bills for the same new customer uploaded at the same time** (auto-upload plus a quick manual click on another bill) must create each folder once, not duplicates. Pinned in Task 6 (`uploads run one at a time`).
3. **Main folder renamed in Settings after earlier uploads:** re-uploading moves the existing file into the new path instead of leaving it in the old folder. Pinned in Task 4 (`moves file when its folder changed`).
4. **Signed in to a different Google account** (or folders deleted in Drive): cached folder ids that return 404 are dropped and recreated, not reported as errors. Pinned in Task 4 (`recreates missing cached folder`).
5. **Offline when exporting:** no Google popup is attempted, and the bill shows `Offline` with Retry. Pinned in Task 6 (`offline fails fast`).

---

## File Structure

```
src/domain/types.ts            + DriveStatus, Bill.drive, 3 Settings fields
src/domain/draft.ts            DraftBill omits 'drive'
src/storage/backup.ts          validate new bill/settings fields
src/drive/paths.ts             safeName, billDrivePath
src/drive/api.ts               DriveApi interface + createDriveApi(fetch, getToken), DriveError
src/drive/folders.ts           ensureFolderPath
src/drive/upload.ts            uploadBillPdf
src/drive/auth.ts              createDriveAuth (GIS token client)
src/drive/service.ts           configure/connect/disconnect/saveBillToDrive/status listeners
src/ui/pdfPaging.ts            pageCuts (pure)
src/ui/billPdf.ts              makeBillPdf(bill, settings): Promise<Blob>
src/screens/Settings.tsx       Google Drive panel
src/screens/BillView.tsx       Drive status line + button
src/screens/Editor.tsx         auto-upload on Save & export
docs/google-drive-setup.md     owner's one-time Google Cloud steps
docs/manual-test-checklist.md  Drive section
README.md                      one line + link
tests/drive/*.test.ts, tests/drive/fakeDrive.ts, tests/ui/pdfPaging.test.ts, tests/ui/drive-ui.test.tsx
```

---

### Task 1: Data fields for Drive

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/draft.ts`, `src/storage/backup.ts`
- Test: `tests/domain/settings.test.ts`, `tests/storage/backup.test.ts`, `tests/domain/status.test.ts`

**Interfaces:**
- Produces: `export interface DriveStatus { fileId: string | null; link: string | null; savedAt: string | null; error: string | null }`; `Bill.drive?: DriveStatus`; `Settings.googleClientId: string`, `Settings.driveFolderName: string`, `Settings.driveAutoUpload: boolean` with the defaults from Global Constraints; `DraftBill` = `Omit<Bill, 'id'|'number'|'status'|'paidDate'|'createdAt'|'updatedAt'|'drive'> & {...}` (unchanged otherwise).

- [ ] **Step 1: Write failing tests**

```ts
// tests/domain/settings.test.ts
it('adds Drive defaults to older settings', () => {
  const s = normalizeSettings({ businessName: 'X' });
  expect([s.googleClientId, s.driveFolderName, s.driveAutoUpload]).toEqual(['', 'Phiếu thanh toán', true]);
});
// tests/storage/backup.test.ts  (reuse the local `file(settings, bill)` helper pattern already in that file)
it('accepts bills with drive status and rejects damaged drive fields', () => {
  const drive = { fileId: 'f1', link: 'https://drive.google.com/x', savedAt: '2026-09-26T07:00:00.000Z', error: null };
  expect(parseBackup(file(DEFAULT_SETTINGS, { ...sampleBill({ status: 'sent' }), drive })).ok).toBe(true);
  expect(parseBackup(file(DEFAULT_SETTINGS, { ...sampleBill(), drive: { fileId: 5 } })).ok).toBe(false);
  expect(parseBackup(file({ ...DEFAULT_SETTINGS, driveAutoUpload: 'yes' })).ok).toBe(false);
  expect(parseBackup(file({ ...DEFAULT_SETTINGS, googleClientId: 7 })).ok).toBe(false);
});
// tests/domain/status.test.ts
it('keeps drive status when the bill status changes', () => {
  const drive = { fileId: 'f1', link: null, savedAt: null, error: null };
  expect(applyStatus(sampleBill({ status: 'sent', drive }), 'paid', '2026-10-01', 'x').drive).toEqual(drive);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/domain tests/storage` — Expected: the new tests FAIL (missing fields / validation).
- [ ] **Step 3: Implement**
  - Add the types and defaults.
  - Exclude `drive` from `DraftBill`.
  - In `backup.ts`:
    - `validBill` accepts `drive === undefined` or an object whose four keys are each `string | null`;
    - `validSettings` checks `googleClientId` and `driveFolderName` are strings (when present) and `driveAutoUpload` is a boolean (when present).
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — Expected: all PASS, no type errors.
- [ ] **Step 5: Commit** `feat: bill and settings fields for Google Drive`

---

### Task 2: Drive paths

**Files:** Create `src/drive/paths.ts`; Test `tests/drive/paths.test.ts`

**Interfaces:**
- Produces: `safeName(s: string): string`; `billDrivePath(bill: Pick<Bill, 'number' | 'billDate' | 'customer'>, mainFolder: string): { folders: [string, string, string]; fileName: string }`

- [ ] **Step 1: Write failing tests**

```ts
it('keeps Vietnamese names and replaces characters Drive/file systems dislike', () => {
  expect(safeName('Công ty CP Hoa Sen Xanh')).toBe('Công ty CP Hoa Sen Xanh');
  expect(safeName('A/B: "C" <D>*?|\\')).toBe('A B C D');
  expect(safeName(' \t ')).toBe('_');
  expect(safeName('x'.repeat(300))).toHaveLength(100);
});
it('builds main / year / customer / number.pdf from the bill date', () => {
  const p = billDrivePath({ number: 'TT-2027-0001', billDate: '2027-01-02', customer: { ...sampleBill().customer, name: 'Mama/s' } }, 'Phiếu thanh toán');
  expect(p).toEqual({ folders: ['Phiếu thanh toán', '2027', 'Mama s'], fileName: 'TT-2027-0001.pdf' });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/drive/paths.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Replace `/ \ : * ? " < > |` and control characters with a space, collapse whitespace, trim, cut to 100 characters, and return `_` if the result is empty. Apply `safeName` to the main folder too.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Drive folder and file naming for bills`

---

### Task 3: Drive REST client

**Files:** Create `src/drive/api.ts`; Test `tests/drive/api.test.ts`

**Interfaces:**
- Produces:
  - `type DriveErrorKind = 'auth' | 'notFound' | 'offline' | 'origin' | 'other'`
  - `class DriveError extends Error { kind: DriveErrorKind }`
  - `interface DriveFile { id: string; name: string; trashed?: boolean; parents?: string[]; webViewLink?: string }`
  - `interface DriveApi {`
    - `getFile(id: string): Promise<DriveFile | null>` — `null` on 404 or when trashed;
    - `findFolder(name: string, parentId: string): Promise<string | null>` — `parentId` may be `'root'`;
    - `createFolder(name: string, parentId: string): Promise<string>`;
    - `createFile(name: string, parentId: string, pdf: Blob): Promise<DriveFile>`;
    - `updateFile(id: string, name: string, pdf: Blob, move?: { from: string; to: string }): Promise<DriveFile>`;
    - `aboutEmail(): Promise<string | null>`
  - `}`
  - `createDriveApi(getToken: (opts?: { refresh?: boolean }) => Promise<string>, fetchFn: typeof fetch = fetch): DriveApi`
- Endpoints (base `https://www.googleapis.com`), all with `Authorization: Bearer <token>`:
  - `GET /drive/v3/files/{id}?fields=id,name,trashed,parents,webViewLink`
  - `GET /drive/v3/files?q=<q>&fields=files(id)&spaces=drive`
  - `POST /drive/v3/files?fields=id` with JSON `{ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }`
  - `POST /upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,webViewLink`
  - `PATCH /upload/drive/v3/files/{id}?uploadType=multipart&fields=id,name,parents,webViewLink[&addParents=to&removeParents=from]`
  - `GET /drive/v3/about?fields=user(emailAddress)`
- Multipart body: `multipart/related`, one JSON metadata part (`{ name, mimeType: 'application/pdf', parents? }`) and one `application/pdf` part.

- [ ] **Step 1: Write failing tests** (fake `fetchFn` records requests and returns queued `Response`s)
  - `findFolder escapes quotes`:
    - `findFolder("Nhà hàng Mama's", 'root')` sends `q` = `name = 'Nhà hàng Mama\'s' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false` (URL-decoded);
    - it returns the first id, or `null` when `files` is empty.
  - `sends the bearer token`: `Authorization` header equals `Bearer t1` when `getToken` resolves `'t1'`.
  - `refreshes once on 401`:
    - the first response is 401 and the second is 200;
    - `getToken` is called a second time with `{ refresh: true }`;
    - the result is returned.
    - Two 401s → rejects with `DriveError` kind `auth`.
  - `maps errors`: 404 on `getFile` → resolves `null`; `fetchFn` throws `TypeError` → rejects kind `offline`; 500 → kind `other`.
  - `getFile returns null for trashed files`.
  - `updateFile adds move params`: with `move: { from: 'a', to: 'b' }`, the URL contains `addParents=b` and `removeParents=a`.
- [ ] **Step 2: Run** `npx vitest run tests/drive/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the endpoints above. Escape `\` then `'` in query strings.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: minimal Drive REST client with error mapping`

---

### Task 4: Folder chain and bill upload

**Files:** Create `src/drive/folders.ts`, `src/drive/upload.ts`, `tests/drive/fakeDrive.ts`; Test `tests/drive/upload.test.ts`

**Interfaces:**
- Consumes: `DriveApi`, `DriveFile` (Task 3); `billDrivePath` (Task 2); `DriveStatus` (Task 1)
- Produces:
  - `ensureFolderPath(api: DriveApi, names: string[], cache: Record<string, string>): Promise<{ folderId: string; cache: Record<string, string> }>` — cache keys `names.slice(0, i + 1).join('/')`; returns a new cache object.
  - `uploadBillPdf(api: DriveApi, bill: Bill, pdf: Blob, mainFolder: string, cache: Record<string, string>, nowIso: string): Promise<{ status: DriveStatus; cache: Record<string, string> }>`
  - `tests/drive/fakeDrive.ts`: `fakeDrive(): DriveApi & { files: Map<string, DriveFile & { mime: string }>; calls: string[] }` — an in-memory implementation of Task 3's interface, with ids `id1, id2…` and `webViewLink` `https://drive.google.com/file/d/<id>/view`.

- [ ] **Step 1: Write failing tests** using `fakeDrive()`
  - `creates the missing folder chain`: an empty cache creates 3 folders, and the returned cache has keys `Phiếu thanh toán`, `Phiếu thanh toán/2026`, `Phiếu thanh toán/2026/Công ty CP Hoa Sen Xanh`.
  - `reuses cached folders`: a second call makes no `createFolder` calls.
  - `finds an existing folder by name instead of duplicating it`: with a pre-seeded folder and an empty cache, the result is the same id and there is no `createFolder`.
  - `recreates missing cached folder`: delete the cached year folder in the fake; the call creates a new year and customer folder and updates the cache.
  - `first upload creates the file`: status is `{ fileId, link, savedAt: nowIso, error: null }`, and the file has name `TT-2026-0012.pdf` inside the customer folder.
  - `re-upload updates the same file`: with `bill.drive.fileId` set, there's still one file with the same id, and `updateFile` was called.
  - `recreates a deleted file`: `drive.fileId` points to a missing file, so a new id is created.
  - `moves file when its folder changed`: upload with main folder `A`, then again with `B`; the same file id now has parent = the new customer folder.
- [ ] **Step 2: Run** `npx vitest run tests/drive/upload.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** For each level: a cached id that `getFile` returns non-null → use it. Otherwise `findFolder` → else `createFolder`. Root parent is `'root'`. Upload: if `bill.drive?.fileId` and `getFile` is non-null → `updateFile` (with `move` when `parents[0] !== folderId`); else `createFile`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Drive folder chain and bill PDF upload`

---

### Task 5: Google sign-in (GIS token client)

**Files:** Create `src/drive/auth.ts`; Test `tests/drive/auth.test.ts`

**Interfaces:**
- Produces:
  - `interface Gis { initTokenClient(cfg: { client_id: string; scope: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type: string }) => void }): { requestAccessToken(o: { prompt: '' | 'consent' }): void }; revoke(token: string, done: () => void): void }`
  - `loadGis(): Promise<Gis>` — injects `https://accounts.google.com/gsi/client` once and resolves `window.google.accounts.oauth2`.
  - `createDriveAuth(clientId: string, opts: { gis: () => Promise<Gis>; now?: () => number; wasConnected: boolean }): { getToken(o?: { refresh?: boolean }): Promise<string>; revoke(): Promise<void> }`
  - `const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'`

- [ ] **Step 1: Write failing tests** with a fake `Gis`
  - `requests the drive.file scope with consent the first time`: the config has `scope === DRIVE_SCOPE` and the prompt is `'consent'` when `wasConnected: false`, `''` when `true`.
  - `reuses a token until 60 s before expiry`: `expires_in: 3600`; at now + 3500 s it's the same token with no new request; at now + 3541 s there's a new request.
  - `refresh forces a new request`.
  - `rejects when the user closes the popup`: `error_callback({ type: 'popup_closed' })` → rejects `DriveError` kind `auth`. A callback with `error: 'access_denied'` → kind `auth`. An error message containing `origin` → kind `origin`, with the message including `location.origin`.
  - `revoke clears the token`: after `revoke()`, `getToken()` requests again.
- [ ] **Step 2: Run** `npx vitest run tests/drive/auth.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the token and its expiry in closure variables only.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Google Identity Services token client for Drive`

---

### Task 6: Drive service (orchestration)

**Files:** Create `src/drive/service.ts`; Test `tests/drive/service.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 1–5: `createDriveApi`, `ensureFolderPath` (indirectly), `uploadBillPdf`, `createDriveAuth`, `loadGis`.
  - Storage: `getBill`, `putBill`, `getMeta`, `setMeta`.
  - `makeBillPdf` (Task 7). Import it dynamically so Task 6 tests can inject a fake.
- Produces:
  - `driveConfigured(s: Settings): boolean` — `s.googleClientId.trim() !== ''`
  - `interface DriveDeps { auth: { getToken(o?: { refresh?: boolean }): Promise<string>; revoke(): Promise<void> }; api: DriveApi; makePdf(bill: Bill, s: Settings): Promise<Blob>; now(): string; online(): boolean }`
  - `setDriveDepsForTest(deps: DriveDeps | null): void`
  - `connectDrive(db: AppDb, s: Settings): Promise<{ email: string | null }>` — gets a token, reads `aboutEmail`, writes meta `driveConnected`.
  - `disconnectDrive(db: AppDb, s: Settings): Promise<void>` — revoke, delete meta `driveConnected` (set it to `undefined`).
  - `driveConnection(db: AppDb): Promise<{ email: string | null; at: string } | null>`
  - `saveBillToDrive(db: AppDb, billId: string, s: Settings): Promise<DriveStatus>`
  - `isUploading(billId: string): boolean`
  - `onDriveChange(fn: (billId: string) => void): () => void`

- [ ] **Step 1: Write failing tests** (fake-indexeddb db, `setDriveDepsForTest` with `fakeDrive()` from Task 4, a fake auth, and `makePdf` returning `new Blob(['%PDF'])`)
  - `asks for the token before anything else`: call `saveBillToDrive(...)` without awaiting; `auth.getToken` has already been called synchronously.
  - `saves success on the bill`: the stored bill has `drive.fileId`, `link`, `savedAt` = `now()`, and `error` null; `onDriveChange` fired with the bill id; `isUploading` is true during the upload and false after.
  - `keeps the previous link on failure`: the api rejects kind `other`; the stored `drive` keeps the old `fileId/link/savedAt` and sets `error` to the message. The returned status equals the stored one.
  - `refuses drafts and cancelled bills`: resolves with error `Only sent or paid bills are saved to Drive`, and the api is not called.
  - `offline fails fast`: `online()` false → error `Offline`; `getToken` not called.
  - `joins a double click`: two calls for the same bill id → one `createFile`, and both promises resolve to the same status.
  - `uploads run one at a time`: two different bills for the same new customer called concurrently → each folder level is created once.
  - `stores the folder cache in meta`: `driveFolders` is written after an upload; the second upload makes no `createFolder` calls.
  - `never stores the token`: after connect and upload, no meta value, bill field or error text contains the fake token string `ya29.fake`.
  - `connect stores the email`: `aboutEmail` → `'a@b.c'`; `driveConnection(db)` returns `{ email: 'a@b.c', at }`. After `disconnectDrive`, it returns `null` and `revoke` was called.
- [ ] **Step 2: Run** `npx vitest run tests/drive/service.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Default deps are built lazily per `googleClientId`: `createDriveAuth(clientId, { gis: loadGis, wasConnected: <meta driveConnected present> })`, `createDriveApi(auth.getToken)`, `makePdf` = `(await import('../ui/billPdf')).makeBillPdf`, `now` = ISO timestamp, `online` = `navigator.onLine`.
  - Serialize uploads with a module-level promise chain. Map in-flight uploads by bill id.
  - Error text:
    - `auth` → `Not connected to Google Drive`
    - `offline` → `Offline`
    - `origin` → the DriveError message
    - PDF failure → `Could not create the PDF`
    - otherwise → the error message
  - Never include the token in any message.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Drive service to save bills with status tracking`

---

### Task 7: Bill PDF generation

**Files:** Create `src/ui/pdfPaging.ts`, `src/ui/billPdf.ts`; Modify `package.json` (add `html2canvas`, `jspdf`); Test `tests/ui/pdfPaging.test.ts`

**Interfaces:**
- Produces:
  - `pageCuts(blocks: { top: number; bottom: number }[], contentHeight: number, pageHeight: number): number[]` — the start offset of each page, first `0`.
  - `makeBillPdf(bill: Bill, s: Settings): Promise<Blob>`

- [ ] **Step 1: Write failing tests** for `pageCuts`
  - `one page when everything fits`: blocks within 0–900, content 900, page 1000 → `[0]`.
  - `never cuts inside a block`: blocks `[0-400], [400-700], [700-1100]`, content 1100, page 1000 → `[0, 700]`.
  - `moves the end block whole`: rows up to 950 and an end block `950-1300`, page 1000 → second page starts at 950.
  - `cuts a block taller than a page at the page height`: block `0-2500`, page 1000 → `[0, 1000, 2000]`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/pdfPaging.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `pageCuts`.**
  - From page start `s`, `limit = s + pageHeight`.
  - If `limit >= contentHeight`, stop.
  - Otherwise the next start is the `top` of the first block with `top > s` and `bottom > limit`, if that top is `> s`; else `limit`.
- [ ] **Step 4: Implement `makeBillPdf`.**
  - Install: `npm install html2canvas jspdf`.
  - Render `<BillPage bill={draftFromBill(bill)} settings={s} qrDataUrl={await qrToDataUrl(payload)} />` into a detached container. Style it `position:fixed; left:-10000px; top:0; width:210mm; padding:14mm 15mm; background:#fff`, and remove the sheet's shadow and min-height via inline style.
  - Wait two animation frames.
  - Blocks:
    - one block from the sheet top to the bottom of the first `tbody tr` of the main `.bill-table`, so header, title, customer, table head and first row stay together;
    - each further row of that tbody;
    - `.bill-end`;
    - all measured relative to the container with `getBoundingClientRect`.
  - Measure block positions relative to the container's **content box**, i.e. minus the 14 mm top padding.
  - `html2canvas(container, { scale: 2, backgroundColor: '#fff' })`.
  - `mmPx = scale * container.offsetWidth / 210` (canvas px per mm).
  - `pageHeight = 269 * mmPx` (297 mm minus 14 mm top and bottom margins).
  - For each cut `c`, the next cut or content end `e` gives `h = e − c`. Copy the canvas region `x 0, y 14 * mmPx + c, full width, height h` into a temporary canvas.
  - `pdf.addImage(temp.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 14, 210, h / mmPx)`, adding a new page before every slice after the first. The side margins come from the container's 15 mm padding, which is included in the full-width slice.
  - `jsPDF({ unit: 'mm', format: 'a4' })`. Return `pdf.output('blob')`. Remove the container in `finally`.
  - Both libraries are imported with `await import(...)`.
- [ ] **Step 5: Run** `npm test && npm run build` — Expected: PASS. Build output shows separate chunks for `html2canvas` and `jspdf`, not inside `index-*.js` (check `ls dist/assets`).
- [ ] **Step 6: Manual check.** In `npm run dev`, run this in the console on a bill view:
  ```js
  const m = await import('/src/ui/billPdf.ts');
  window.open(URL.createObjectURL(await m.makeBillPdf(bill, settings)));
  ```
  Use real `bill`/`settings` read from IndexedDB. Check a 3-line bill is one page that matches the preview, and a 25-line bill has no row cut in half.
- [ ] **Step 7: Commit** `feat: generate bill PDFs in the browser for Drive upload`

---

### Task 8: Settings → Google Drive panel

**Files:** Modify `src/screens/Settings.tsx`; Test `tests/ui/drive-ui.test.tsx`

**Interfaces:**
- Consumes: `connectDrive`, `disconnectDrive`, `driveConnection`, `driveConfigured` (Task 6); settings fields (Task 1).

- [ ] **Step 1: Write failing tests** (`vi.mock('../../src/drive/service')` with spies; render `<App>` at `#/settings`, following `tests/ui/app.test.tsx`)
  - `shows the Drive panel fields`: the Client ID input, a main folder input with value `Phiếu thanh toán`, and an auto-upload checkbox that is checked.
  - `Connect is disabled until a Client ID is saved`.
  - `Connect calls connectDrive and shows the email`: `connectDrive` resolves `{ email: 'a@b.c' }` → the text `Connected as a@b.c`.
  - `rejects a main folder name containing /`: shows `Main folder name cannot contain /`, and nothing is saved.
- [ ] **Step 2: Run** `npx vitest run tests/ui/drive-ui.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** a panel titled `Google Drive`:
  - the three fields;
  - `Connect Google Drive` / `Disconnect`;
  - status text `Connected as <email>` or `Not connected on this device`;
  - a link `How to set up` → `https://github.com/anythingvn/billpayment/blob/main/docs/google-drive-setup.md`.

  Validation on Save:
  - folder name required when a Client ID is set;
  - no `/` in the folder name;
  - trim the Client ID.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Google Drive settings panel`

---

### Task 9: Bill view status/button and auto-upload on export

**Files:** Modify `src/screens/BillView.tsx`, `src/screens/Editor.tsx`; Test `tests/ui/drive-ui.test.tsx`

**Interfaces:**
- Consumes: `saveBillToDrive`, `isUploading`, `onDriveChange`, `driveConfigured` (Task 6)

- [ ] **Step 1: Write failing tests** (same mock)
  - `button only on sent and paid bills`:
    - sent → `Save to Google Drive`;
    - paid with `drive.fileId` → `Update in Google Drive`;
    - draft and cancelled → neither.
  - `no Client ID shows the settings hint`: `Connect Google Drive in Settings` is shown and there is no button.
  - `shows saved status with link`: `drive.savedAt` set → text matching `/Saved to Drive \d\d\/\d\d\/\d{4} \d\d:\d\d/` and a link `Open in Drive` with `href` = `drive.link` and `target="_blank"`.
  - `shows error with Retry`: `drive.error: 'Offline'` → `Not saved to Drive: Offline`; clicking `Retry` calls `saveBillToDrive`.
  - `export uploads when enabled and still prints if the upload fails`:
    - setup: `saveBillToDrive` rejects, the Client ID is set, and auto-upload is on;
    - after `Save & export PDF`, `saveBillToDrive` was called with the new bill id and `window.print` was called.
  - `export without Client ID never calls the upload`.
  - `export with auto-upload off never calls the upload`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/drive-ui.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **BillView:** subscribe to `onDriveChange` and reload the bill when its id fires.
  - **BillView status line:** show `Uploading to Google Drive…` while `isUploading(id)`; otherwise the saved or error forms from Global Constraints (time formatted `dd/mm/yyyy hh:mm` in local time).
  - **Editor `saveAndExport`:** right after `save('sent')` succeeds and before the QR/print work, call `saveBillToDrive(db, bill.id, settings).catch(() => {})` without awaiting, when `driveConfigured(settings) && settings.driveAutoUpload`.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: PASS, clean build.
- [ ] **Step 5: Commit** `feat: save bills to Google Drive from the bill view and on export`

---

### Task 10: Setup guide, checklist and real-account verification

**Files:** Create `docs/google-drive-setup.md`; Modify `docs/manual-test-checklist.md`, `README.md`

- [ ] **Step 1: Write `docs/google-drive-setup.md`** with the six steps in spec §10.
  - Exact origins: `https://anythingvn.github.io` and `http://localhost:5173`.
  - Scope `…/auth/drive.file`.
  - "Desktop app" clients and `client_secret_*.json` files don't work and must never be committed.
  - Only the Client ID goes into Settings.
- [ ] **Step 2: Add a "Google Drive" section** to `docs/manual-test-checklist.md` with the manual tests from spec §9. Add one README line under "Use" linking the guide.
- [ ] **Step 3: Verify with the owner's Client ID** (the owner has added both origins).
  1. Run `npm run dev` on port 5173. In Settings, paste the Client ID, Save, Connect → the email shows.
  2. Export a bill → Drive has `Phiếu thanh toán/<year>/<customer>/<number>.pdf`. It opens and matches the preview.
  3. Update in Google Drive → still one file, and Drive shows 2 versions.
  4. Delete the file in Drive, then Update → a new file.
  5. Go offline (DevTools) and export → it prints, and the bill shows `Offline · Retry`. Retry online works.

  Record results in the ledger.
- [ ] **Step 4: Commit** `docs: Google Drive setup guide and manual checks`

---

## Self-review notes

| Spec | Task |
|---|---|
| §3.1 Settings panel | 8 |
| §3.2 bill view | 9 |
| §3.3 export + auto-upload | 9 (order: upload started before print), 6 (token first) |
| §4 GIS, token in memory, connect/disconnect, popup rule | 5, 6 |
| §5 PDF, paging, dynamic import | 7 |
| §6 units, bill field, settings, backups | 1–6 |
| §7 errors | 3 (mapping), 5 (popup/origin), 6 (offline, join, messages), 4 (deleted folders/files) |
| §8 security | Global Constraints; 5 and 6 tests assert the token isn't persisted or messaged (Task 6: `stores the folder cache in meta` also checks meta has no key containing `token`) |
| §9 tests and manual | 1–10 |
| §10 setup doc | 10 |
