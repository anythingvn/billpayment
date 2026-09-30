# Role permissions (5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce what Admin, Manager, Order Creator and Accountant may do, on the server for every request and in the app's screens.

**Architecture:**
- One shared table, `src/domain/permissions.ts` (`can`, `actionsFor`), is imported by the Fastify routes and the Preact screens.
- The server checks permissions in a `requireAllowed` preHandler, or inline for record saves and Drive uploads, whose required action depends on the body.
- The app hides the controls a role can't use, through `useCan()`.

**Tech Stack:** TypeScript, Fastify 5 + `node:sqlite`, Preact, Vitest (jsdom, fake-indexeddb, @testing-library/preact).

**Spec:** `docs/superpowers/specs/2026-09-27-role-permissions-design.md`

## Global Constraints

- Branch `feat/role-permissions` (from `feat/shared-server`). Never merge to `main` without an explicit request.
- Roles are `admin`, `manager`, `creator` and `accountant` (`src/storage/roles.ts`); the labels are unchanged.
- A refusal is **403 `{error:'forbidden'}`**, it changes nothing, and it is logged as activity `forbidden` with `{ action, kind?, id? }`.
- The app message for a 403 is exactly: `Your role doesn't allow this`.
- The page message for a screen opened without permission is exactly: `Your role can't open this page`.
- The Settings note without `settings.edit` is exactly: `Only an Admin can change settings`.
- The Activity label is `Refused: <action>`.
- Single-user mode (`auth === null`) behaves exactly as today: `useCan` always returns true.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run the tests with `npx vitest run <path>`. The whole suite is `npx vitest run`. Types are checked with `npx tsc -p . --noEmit`.

## Review Focus

1. **An Accountant marking a bill paid while sending a stale or edited body** (for example lines changed) must get 403, not a silent edit. Task 1 tests `actionsFor`, and Task 2 tests the route.
2. **The editor's "Finalize" creates a bill directly as `sent`, with a `business` snapshot.** For an Order Creator this must be allowed, since only `record.edit` + `bill.send` are needed. Tasks 1 and 2.
3. **Terminating a *draft* contract or addendum** (the Terminate button shows on any non-terminated contract) needs `contract.close`, so an Order Creator is refused. Tasks 1 and 4.
4. **The automatic Drive upload after an Accountant marks a bill paid** must not happen or fail noisily. Uploads only follow send and activate, and the Drive button is hidden without `drive.record`. Task 4.
5. **A forbidden save that is also invalid** must answer 403, not 422, so validation messages never leak. Task 2.

---

### Task 1: The permission table

**Files:**
- Create: `src/domain/permissions.ts`
- Test: `tests/domain/permissions.test.ts`

**Interfaces:**
- Consumes: `Role` from `src/storage/roles.ts`.
- Produces:
  - `type Action = 'record.edit' | 'bill.send' | 'bill.pay' | 'bill.cancel' | 'contract.activate' | 'contract.close' | 'record.remove' | 'drive.record' | 'reports.use' | 'settings.edit' | 'admin'`;
  - `ACTIONS: Action[]`;
  - `can(role: Role, action: Action): boolean`;
  - `type RecordKind = 'bills' | 'contracts' | 'customers' | 'services'`;
  - `actionsFor(kind: RecordKind, prev: object | undefined, next: object): Action[]`, deduplicated, in a stable order.

- [ ] **Step 1: Write the failing tests**

```ts
import { can, actionsFor, ACTIONS, type Action } from '../../src/domain/permissions';
import { ROLES } from '../../src/storage/roles';
import { sampleBill } from '../fixtures';
import { sampleContract } from '../contractFixtures';

const TABLE: Record<Action, string> = { // roles allowed: a=admin m=manager c=creator t=accountant
  'record.edit': 'amc', 'bill.send': 'amc', 'bill.pay': 'amt', 'bill.cancel': 'am', 'contract.activate': 'amc',
  'contract.close': 'am', 'record.remove': 'am', 'drive.record': 'amc', 'reports.use': 'amt', 'settings.edit': 'a', admin: 'a',
};
const letter = { admin: 'a', manager: 'm', creator: 'c', accountant: 't' } as const;

it('can() matches the spec table for every action × role', () => {
  expect(ACTIONS.sort()).toEqual(Object.keys(TABLE).sort());
  for (const a of ACTIONS) for (const r of ROLES) expect(can(r, a), `${r} ${a}`).toBe(TABLE[a].includes(letter[r]));
});
```

Add these `actionsFor` cases, each as its own `it`, using `sampleBill` and `sampleContract` (and `{ id, name, archived }` for customers):

| Case | Expected |
|---|---|
| new draft bill | `['record.edit']` |
| new bill with `status: 'sent'` and a `business` snapshot | `['record.edit', 'bill.send']` |
| draft → sent, adding `business` and `updatedAt` | `['bill.send']` |
| sent → paid, with `paidDate` set | `['bill.pay']` |
| paid → sent, with `paidDate` cleared | `['bill.pay']` |
| sent → cancelled | `['bill.cancel']` |
| draft → cancelled | `['bill.cancel']` |
| sent → paid with `lines[0].quantity` also changed | `['bill.pay', 'record.edit']` |
| a draft bill with only `notes` changed | `['record.edit']` |
| a body identical except `version`, `updatedBy`, `updatedAt`, `drive` | `[]` |
| new contract with status `active` | `['record.edit', 'contract.activate']` |
| contract draft → active | `['contract.activate']` |
| contract active → completed | `['contract.close']` |
| contract draft → terminated | `['contract.close']` |
| customer `archived` false → true | `['record.remove']` |
| customer `archived` true → false | `['record.remove']` |
| customer name changed | `['record.edit']` |

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/domain/permissions.test.ts`
Expected: FAIL: cannot resolve `../../src/domain/permissions`.

- [ ] **Step 3: Implement `src/domain/permissions.ts`**

- `can` reads a `Record<Action, Role[]>` built from the spec §2 table.
- `actionsFor` follows spec §2 "actionsFor":
  - these fields are ignored when comparing: `status`, `paidDate`, `archived`, `updatedAt`, `drive`, `driveDocx`, `version`, `createdBy`, `updatedBy`, `createdAt`, and `business` when the bill's status goes from draft to sent;
  - compare the remaining fields as JSON with the keys sorted, the same way as `same()` in `server/src/validate.ts`;
  - a new bill with status `sent` also needs `bill.send`, and a new contract with status `active` also needs `contract.activate`;
  - an unknown status transition adds no action, because validation rejects it.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/domain/permissions.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/permissions.ts tests/domain/permissions.test.ts
git commit -m "feat: role permission table"
```

---

### Task 2: Server enforcement

**Files:**
- Modify:
  - `server/src/routes/auth.ts` (add `requireAllowed`; `requireAdmin` delegates to it);
  - `server/src/routes/records.ts`;
  - `server/src/routes/drive.ts`;
  - `server/src/activity.ts` (add `'forbidden'` to the activity `Action` union).
- Test: `server/tests/permissions.test.ts`

**Interfaces:**
- Consumes: `can`, `actionsFor`, `Action` from Task 1. The activity `Action` type in `server/src/activity.ts` is a different type; import the permission one as `PermAction`.
- Produces:
  - `requireAllowed(ctx: Ctx, action: PermAction): preHandler`;
  - `forbid(ctx: Ctx, req: FastifyRequest, reply: FastifyReply, action: PermAction, detail?: { kind?: string; id?: string }): FastifyReply`, which logs `forbidden` and sends 403 `{error:'forbidden'}`.

- [ ] **Step 1: Write the failing tests**

Use `withAdmin` and `addUser(s, name, role)` from `server/tests/helpers.ts`. Seed the data through the admin client:
- a customer;
- a draft bill, and a sent bill, using `sampleBill` with the customer's id and numbers from `POST /api/counters/counter-2026`;
- a draft contract (`sampleContract`).

Tests:
- `creator can save a draft, finalize a new sent bill, and take a number` (200 each).
- `creator is refused cancel, customer delete, archive, contract delete, contract terminate, settings, template put` (403 each). After the refusals, re-reading shows the records unchanged.
- `accountant marks a sent bill paid (200) and back to sent (200)`.
- `accountant marking paid while changing a line gets 403, and the bill is unchanged`.
- `accountant is refused a new draft bill, a counter, and a customer edit` (403).
- `manager cancels a bill, deletes a contract, archives a customer (200) but gets 403 on PUT /api/settings and PUT /api/templates/:id`.
- `a forbidden save that is also invalid answers 403, not 422`. Use the creator, cancelling a bill whose `lines` is `[]`.
- `meta: accountant may PUT report-drive:x and statement-drive:x; creator gets 403; lastBackupAt needs admin`.
- `drive upload: accountant with a report target passes the permission check; with a bill target gets 403; creator with a statement target gets 403`.
  - Use `extra.driveApi` as in `server/tests/drive.test.ts`.
  - Without a Drive connection, the permitted call returns 409 `conflict`. Assert "not 403".
- `each refusal is logged: GET /api/activity as admin shows action 'forbidden' with detail.action`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/tests/permissions.test.ts`
Expected: FAIL. The creator's cancel gets 200 where 403 is expected, and so on.

- [ ] **Step 3: Implement**

- **`auth.ts`:** add `requireAllowed`: it runs `requireUser`, then `if (!can(req.user!.role, action)) return forbid(...)`. `requireAdmin(ctx)` becomes `requireAllowed(ctx, 'admin')`.
- **`records.ts`:**
  - Settings PUT, and template PUT and DELETE: `requireAllowed(ctx, 'settings.edit')`.
  - Customer and contract DELETE: `requireAllowed(ctx, 'record.remove')`.
  - Counters POST: `requireAllowed(ctx, 'record.edit')`.
  - Meta PUT: after the key check, require `admin` for `lastBackupAt`, otherwise `reports.use`.
  - Record PUT, in this order:
    1. check that the id matches;
    2. load `prev` for **every** kind (add `store.getCustomer`/`getService`, or read from the list, whichever the `SqliteStore` already offers);
    3. refuse the first action in `actionsFor(kind, prev, body)` the role can't do, using `forbid(..., { kind, id })`;
    4. run `validateWrite`;
    5. then the existing code.
- **`drive.ts` upload:** after the target check, the needed action is `drive.record` for `bill`/`contract` and `reports.use` for `report`/`statement`. Call `forbid` when it's not allowed.

- [ ] **Step 4: Run them to verify they pass, along with the existing server tests**

Run: `npx vitest run server/tests`
Expected: PASS, including every existing file.

- [ ] **Step 5: Commit**

```bash
git add server/src server/tests/permissions.test.ts
git commit -m "feat: server enforces role permissions"
```

---

### Task 3: App plumbing — `useCan`, 403 message, navigation, page guards

**Files:**
- Create: `src/ui/useCan.ts`, `src/ui/NoAccess.tsx`
- Modify:
  - `src/storage/errors.ts` (the `ForbiddenError` message);
  - `src/app.tsx` (navigation, and guards in `Screen`);
  - `src/screens/Activity.tsx` (label for `forbidden`).
- Test: `tests/ui/roles-ui.test.tsx`

**Interfaces:**
- Consumes: `can`, `Action` from Task 1; `useApp()` (`user`, `auth`) from `src/app.tsx`.
- Produces:
  - `useCan(): (action: Action) => boolean`. It returns true for everything when `auth` is null.
  - `<NoAccess />`, which renders `<p class="muted">Your role can't open this page</p>`.

- [ ] **Step 1: Write the failing tests**

Add a `renderAs(role)` helper. It renders `<App db user={{...role}} auth={fakeAuth()} />` with the `fakeAuth` shape from `tests/ui/server-ui.test.tsx`; copy the helper, don't import it from another test.

Tests:
- `single-user mode shows Reports and all buttons` (render `App` with `auth` null).
- `accountant: nav has Reports and no Users/Activity`.
- `creator: nav has no Reports; #/reports shows "Your role can't open this page"; #/customers/<id>/statement too`.
- `accountant: #/bills/new shows "Your role can't open this page"`. Use the route hashes from `src/router.ts`: `newBill`, `editBill`, `duplicateBill`, `newBillFromContract`, `newContract`, `editContract`, `newAddendum`.
- `ForbiddenError message is "Your role doesn't allow this"`.
- `Activity shows "Refused: bill.cancel"` for the item `{ action: 'forbidden', detail: { action: 'bill.cancel' } }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ui/roles-ui.test.tsx`
Expected: FAIL. Reports is shown to the creator, and so on.

- [ ] **Step 3: Implement**

- **Navigation:** Reports only if `can('reports.use')`; `ADMIN_NAV` only if `can('admin')` and `auth` is set.
- **`Screen` guards:**
  - `reports` and `customerStatement` need `reports.use`;
  - the editor routes listed in Step 1 need `record.edit`;
  - `users` and `activity` need `admin`.
  - Otherwise `Screen` renders `<NoAccess />`.
- **Activity:** map `forbidden` to `Refused: ${detail.action}`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/ui/roles-ui.test.tsx tests/ui/server-ui.test.tsx tests/ui/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests/ui/roles-ui.test.tsx
git commit -m "feat: role-aware navigation, page guards and 403 message"
```

---

### Task 4: Buttons on the screens and read-only Settings

**Files:**
- Modify:
  - `src/screens/Home.tsx`, `src/screens/Contracts.tsx`;
  - `src/screens/BillView.tsx` (`ACTIONS` filter, Continue in editor, Duplicate, `DriveLine`);
  - `src/screens/ContractView.tsx` (Edit, Mark completed, Terminate, Delete, New addendum, the addendum actions, Drive save, Create bill);
  - `src/screens/ContractEditor.tsx` ("Save & activate" only with `contract.activate`);
  - `src/screens/Customers.tsx`, `src/screens/Services.tsx`;
  - `src/screens/Settings.tsx`, `src/screens/SettingsDocuments.tsx`.
- Test: `tests/ui/roles-ui.test.tsx` (extend it)

**Interfaces:**
- Consumes: `useCan()` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

| Test | Assertions |
|---|---|
| `creator on a sent bill` | "Mark as paid" and "Cancel bill" absent; "Duplicate" present |
| `creator on a draft bill` | "Mark as sent" and "Continue in editor" present; "Cancel bill" absent |
| `accountant on a sent bill` | "Mark as paid" present; "Duplicate", "Cancel bill", and the Drive save button ("Save to Google Drive") absent |
| `accountant on a paid bill` | the undo action (paid → sent, label "Mark as sent") present |
| `accountant on Home and Contracts` | no "+ New bill", no "+ New contract" |
| `creator on a draft contract` | "Edit" present; "Terminate", "Delete" and "Mark completed" absent |
| `creator in the contract editor` | "Save & activate" present |
| `accountant on Customers` | no "Add", "Edit", "Delete", "Archive" or "Unarchive"; "Statement" present |
| `creator on Customers` | "Edit" present; "Delete" and "Statement" absent |
| `manager on Settings` | the note "Only an Admin can change settings" is shown; the business-name input is disabled; no "Save" button is enabled |
| `admin on Settings` | no note; the inputs are enabled |

For the addendum Terminate/Delete links, assert them in the creator draft contract test by adding one draft addendum (`sampleAddendum`).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ui/roles-ui.test.tsx`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- **Bill actions:** wrap each control in `can(...)` using the spec §4 table. In `BillView`, filter `ACTIONS` by the needed action:
  - `sent` needs `bill.send` from a draft, and `bill.pay` from paid;
  - `paid` needs `bill.pay`;
  - `cancelled` needs `bill.cancel`.
- **Settings:** wrap the Settings content (including `SettingsDocuments`) in `<fieldset disabled={!can('settings.edit')}>`. Show the note above it when disabled. Drive connect stays admin-only, as today.

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run` and `npx tsc -p . --noEmit`
Expected: every test passes (existing count + new); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src tests/ui/roles-ui.test.tsx
git commit -m "feat: hide actions a role can't use; read-only Settings"
```

---

### Task 5: Docs

**Files:**
- Modify: `README.md` (a short "Roles" table in the server section); `docs/manual-test-checklist.md` (new section 12, "Roles").

- [ ] **Step 1:** Add to the README the permission table from spec §2 in plain words.
- [ ] **Step 2:** Add checklist section 12. Sign in as each role in two browsers and check:
  - the navigation;
  - the bill buttons (draft, sent, paid);
  - the contract buttons;
  - the customer buttons;
  - Settings read-only for the Manager;
  - Reports hidden for the Order Creator;
  - an Accountant saving a report to Drive;
  - the Activity log showing a "Refused" entry after a forced API call (`curl` with the session cookie).
- [ ] **Step 3: Verify**

Run: `npx vitest run` and `npm run build && npm run build:server`
Expected: all tests pass, and both builds succeed.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/manual-test-checklist.md
git commit -m "docs: roles in README and manual checklist"
```
