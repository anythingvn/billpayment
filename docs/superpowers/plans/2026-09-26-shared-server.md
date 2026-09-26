# Shared Server (5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the app's data to the owner's own Node + SQLite server, with Admin-managed accounts, read-only offline viewing and a company Google Drive, runnable locally with Docker.

**Architecture:**
- **One storage interface:** every data operation goes through a `Store` interface. Its implementations are:
  - `IdbStore` (today's IndexedDB code, kept as the tests' store and the offline cache);
  - `SqliteStore` (the server);
  - `ApiStore` (the browser talking to `/api`).
- **Screens:** they keep calling the existing `src/storage/db.ts` functions (`listBills(db)`, …), which now delegate to the `Store`.
- **Server:** a Fastify app (`server/`) serves the built app and `/api`, and reuses `src/domain/` for the business rules.

**Tech Stack:**
- Node ≥ 22.13 (here 26) with the built-in `node:sqlite` (no native add-on);
- Fastify 5, `@fastify/cookie`, `@fastify/static`;
- esbuild (bundles the server);
- Vitest (server tests with `// @vitest-environment node`);
- the existing Vite, Preact and TypeScript app;
- Docker (`node:24-slim`).

**Spec:** `docs/superpowers/specs/2026-09-26-shared-server-design.md`

## Global Constraints

- **Roles:** stored values are exactly `admin`, `manager`, `creator` and `accountant`. In 5a only the Users screen, the activity log, Download backup, Restore and the Drive connect/disconnect are admin-only.
- **Passwords:**
  - at least 10 characters;
  - `scrypt` N=2^15, r=8, p=1, 64-byte key, 16-byte random salt;
  - `timingSafeEqual` for the comparison;
  - never logged or returned;
  - "must change" after an Admin creates or resets them.
- **Sessions:**
  - 32 random bytes, stored as a SHA-256 hash;
  - cookie `sid`: `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` when `PUBLIC_URL` starts with `https`;
  - 30 days from the last use.
- **Lockout:** 5 failures per username within 15 minutes → locked for 15 minutes. The same message every time: "Wrong username or password, or the account is locked for a while".
- **CSRF:** `POST`/`PUT`/`PATCH`/`DELETE` need the header `X-Requested-With: billpayment`, plus `Origin` equal to the `PUBLIC_URL` origin when present; otherwise `403`.
- **Limits and headers:**
  - body limit 20 MB;
  - headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Content-Security-Policy: frame-ancestors 'none'`.
- **Versions:**
  - every stored record returned by the API carries `version` (an integer, 1 on create);
  - every update sends the version it started from; a mismatch → `409`, body `{ error: 'conflict' }`;
  - the app message: "Someone else changed this — reload to see their changes".
- **Authorship:** `createdBy` / `updatedBy` (display names) and `createdAt` / `updatedAt` on records returned by the API.
- **Errors:**
  - `401` `{ error: 'signin' }`;
  - `422` `{ error: 'invalid', messages: string[] }`;
  - `500` `{ error: 'server' }`, with details only in the server log.
- **Offline:**
  - the server is treated as unreachable after an 8 s timeout or a network error;
  - banner "Offline — viewing only · last updated hh:mm";
  - disabled buttons get the tooltip "Needs a connection";
  - the cache is per user and cleared on sign-out.
- **Error copy:**
  - "Can't reach the server — your change wasn't saved";
  - "Something went wrong on the server".
- **Environment:**
  - `SESSION_SECRET` and `TOKEN_KEY` (32 bytes, base64) are required;
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL` (default `http://localhost:8080`), `DATA_DIR` (default `/data`) and `PORT` (default `8080`).
  - `.env` is git-ignored.
- **Backups:**
  - nightly at 02:00 server time to `DATA_DIR/backups/billpayment-YYYY-MM-DD.db`, keeping 14;
  - the JSON download never contains password hashes, sessions or the Google token;
  - Restore needs the text `RESTORE` and keeps users, sessions and the Drive connection.
- **Drive:** scope `drive.file`, callback `/api/drive/callback`, refresh token encrypted with AES-256-GCM using `TOKEN_KEY`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two users creating bills at the same moment must get different numbers.** Pinned in Task 4 (`20 simultaneous allocations`).
2. **A stale edit must never overwrite a newer one.** The version check happens in the same SQLite transaction as the write. Pinned in Task 4 (`stale version gets 409 and changes nothing`).
3. **Secrets must never leave the server:** password hashes, session ids and the Google refresh token stay out of backup downloads, API responses and logs. Pinned in Task 5 (`backup JSON has no secrets`) and Task 3 (`user API never returns hashes`).
4. **Offline must never silently lose a change.** A write while offline fails loudly and the form keeps its input. Pinned in Task 6 (`offline write throws OfflineError`) and Task 7 (`offline banner and disabled buttons`).
5. **Importing a real backup must continue the numbering** (the next bill after the import gets the next number, not 0001), and keep templates and the report/statement Drive statuses. Pinned in Task 5 (`import continues numbering`).

---

### Task 1: The Store interface (refactor, no behaviour change)

**Files:**
- Create: `src/storage/store.ts` (the `Store` interface), `src/storage/idbStore.ts` (today's IndexedDB code, moved)
- Modify:
  - `src/storage/db.ts`: `AppDb` becomes an alias of `Store`; `openAppDb(name?)` returns an `IdbStore`; every exported function delegates, e.g. `listBills = (db: Store) => db.listBills()`;
  - `src/storage/numbering.ts` and `contractNumbering.ts` (use `db.nextCounter(key)`);
  - `src/storage/backup.ts` (`exportAll` and `restoreAll` use `db.exportAll()` / `db.restoreAll()`; `parseBackup` stays);
  - `src/drive/service.ts` (`recordStatus` uses `db.updateDriveStatus`).
- Test: `tests/storage/store-contract.ts` (a shared suite), `tests/storage/idbStore.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Store {
  listCustomers(): Promise<Customer[]>; putCustomer(c: Customer): Promise<Customer>;
  deleteOrArchiveCustomer(id: string): Promise<'deleted' | 'archived'>;
  listServices(): Promise<Service[]>; putService(s: Service): Promise<Service>;
  listBills(): Promise<Bill[]>; getBill(id: string): Promise<Bill | undefined>; putBill(b: Bill): Promise<Bill>;
  listContracts(): Promise<Contract[]>; getContract(id: string): Promise<Contract | undefined>; putContract(c: Contract): Promise<Contract>;
  deleteContract(id: string): Promise<'deleted' | 'refused'>;
  listTemplates(): Promise<DocTemplate[]>; putTemplate(t: DocTemplate): Promise<void>;
  removeTemplate(id: string): Promise<{ contractsReset: number }>; templateFor(kind: DocKind, templateId?: string | null): Promise<DocTemplate | null>;
  getSettings(): Promise<Settings>; putSettings(s: Settings): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>; setMeta(key: string, value: unknown): Promise<void>;
  /** Atomically increments meta counter `key` and returns the new value (1 for a new key). */
  nextCounter(key: string): Promise<number>;
  updateDriveStatus(target: { type: 'bill' | 'contract'; id: string }, field: 'drive' | 'driveDocx', make: (prev: DriveStatus | undefined) => DriveStatus): Promise<DriveStatus>;
  exportAll(nowIso: string): Promise<BackupData>; restoreAll(data: BackupData): Promise<void>;
}
```

  - Record types in `src/domain/types.ts` gain optional `version?: number`, `createdBy?: string` and `updatedBy?: string` on Bill, Contract, Customer, Service, DocTemplate and Settings. They are ignored by `IdbStore`, and set by the server.

- [ ] **Step 1: Write the shared contract suite.** `storeContract(name, make: () => Promise<Store>)` runs tests that pin today's behaviour:
  - put/get/list for every record type;
  - delete-or-archive a customer with and without bills;
  - `deleteContract` refused with addenda or bills;
  - the template default and removal rules (the same cases as `tests/storage/templates.test.ts`);
  - `nextCounter` returns 1, 2, 3;
  - `updateDriveStatus` merges;
  - an export → restore round trip.

  `tests/storage/idbStore.test.ts` calls it with fake-indexeddb.
- [ ] **Step 2: Run** `npx vitest run tests/storage/idbStore.test.ts`. Expected: FAIL (no `Store`).
- [ ] **Step 3: Implement** by moving code, not rewriting it. Keep `openAppDb`'s upgrade logic and its `onBlocked`/`blocking` behaviour.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, with every existing test green and unchanged, except imports of moved names.
- [ ] **Step 5: Commit** `refactor: data access through a Store interface`

---

### Task 2: Server skeleton and SqliteStore

**Files:**
- Create:
  - `server/src/sqliteStore.ts`: `SqliteStore implements Store`, with schema and migrations in `server/src/schema.ts`;
  - `server/src/app.ts`: `buildApp(opts): FastifyInstance`, which serves `dist/` statically and `GET /api/health` → `{ ok: true }`;
  - `server/src/main.ts`: reads the env, refuses to start without `SESSION_SECRET`/`TOKEN_KEY` (message "Missing SESSION_SECRET or TOKEN_KEY in .env"), and listens on `PORT`;
  - `server/src/env.ts`;
  - `scripts/make-env.ts`: writes `.env` with random `SESSION_SECRET` and `TOKEN_KEY` if it's missing;
  - `.env.example`.
- Modify:
  - `package.json`: dependencies `fastify`, `@fastify/cookie`, `@fastify/static`; dev dependency `esbuild`; scripts `server` (`tsx server/src/main.ts`), `build:server` (esbuild bundle to `server/dist/main.js`, `--platform=node --format=esm --packages=external`), `make-env`;
  - `.gitignore` (`.env`, `data/`, `server/dist/`);
  - `vite.config.ts`: dev proxy `/api` → `http://localhost:8080`.
- Test: `server/tests/sqliteStore.test.ts` (runs `storeContract` against `SqliteStore` on a temp file), `server/tests/app.test.ts`

**Interfaces:**
- Produces:
  - `new SqliteStore(file: string)` with `close()`, plus the internals Tasks 3–5 use: `db: DatabaseSync` and `transaction<T>(fn: () => T): T`;
  - `buildApp({ store, env, now? }): Promise<FastifyInstance>`;
  - `Env { sessionSecret, tokenKey: Buffer, googleClientId, googleClientSecret, publicUrl, dataDir, port }`.
- **Schema:**
  - `records(kind TEXT, id TEXT, json TEXT, version INT, created_at, created_by, updated_at, updated_by, PRIMARY KEY(kind, id))`;
  - `meta(key PRIMARY KEY, json)`;
  - `templates(id PRIMARY KEY, json, data BLOB, version, …)`;
  - `users`, `sessions` and `activity` are created now and used in Task 3.

- [ ] **Step 1: Failing tests:**
  - `SqliteStore passes the store contract`;
  - `health`: `GET /api/health` → 200 `{ ok: true }`;
  - `serves the app`: `GET /` returns `dist/index.html` when present (the test writes a temp `dist`);
  - `env`: `loadEnv({})` throws the "Missing SESSION_SECRET or TOKEN_KEY" message; `TOKEN_KEY` must decode to 32 bytes.
- [ ] **Step 2: Run** `npx vitest run server/tests`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the `node:sqlite` `DatabaseSync` with `PRAGMA journal_mode=WAL` and `foreign_keys=ON`.
- [ ] **Step 4: Run** `npm test && npm run build && npm run build:server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): Fastify + SQLite store`

---

### Task 3: Accounts, sessions and security

**Files:**
- Create: `server/src/auth.ts` (password hashing, sessions, lockout), `server/src/routes/auth.ts`, `server/src/routes/users.ts`, `server/src/activity.ts`, `server/src/security.ts` (headers, CSRF hook, body limit)
- Test: `server/tests/auth.test.ts`, `server/tests/users.test.ts`

**Interfaces:**
- **Routes:**
  - `GET /api/setup` → `{ needed: boolean }`;
  - `POST /api/setup` `{ username, displayName, password }`: only when there are no users → the Admin is created and signed in;
  - `POST /api/signin` `{ username, password }` → `{ user }` plus the cookie;
  - `POST /api/signout`;
  - `GET /api/me` → `{ user: { id, username, displayName, role, mustChangePassword } }` or `401`;
  - `POST /api/me/password` `{ current, next }`;
  - admin only:
    - `GET /api/users`;
    - `POST /api/users` `{ username, displayName, role, password }`;
    - `PATCH /api/users/:id` `{ displayName?, role?, disabled? }`;
    - `POST /api/users/:id/password` `{ password }`;
    - `GET /api/activity?before=<iso>` (200 per page).
- **Produces:**
  - a `requireUser(req)` / `requireAdmin(req)` preHandler;
  - `logActivity(store, userId | null, action: string, detail: object)`. Actions: `signin`, `signout`, `signin-failed`, `locked`, `user-created`, `user-changed`, `user-disabled`, `password-reset`, `delete`, `import`, `restore`, `backup-download`, `drive-connect`, `drive-disconnect`.

- [ ] **Step 1: Failing tests:**
  - `setup creates the first admin once`: a second `POST /api/setup` → `409`.
  - `sign in and me`: the cookie flags `HttpOnly; SameSite=Strict; Path=/`, with no `Secure` for an http `PUBLIC_URL`.
  - `wrong password and unknown user give the same message`.
  - `locks after 5 failures for 15 minutes`: an injected `now` moves time forward; after 15 minutes sign-in works again.
  - `password rules`: 9 characters → 422; the stored hash is not the password; sign-in works.
  - `sessions`:
    - expire after 30 days idle;
    - sign-out ends the session;
    - disabling a user or resetting their password ends all their sessions.
  - `CSRF`: `POST /api/signout` without `X-Requested-With` → `403`; with a foreign `Origin` → `403`.
  - `security headers on every response`.
  - `last admin`: disabling or demoting the only active admin → `422` "There must be at least one active Admin".
  - `users API never returns hashes`: the response JSON contains no `hash`, `salt` or `sid`.
  - `non-admin gets 403 on users and activity`.
  - `must change password`: a user created by the Admin has `mustChangePassword: true` until `POST /api/me/password`.
  - `activity`: signin, signin-failed, locked and user-created are recorded, newest first.
- [ ] **Step 2: Run** `npx vitest run server/tests/auth.test.ts server/tests/users.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): accounts, sessions and security`

---

### Task 4: Records API, versions, validation and numbering

**Files:**
- Create: `server/src/routes/records.ts`, `server/src/validate.ts`
- Modify: `server/src/sqliteStore.ts` (versioned writes, authorship)
- Test: `server/tests/records.test.ts`

**Interfaces:**
- **Routes** (all need a signed-in user):
  - `GET /api/{customers|services|bills|contracts|templates}`;
  - `GET /api/{bills|contracts}/:id`;
  - `PUT /api/{kind}/:id`: the body is the record, including `version` (absent = create). It returns the saved record with its new `version` and authorship.
  - `DELETE /api/customers/:id` → `{ result: 'deleted' | 'archived' }`;
  - `DELETE /api/contracts/:id` → `{ result }`;
  - `DELETE /api/templates/:id` → `{ contractsReset }`;
  - `GET/PUT /api/settings`;
  - `GET/PUT /api/meta/:key` (only the keys `report-drive:*`, `statement-drive:*` and `lastBackupAt`; others → `403`);
  - `POST /api/numbers/bill` `{ prefix, billDate }` → `{ number }`;
  - `POST /api/numbers/contract` `{ signedDate }` → `{ number }`;
  - `GET /api/numbers/contract/peek?signedDate=` → `{ number }`;
  - `GET /api/templates/:id/data` (the bytes);
  - `PUT /api/templates/:id` with the bytes base64-encoded.
- **Produces:** `validateWrite(kind, prev | undefined, next): string[]`:
  - for bills: `draftSaveErrors` for drafts;
  - locked bills (`sent`, `paid`, `cancelled`) may only change `status` (via `canTransition`), `paidDate`, `drive` and `driveDocx`;
  - for contracts: `contractSaveErrors`;
  - for customers and services: a name is required.

- [ ] **Step 1: Failing tests:**
  - `create and update with versions`: create → version 1, update with 1 → 2.
  - `stale version gets 409 and changes nothing`: two updates both sending version 1 → the second gets `409`, and the stored record holds the first update.
  - `authorship`: `createdBy`/`updatedBy` are the display names of the two users who created and changed the record.
  - `20 simultaneous allocations`: `Promise.all` of 20 `POST /api/numbers/bill` → 20 distinct numbers `TT-2026-0001` … `TT-2026-0020`.
  - `server refuses an invalid bill`: a draft line with an empty price → `422` with the same message as `draftSaveErrors`; editing a sent bill's lines → `422` "This bill is locked…".
  - `delete rules`: customer with bills → `archived`; contract with addenda → `refused`; each delete is logged in the activity log.
  - `meta keys`: `PUT /api/meta/counter-2026` → `403`.
  - `signed out`: `GET /api/bills` → `401`.
- [ ] **Step 2: Run** `npx vitest run server/tests/records.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The version check and write happen in one `transaction`, and numbering uses `nextCounter` inside a transaction.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): records API with versions, validation and numbering`

---

### Task 5: Import, backup and restore

**Files:**
- Create: `server/src/routes/backup.ts`, `server/src/nightly.ts`
- Test: `server/tests/backup.test.ts`

**Interfaces:**
- **Routes:**
  - `POST /api/import` (the backup JSON): allowed only by the Admin and only while there are no bills (else `409` "Import is only for a new server — use Restore"). Uses `parseBackup`, then `restoreAll`, and logs `import`.
  - `GET /api/backup` (admin): the backup JSON plus `users` (`{ username, displayName, role, disabled }` only) and `activity`. Logs `backup-download`.
  - `POST /api/restore` (admin) `{ confirm: 'RESTORE', data }`: replaces the business data and keeps `users`, `sessions`, `drive-token`, `driveConnected` and `driveFolders`. Logs `restore`.
- **Produces:** `startNightlyBackup(store, dataDir, now)` runs at 02:00 local time, writes with `VACUUM INTO` to `backups/billpayment-YYYY-MM-DD.db` and keeps the newest 14. `runBackupNow()` is exported for tests.

- [ ] **Step 1: Failing tests:**
  - `import continues numbering`: import a backup with `counter-2026: 12` → the next `POST /api/numbers/bill` gives `TT-2026-0013`. Templates, `reportDrive` and `statementDrive` statuses are present.
  - `import refused once there are bills`.
  - `backup JSON has no secrets`: after setting a password, a session and a drive token, the JSON has no `hash`, `salt`, `sid`, `refresh` or `token`, and it parses with `parseBackup`.
  - `restore keeps users and needs RESTORE`: without the confirm text → `422`; with it, the business data is replaced and the Admin can still sign in.
  - `nightly backup keeps 14`: with 16 old files present, after a run there are 14 files, including today's.
- [ ] **Step 2: Run** `npx vitest run server/tests/backup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): import, backup and restore`

---

### Task 6: ApiStore and offline cache in the app

**Files:**
- Create:
  - `src/storage/apiStore.ts`: `ApiStore implements Store`. It uses fetch with `credentials: 'same-origin'`, the `X-Requested-With` header and an 8 s timeout.
  - `src/storage/errors.ts`: `OfflineError`, `SignInError`, `ConflictError`, `InvalidError(messages)`, `ServerError`.
  - `src/storage/cache.ts`: an IndexedDB cache named `payment-bills-cache-<userId>`, storing the last read data. `clearCache(userId)`.
- Test: `tests/storage/apiStore.test.ts`, with a fake `fetch`.

**Interfaces:**
- Produces:
  - `new ApiStore({ fetch?, userId, onStatus(status: 'online' | 'offline', lastUpdated?: string) })`;
  - reads: from the server, writing the result to the cache; on a network error or timeout they read the cache, report `offline`, and return cached data (empty lists if nothing is cached);
  - writes: throw `OfflineError` without calling the server when `navigator.onLine` is false; otherwise the HTTP status maps to the errors above;
  - `putBill` and the other puts return the server's record, with its new version.

- [ ] **Step 1: Failing tests:**
  - `reads go to the API and fill the cache`.
  - `falls back to the cache when the server is unreachable`: fetch rejects → cached bills are returned and `onStatus('offline', <iso>)` is called.
  - `offline write throws OfflineError`: with `navigator.onLine=false`, `putBill` throws `OfflineError` and fetch is not called.
  - `maps statuses`: 401 → `SignInError`; 409 → `ConflictError`; 422 → `InvalidError(['…'])`; 500 → `ServerError`.
  - `times out after 8 s`: fake timers, fetch never resolves → cache fallback.
  - `sends the CSRF header on writes`.
  - `the cache is per user and cleared`.
- [ ] **Step 2: Run** `npx vitest run tests/storage/apiStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: ApiStore with read-only offline cache`

---

### Task 7: App sign-in, setup, users, offline banner, authorship

**Files:**
- Create:
  - `src/screens/SignIn.tsx`, `src/screens/Setup.tsx` (Admin + optional Import), `src/screens/ChangePassword.tsx`;
  - `src/screens/Users.tsx` (admin), `src/screens/Activity.tsx` (admin);
  - `src/ui/OfflineBanner.tsx`, `src/ui/useOnline.ts`.
- Modify:
  - `src/main.tsx`: `GET /api/setup` → Setup; else `GET /api/me` → SignIn or the App with an `ApiStore`.
  - `src/app.tsx`:
    - context gains `user` and `online`;
    - the NAV adds `Users` and `Activity` for admins;
    - a user menu with the display name and **Sign out**;
    - every screen gets `<OfflineBanner/>`;
    - a global handler: `SignInError` → the sign-in screen, returning to the same route; `ConflictError`/`OfflineError`/`InvalidError`/`ServerError` → the message in the screen's error area, keeping the form input.
  - `src/router.ts`: routes `users` and `activity`.
  - Screens with writing buttons (Editor, BillView, ContractEditor, ContractView, Customers, Services, Settings, SettingsDocuments, Reports, Statement, Backup): the buttons are `disabled={!online}` with `title="Needs a connection"`.
  - `src/screens/Editor.tsx`: "Prepared by" on a new bill defaults to `user.displayName`.
  - `BillView` and `ContractView` show "Created by X · changed by Y dd/mm hh:mm" when present.
  - `src/screens/Backup.tsx`, for admins:
    - **Download backup** (server);
    - **Restore**, which asks for the typed `RESTORE`.
- Test: `tests/ui/server-ui.test.tsx`, using `App` with a fake `Store` and fake `/api` auth calls.

- [ ] **Step 1: Failing tests:**
  - `setup screen when there are no users`: it creates the Admin, then offers Import.
  - `sign in`:
    - a wrong password shows the lockout-neutral message;
    - a correct one opens Bills;
    - `mustChangePassword` shows Change password first.
  - `Users screen (admin only)`:
    - add a user (role select with the four roles);
    - reset a password;
    - disable one;
    - the last-admin error is shown;
    - a non-admin doesn't see the Users menu.
  - `offline banner and disabled buttons`: `onStatus('offline')` shows the banner text, **+ New bill** is disabled with the tooltip, and opening a bill still works.
  - `conflict message`: saving a customer that gets `ConflictError` shows the conflict copy with **Reload**, and the form keeps the typed name.
  - `signed out mid-session`: `SignInError` on save shows the sign-in screen; after signing in, the same route shows again.
  - `prepared by defaults to the user`.
  - `created and changed by on a bill`.
  - The existing UI tests keep passing, with `openApp` helpers passing a signed-in admin by default.
- [ ] **Step 2: Run** `npx vitest run tests/ui/server-ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sign-in, setup, users and offline viewing in the app`

---

### Task 8: Company Google Drive on the server

**Files:**
- Create: `server/src/drive.ts`: OAuth (a web client), an encrypted token store, and upload using the existing `uploadFile` from `src/drive/upload.ts` with a server `DriveApi` built on fetch and the refresh token. Also `server/src/routes/drive.ts`.
- Modify:
  - `src/drive/service.ts`: `saveBillToDrive`, `saveDocxToDrive`, `saveReportToDrive` and `saveStatementToDrive` build the file in the browser as today, then `POST /api/drive/upload` (multipart: file + JSON target). They keep their return types and status recording, and `onDriveChange` stays.
  - Remove the GIS token client (`src/drive/auth.ts`), `prepareDrive`'s script loading and `BUILT_IN_GOOGLE_CLIENT_ID` use.
  - `src/screens/Settings.tsx`, Drive panel:
    - for the Admin: Connect / Disconnect (redirect to `/api/drive/connect`) and "Connected as <email>";
    - for others: "Drive is connected by the Admin".
- Test: `server/tests/drive.test.ts` (with the fake Drive from `tests/drive/fakeDrive.ts`); update `tests/drive/service.test.ts` and the Drive UI tests.

**Interfaces:**
- **Routes:**
  - `GET /api/drive/status` → `{ connected, email }`;
  - `GET /api/drive/connect` (admin) → a redirect to Google with `state`, a random value stored for 10 minutes;
  - `GET /api/drive/callback?code&state`: exchanges the code, stores `{ refreshToken, email }` encrypted, logs `drive-connect`, and redirects to `/#/settings`;
  - `POST /api/drive/disconnect` (admin);
  - `POST /api/drive/upload` → `DriveStatus`. The server records the status (bill, contract, or meta for reports and statements) and runs one upload at a time.
- **Produces:**
  - `encryptToken(key, text): string`, `decryptToken(key, blob): string` (AES-256-GCM, a random 12-byte IV, `iv.tag.cipher` base64);
  - `ServerDrive { upload(target, file, mime, name, folders) }`.

- [ ] **Step 1: Failing tests:**
  - `token is stored encrypted`: the meta value doesn't contain the token; it decrypts with `TOKEN_KEY`; the wrong key throws.
  - `callback checks state`: a wrong or expired state → `400`, and nothing is stored.
  - `upload creates then updates the same file`: two uploads for the same bill → one `createFile`, one `updateFile`; the status is saved on the bill.
  - `report and statement uploads record meta statuses` (keys as today, statements keyed by customer).
  - `upload without a connection`: `409` "Google Drive isn't connected — ask the Admin".
  - `non-admin cannot connect`.
  - Browser: `saveBillToDrive posts the PDF to the server` (fake fetch), and the status line shows the returned status.
- [ ] **Step 2: Run** `npx vitest run server/tests/drive.test.ts tests/drive`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build && npm run build:server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: company Google Drive on the server`

---

### Task 9: Docker, docs and manual check

**Files:**
- Create:
  - `Dockerfile`:
    - stage 1 on `node:24-slim`: `npm ci`, `npm run build`, `npm run build:server`;
    - stage 2 on `node:24-slim`: copy `dist/`, `server/dist/` and the production `node_modules`; `ENV DATA_DIR=/data`; `EXPOSE 8080`; `CMD ["node", "server/dist/main.js"]`; run as a non-root user.
  - `docker-compose.yml`: service `app`, `build: .`, `env_file: .env`, `ports: ["8080:8080"]`, `volumes: ["./data:/data"]`, `restart: unless-stopped`.
  - `.dockerignore`;
  - `docs/server-setup.md` (spec §8).
- Modify:
  - `README.md`: what the server version is, local run (`npm run make-env && npm run build && npm run server`, or `docker compose up --build`), and how GitHub Pages differs;
  - `docs/manual-test-checklist.md`: section "11. Shared server" from spec §9 Manual, and a Last run row.

- [ ] **Step 1: Write the files.**
- [ ] **Step 2: Verify locally.**
  - `npm run make-env && npm run build && npm run build:server && node server/dist/main.js` (with `DATA_DIR=./data`).
  - In the browser (`bills-server` launch config, port 8080):
    - Setup → import a test backup;
    - create a second user;
    - two tabs as two users edit the same customer (the conflict message appears);
    - both create a bill (different numbers);
    - go offline in DevTools → the banner, and view and print a bill.
  - If the Docker engine and Compose are available, `docker compose up --build` and the same smoke test. Otherwise, ledger a ruling and leave the Docker check to the owner in the checklist.
- [ ] **Step 3: Commit** `docs: server setup, Docker and checklist`

---

## Self-review notes

- **Spec coverage:**
  - §2 architecture: Tasks 1, 2 and 6;
  - §2 versions, numbering and business rules: Task 4;
  - §3 accounts and security: Task 3, with the UI in Task 7;
  - §3 record authorship and prepared-by: Tasks 4 and 7;
  - §4 Drive: Task 8;
  - §5 offline: Tasks 6 and 7;
  - §6 backups: Task 5;
  - §7 errors: Tasks 6 and 7;
  - §8 deployment docs: Task 9;
  - §9 tests: every task, with the manual part in Task 9.
- **Types:**
  - `Store` is defined in Task 1 and implemented in Tasks 1, 2 and 6;
  - the error classes are defined in Task 6 and used in Task 7;
  - the `DriveStatus` target shapes match `src/drive/service.ts`.
