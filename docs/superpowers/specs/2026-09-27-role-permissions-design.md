# Role permissions (project 5b) — design

Part 2 of 2 of "user roles". Project 5a (branch `feat/shared-server`) added the shared server, accounts and the four roles, but only Admin-only screens are restricted. This part enforces what each role may do.

Status: approved in conversation on 2026-09-27. The written spec is awaiting review.

## 1. Purpose and decisions

The owner's request:
- **Admin:** configuration.
- **Manager:** runs the software; can delete and edit basic information.
- **Order Creator:** no delete function.
- **Accountant:** view-only access to statistics.

Decisions from the conversation:

| Topic | Decision |
|---|---|
| Accountant and payments | May mark a bill paid, and undo it (paid → sent) |
| Order Creator and sending | May finish drafts and send the final bill. Sent bills stay locked for everyone, as today |
| Order Creator and reports | No Reports or Statements |
| Accountant's files | May print and download everything, and save reports and statements (not bills or contracts) to Google Drive |
| Manager and Settings | No. Business details, bank, VAT, footer and Word templates are Admin only |
| "No delete" | Includes archiving, cancelling a bill, deleting a draft, and completing or terminating a contract |
| Approach | One shared permission table in `src/domain`, used by the server and the app |
| Where rules are enforced | On the server for every request. The app hides what the role can't use |

Success means:
- each person sees only what their role allows;
- a direct API call can't get around the rules;
- nothing changes for the Admin, or for the single-user app on GitHub Pages.

## 2. The permission table

`src/domain/permissions.ts`:

```ts
export type Action =
  | 'record.edit' | 'bill.send' | 'bill.pay' | 'bill.cancel'
  | 'contract.activate' | 'contract.close' | 'record.remove'
  | 'drive.record' | 'reports.use' | 'settings.edit' | 'admin';
export function can(role: Role, action: Action): boolean;
export function actionsFor(kind: 'bills' | 'contracts' | 'customers' | 'services', prev: object | undefined, next: object): Action[];
```

| Action | Covers | Admin | Manager | Order Creator | Accountant |
|---|---|---|---|---|---|
| `record.edit` | Create or edit customers, services, and draft bills, contracts and addenda; take bill and contract numbers | ✓ | ✓ | ✓ | – |
| `bill.send` | Draft → sent | ✓ | ✓ | ✓ | – |
| `bill.pay` | Sent → paid, and paid → sent | ✓ | ✓ | – | ✓ |
| `bill.cancel` | Any bill → cancelled | ✓ | ✓ | – | – |
| `contract.activate` | Draft → active (contracts and addenda) | ✓ | ✓ | ✓ | – |
| `contract.close` | → completed or → terminated | ✓ | ✓ | – | – |
| `record.remove` | Delete, archive or unarchive customers, services, contracts and addenda | ✓ | ✓ | – | – |
| `drive.record` | Save a bill or contract to Google Drive, including the automatic upload on send or activate | ✓ | ✓ | ✓ | – |
| `reports.use` | Reports and Statements: open, download, save to Drive | ✓ | ✓ | – | ✓ |
| `settings.edit` | Settings (business details, bank, VAT, footer) and Word templates (upload, replace, remove, set default, starters) | ✓ | – | – | – |
| `admin` | Users, Activity, backup download, restore, import, Drive connect and disconnect | ✓ | – | – | – |

- Every role can view bills, contracts, customers, services and settings, and can print or download bills and contracts as PDF or Word.
- An Order Creator can't remove a wrong draft. They can edit it, and a Manager can cancel it (bill) or delete it (contract).

### `actionsFor(kind, prev, next)`

It returns every action a record save needs. The save is allowed only when the role can do all of them.

- **New record** (`prev` undefined): `record.edit`. For a bill created with status `sent`, also `bill.send`. For a contract created with status `active`, also `contract.activate`.
- **Status change:**
  - Bills:
    - draft → sent is `bill.send`;
    - sent → paid and paid → sent are `bill.pay`;
    - → cancelled is `bill.cancel`.
  - Contracts and addenda:
    - draft → active is `contract.activate`;
    - → completed and → terminated are `contract.close`.
- **`archived` changed:** `record.remove`.
- **Any other field changed:** `record.edit`.
  - These fields are ignored: `status`, `paidDate`, `archived`, `updatedAt`, `drive`, `driveDocx`, and the tracked fields (`version`, `createdBy`, `updatedBy`, `createdAt`).
  - For a bill going draft → sent, the `business` snapshot the app adds is part of sending, not an edit.
- **No change at all:** `[]`, which is allowed.

## 3. Server enforcement

- **`requireAllowed(ctx, action)`** runs after `requireUser`. It refuses with **403 `{error:'forbidden'}`** and changes nothing.
  - `requireAdmin` becomes `requireAllowed(ctx, 'admin')`.
- **Routes:**

  | Route | Needs |
  |---|---|
  | `PUT /api/settings` | `settings.edit` |
  | `PUT /api/templates/:id`, `DELETE /api/templates/:id` | `settings.edit` |
  | `DELETE /api/customers/:id`, `DELETE /api/contracts/:id` | `record.remove` |
  | `POST /api/counters/:key` | `record.edit` |
  | `PUT /api/meta/report-drive:*`, `PUT /api/meta/statement-drive:*` | `reports.use` |
  | `PUT /api/meta/lastBackupAt` | `admin` |
  | `POST /api/drive/upload` | `drive.record` for a bill or contract target; `reports.use` for a report or statement target |
  | `PUT /api/{bills,contracts,customers,services}/:id` | every action in `actionsFor(kind, stored, body)` |
  | Users, activity, backup, restore, import, Drive connect and disconnect | `admin` (unchanged) |

- **Order of checks on a record save:**
  1. the id must match;
  2. the permission check;
  3. validation;
  4. the version check.

  So a forbidden save never reveals validation messages.
- **Activity log:** each refusal is logged as `forbidden`, with the action and the record kind and id. The Activity screen shows it as "Refused: <action>".
- All reads stay open to every signed-in user.

## 4. The app

- **`useCan()`** in `src/ui/useCan.ts` returns `(action) => boolean`.
  - In server mode it uses the signed-in user's role.
  - In single-user mode it always returns true.
- A button the role can't use is **hidden**. The existing offline disabling (`useWrite`) is unchanged.
- **Navigation:**
  - Reports appears only with `reports.use`.
  - Users and Activity appear only with `admin`.
  - Settings is always shown.
- **Screens:**

  | Screen | Control | Needs |
  |---|---|---|
  | Home | New bill, and the new-contract actions | `record.edit` |
  | Bill | Mark as sent | `bill.send` |
  | Bill | Mark as paid, and undo | `bill.pay` |
  | Bill | Cancel bill | `bill.cancel` |
  | Bill | Continue in editor, Duplicate | `record.edit` |
  | Bill | Save to Google Drive | `drive.record` |
  | Editor | Finalize (save as sent) | `bill.send`; the Order Creator keeps it |
  | Contract | Edit, New addendum | `record.edit` |
  | Contract | Activate | `contract.activate` |
  | Contract | Mark completed, Terminate | `contract.close` |
  | Contract | Delete, delete an addendum | `record.remove` |
  | Contract | Save to Google Drive | `drive.record` |
  | Customers, Services | Add, Edit | `record.edit` |
  | Customers, Services | Delete, Archive, Unarchive | `record.remove` |
  | Customers | Statement | `reports.use` |
  | Settings | All fields and template actions | `settings.edit`; otherwise read-only, with the note "Only an Admin can change settings" |

- **Reports and Statement opened by address** without `reports.use` show "Your role can't open this page".
- **Editor opened by address** without `record.edit` shows the same message.
- **Automatic Drive uploads** on send or activate run only with `drive.record`. Every role that can send or activate already has it.

## 5. Errors

- A **403 `forbidden`** from a write becomes a `ForbiddenError` with the message "Your role doesn't allow this". It is reported the same way as other write errors, and the form keeps its input.
- **Role changed while signed in:** the server applies the new role immediately. The app picks it up from `/api/me` at the next page load. Until then, a hidden button may still be missing or an allowed-looking one may be refused with the message above.

## 6. Testing

Tests are written first.

- **`permissions.ts`:**
  - `can` for every action × role, compared against the table in §2;
  - `actionsFor` for:
    - new draft, new sent bill, new active contract;
    - each bill and contract status transition;
    - archive and unarchive;
    - a field edit;
    - no change;
    - draft → sent with the `business` snapshot (only `bill.send`);
    - a paid-marking save that also changes a line (`bill.pay` + `record.edit`).
- **Server:**
  - Each route in §3 refuses a disallowed role with 403, leaves the data unchanged and logs `forbidden`, and allows an allowed role.
  - In particular:
    - the Accountant marks paid, and can't also change a line;
    - the Order Creator sends a bill but can't cancel it, delete a contract, archive a customer or change Settings;
    - the Manager can't change Settings or templates;
    - the Accountant can save a report to Drive but not a bill.
- **App:**
  - `useCan` in both modes;
  - for each role: the buttons on Bill, Contract, Customers and Home, the navigation, Settings read-only, and the Reports "can't open" message;
  - the 403 message.
- **Manual:** sign in as each role in two browsers and walk through the table in §2.
