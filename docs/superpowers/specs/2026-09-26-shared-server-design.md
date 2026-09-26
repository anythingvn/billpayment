# Shared server (project 5a) — design

Part 1 of 2 of "user roles". This part moves the data to the owner's own server so several people share it. Project 5b adds the permission rules for the four roles on top.

Status: approved in conversation on 2026-09-26. The written spec is awaiting review.

## 1. Purpose and decisions

The owner wants four kinds of users (Admin, Manager, Order Creator, Accountant) working on the **same** bills, contracts and customers from their own computers and phones. Today the data lives in one browser, so it needs a shared server first.

| Topic | Decision |
|---|---|
| Where the data lives | On the owner's own server (Docker). Developed and run locally first; deployed later by the owner |
| Stack | Node + TypeScript server with SQLite, in the same repo, reusing `src/domain/` |
| The app | The same Preact app. The server serves it from the same address as the API |
| Offline | Online-first. Offline, the app shows the last loaded data **read-only** (view and print). Creating, editing, deleting, numbering and Drive need the server |
| Sign-in | Username + password. Accounts are created and managed by the Admin |
| Google Drive | One company Drive, connected once by the Admin on the server. The browser sends finished files to the server, which uploads them |
| Existing data | Imported once from a backup file of the current app on first run |
| Not in 5a | The permission rules per role (5b), and deployment to the owner's server (the owner does it later with a written guide) |

## 2. Architecture

```
Browser (app)                                  Server (one Docker container, port 8080)
 ├─ screens unchanged except where noted        ├─ GET /           the built app (dist/)
 ├─ src/storage/*: same function names,         ├─ /api/…          JSON API, session cookie
 │  now calling the API (ApiStore)              ├─ SQLite          /data/billpayment.db
 ├─ read-only cache (IndexedDB) for offline     ├─ nightly backup  /data/backups/ (14 kept)
 └─ makes PDF / Word / Excel as today           └─ Google Drive    company account, encrypted token
```

- **Repo layout:**
  - `server/` (Fastify + `better-sqlite3`), built to `server/dist`;
  - `src/domain/` is imported by the server unchanged;
  - `Dockerfile` (multi-stage: build app + server, run on `node:22-slim`);
  - `docker-compose.yml` (service `app`, volume `./data:/data`, port `8080`);
  - `.env.example`.
- **Configuration** (`.env`):
  - `SESSION_SECRET`;
  - `TOKEN_KEY` (32 bytes, base64, encrypts the Google token);
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`;
  - `PUBLIC_URL` (e.g. `http://localhost:8080`);
  - `DATA_DIR` (default `/data`).
  - The server refuses to start without `SESSION_SECRET` and `TOKEN_KEY`, with a clear message.
- **Data access in the app:**
  - All reads and writes go through a `Store` interface with today's operations: customers, services, bills, contracts, templates, settings, meta, numbering, delete rules, backup and restore.
  - `ApiStore` implements it over `/api`.
  - Code that used IndexedDB transactions directly moves to the server behind an API call: number allocation, the delete/archive rules, template default rules, Drive status recording and restore.
- **Records** are stored as JSON documents in SQLite. Each has:
  - `id`;
  - a few indexed columns (e.g. `customer_id`, `bill_date`, `kind`);
  - `version` (an integer);
  - `created_at`, `created_by`, `updated_at`, `updated_by`.
- **Edits:**
  - Every update sends the version it started from; a stale version gets `409` with "Someone else changed this — reload to see their changes".
  - The screen keeps the user's input and offers **Reload**.
- **Numbering:** bill numbers (`TT-YYYY-NNNN`) and contract numbers are allocated by the server inside one SQLite transaction. The existing never-reuse rule holds with simultaneous requests.
- **Business rules:** the rules already in `src/domain/` (totals, VAT, contract terms, status transitions, validation) run on the server too for every write. A write that breaks them is refused with the same messages the app shows.

## 3. Accounts and security

- **First run:** with no users in the database, every page shows **Set up**:
  - it creates the Admin (username, display name, password twice);
  - it can then **Import** a backup JSON from the current app. This uses the existing `parseBackup`, the same validation and the same "…bills, …customers…" summary, then a confirm.
  - Import is possible only while the database has no bills; after that it's a normal Admin **Restore**.
- **Users screen** (Admin only):
  - lists users with their role and status (active or disabled), last sign-in, and **Add user**, **Reset password**, **Disable** / **Enable**, and **Change role**;
  - roles are `admin`, `manager`, `creator` and `accountant`, stored now and enforced in 5b;
  - there is always at least one active `admin`: the last one can't be disabled or changed to another role;
  - a new user or a reset password must be changed at the next sign-in.
- **Passwords:** at least 10 characters. Stored as `scrypt(N=2^15, r=8, p=1)` with a 16-byte random salt, compared in constant time. Never logged or returned.
- **Sessions:**
  - a random 32-byte id, stored hashed in SQLite;
  - cookie `sid`, `HttpOnly`, `SameSite=Strict`, `Secure` when `PUBLIC_URL` is https, `Path=/`;
  - they last 30 days from the last use;
  - **Sign out** ends the session, and disabling a user or resetting their password ends all their sessions.
- **Lockout:** 5 failed sign-ins for a username within 15 minutes lock it for 15 minutes, with the same message whether or not the username exists. Each lock is logged.
- **CSRF:** every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must carry `X-Requested-With: billpayment` and a same-origin `Origin`; otherwise `403`.
- **Other protections:**
  - request bodies are limited to 20 MB (templates are at most 5 MB, so a backup with templates fits);
  - security headers on every response: `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- **Activity log** (Admin can view it, newest first, 200 per page), with:
  - sign-in, sign-out, failed sign-in and lock;
  - user create, change and disable;
  - every delete (bill, contract, customer, service, template);
  - import, restore, backup download;
  - Drive connect and disconnect.
- **Record authorship:** `created_by` and `updated_by` hold the user id, shown as names on bill and contract pages ("Created by An · changed by Lan 26/09 10:05").
- **Prepared by:** new bills default "Prepared by" (`nguoi_lap`) to the signed-in user's display name. It stays editable and is saved on the bill.

## 4. Google Drive (company account)

- In **Settings → Google Drive** (Admin only):
  - **Connect Google Drive** runs Google's web sign-in (scope `drive.file`) and redirects to `/api/drive/callback`;
  - the server stores the refresh token encrypted with AES-256-GCM using `TOKEN_KEY`, plus the account email;
  - **Disconnect** revokes the token and deletes it.
- **Uploads:** the browser builds the file as today (PDF, .docx, .xlsx) and `POST`s it to `/api/drive/upload` with its target (a bill, a contract, a report or a statement).
  - The server uploads through one queue, using today's `uploadFile` rules: folders, update the same file, folder cache.
  - It records the status where it's recorded today (on the record, or in meta for reports and statements) and returns it.
  - The existing status lines and messages stay.
- **Automatic uploads** (bill export, contract activation) work as today, and need the server to be online.
- The per-browser Google sign-in (the GIS token client) and the built-in client ID are removed from the app.

## 5. Offline viewing

- After each successful load, the app writes what it received to a local IndexedDB cache: bills, contracts, customers, services, templates, settings, and the report and statement statuses.
- When the server can't be reached (network error or timeout of 8 s), or the browser is offline, screens read from the cache. A banner shows "Offline — viewing only · last updated hh:mm".
  - Buttons that change data or talk to the server are disabled with a tooltip "Needs a connection".
  - Viewing, printing and PDF export (browser print) work, and so do Word and Excel downloads made in the browser.
- The cache is per signed-in user and is cleared on **Sign out**.
- The service worker keeps precaching the app as today, and API responses are never cached by it.

## 6. Backups

- **Nightly** at 02:00 server time:
  - SQLite's online backup to `/data/backups/billpayment-YYYY-MM-DD.db`, keeping the newest 14;
  - failures are logged.
- **Download backup** (Admin): today's JSON format (so it can be restored into the app), plus `users` (without password hashes) and the activity log. It never includes password hashes, sessions or the Google token.
- **Restore** (Admin):
  - it replaces all business data and keeps users, sessions and the Drive connection;
  - it needs the confirmation text "RESTORE" and writes an activity log entry.
- The deployment guide tells the owner to copy `/data` off the server regularly.

## 7. Errors

- **Server unreachable while saving:** "Can't reach the server — your change wasn't saved". The form keeps its input.
- **Session expired (`401`):** the app shows the sign-in screen, and after signing in returns to the same screen. Unsaved form input is kept in memory.
- **Version conflict (`409`):** the message from §2 plus **Reload**.
- **Validation (`422`):** the same messages the screens show today, from the shared `src/domain/` rules.
- **Server errors (`500`):** "Something went wrong on the server". The details are in the server log, never in the response.

## 8. Deployment (documented, not done in 5a)

- `docs/server-setup.md` covers:
  - creating the `.env`;
  - `docker compose up -d`;
  - Caddy (or the server's existing reverse proxy) for HTTPS on the owner's domain;
  - setting `PUBLIC_URL`;
  - adding the domain's redirect URI to the Google client;
  - copying `/data` off the server;
  - updating (`git pull && docker compose up -d --build`).
- GitHub Pages keeps publishing the current single-user app until the owner switches over. The README says which is which.

## 9. Testing

- **Server** (Vitest, a temporary SQLite file per test):
  - setup and first Admin;
  - sign-in, wrong password, lockout after 5, and the same message for an unknown user;
  - sessions: expiry, sign-out, disable ending sessions;
  - CSRF refusal;
  - the last-admin rule;
  - the users API;
  - records: create, read, update with version, `409` on a stale version;
  - `created_by`/`updated_by`;
  - server-side validation refusing a bad bill;
  - numbering with 20 simultaneous allocations giving 20 different numbers;
  - the delete/archive rules;
  - import of a real backup (counters, templates, report and statement statuses);
  - backup JSON excluding secrets;
  - restore keeping users;
  - Drive: connect storing an encrypted token (decrypts only with `TOKEN_KEY`), and upload with a fake Drive (create, then update the same file, status recorded);
  - the activity log entries.
- **App:**
  - the existing screen tests run against a fake `Store`;
  - new tests for sign-in, first-run setup, the Users screen, the offline banner and disabled buttons, the `409` conflict message, and the `401` redirect.
- **Manual:**
  - `docker compose up` on a clean checkout;
  - import a real backup;
  - two browsers signed in as two users edit the same customer (the conflict message appears);
  - both create a bill at the same time (different numbers);
  - go offline and view and print a bill;
  - connect a Google account locally and save a bill to Drive.
