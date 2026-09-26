# Contracts, Addenda and Bill Auto-fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contract and addendum register whose instalments or periods show up as "To bill" items and fill in payment bills automatically, with each bill linked to and printing its contract.

**Architecture:**
- Addenda are `Contract` records (`kind: 'addendum'`) in a new IndexedDB store `contracts` (DB v2).
- All contract maths is pure code in `src/domain/contract*.ts`:
  - `contractPlan`: amounts, periods, validation;
  - `contractTerms`: items, states, superseding, due, totals;
  - `contractFill`: bill auto-fill, the reference line.
- Screens call storage and these pure modules. Bills gain an optional `contractRef` with copied numbers and dates.

**Tech Stack:** existing Vite + Preact + TypeScript + `idb` + Vitest (+ fake-indexeddb, @testing-library/preact). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-contracts-design.md` — read §3–§7 before starting.

## Global Constraints

- **Contract number:** `{n}/{YYYY}/{contractType}[-{contractSuffix}]`, e.g. `12/2026/HĐDV-SM`.
  - Counter meta key `contract-counter-YYYY` (year of `signedDate`), separate from bill counters.
  - Empty suffix → no `-`. Settings defaults: `contractType: 'HĐDV'`, `contractSuffix: ''`.
- **Addendum number:** `PL` + 2 digits within its parent (`PL01`…). Every number is editable; duplicates warn, never block.
- **Statuses:** `draft | active | completed | terminated`. Only `active` records are billable, and only they appear in To bill.
- **Instalment percent amounts:** `round(valueBeforeVat × percent / 100)`. The **last** instalment takes the rounding difference so the total equals `valueBeforeVat` exactly.
- **Period keys:** `YYYY-MM` (a quarter uses its first month).
  - Labels: `Kỳ tháng MM/YYYY / Period MM/YYYY`, quarter `Quý Q/YYYY / Quarter Q/YYYY`.
- **Reference line on bills:**
  - `Căn cứ Hợp đồng số {number} ký ngày {dd/mm/yyyy} / Under Contract No. {number} dated {dd/mm/yyyy}`;
  - for an addendum, appended: ` và Phụ lục số {nn} ký ngày {dd/mm/yyyy} / and Addendum No. {nn} dated {dd/mm/yyyy}` (`{nn}` = the digits of `PLnn`).
- **Draft bills count as billed.** Cancelled bills do not, so their item becomes billable again.
- **Banner** when any due item's due date ≤ today − 3 days.
- **No schema change:** the backup `schemaVersion` stays `1`; a missing `contracts` list is `[]`. Old bills without `contractRef` work exactly as before.
- **UI:** English with bilingual labels only on printed bills. Existing tests must keep passing, and `npm run build` must stay clean.

## Review Focus

1. **Percent instalments that don't divide evenly** (e.g. 33.33 / 33.33 / 33.34 % of 10.000.001 ₫) must add up to the value before VAT exactly, to the đồng. Pinned in Task 2 (`rounding difference goes to the last instalment`).
2. **A contract starting mid-period** (start 15/10/2026, monthly): the first period must not be "due" before the contract starts. Its due date is the later of the period start and the contract start. Pinned in Task 3 (`first period is due from the contract start`).
3. **A "changes terms" addendum dated after an item that is already billed** must never supersede that item, even when its due date is after the effective date. Pinned in Task 3 (`billed items are never superseded`).
4. **The app already open in another tab while the new version upgrades the database** must not hang silently on "Loading". The user is told to close the other tab, and older tabs close their connection when a newer version needs it. Pinned in Task 5 (`reports when another tab blocks the upgrade`).
5. **Editing a contract's number or signing date after bills were made** must not change those bills' printed reference line; it prints from the copies in `contractRef`. Pinned in Task 4 (`reference line uses the bill's copies`).

---

## File Structure

```
src/domain/types.ts            + Contract, Plan, Instalment, ContractRef, settings fields
src/domain/contractPlan.ts     values, instalmentAmounts, periodKeys, periodLabel, planErrors, nextAddendumNumber, isDuplicateNumber
src/domain/contractTerms.ts    planItems, contractItems (states), applicableTerms, dueItems, needsBillingReminder, contractSummary
src/domain/contractFill.ts     contractRefFor, fillFromContract, referenceLine
src/storage/db.ts              DB v2 (contracts store), contract CRUD, customer-in-use rule, onBlocked
src/storage/contractNumbering.ts allocateContractNumber
src/storage/backup.ts          contracts in export/parse/restore, contract counters
src/router.ts, src/app.tsx     routes + Contracts menu
src/screens/Contracts.tsx      list
src/screens/ContractEditor.tsx editor (contract + addendum)
src/screens/ContractView.tsx   contract page
src/screens/Editor.tsx         Bill options → Contract picker, auto-fill, contractRef
src/screens/BillView.tsx       contract link
src/screens/Home.tsx           To bill box + banner
src/ui/BillPage.tsx            reference line
tests/domain/contract*.test.ts, tests/storage/contracts.test.ts, tests/ui/contracts-ui.test.tsx, tests/contractFixtures.ts
```

---

### Task 1: Contract types and settings

**Files:** Modify `src/domain/types.ts`, `src/domain/settings.ts` (only if defaults need normalizing); Test `tests/domain/settings.test.ts`; Create `tests/contractFixtures.ts`

**Interfaces:**
- Produces, in `types.ts` exactly as spec §4.1 and §4.2:
  - `ContractStatus`, `ContractKind = 'contract' | 'addendum'`, `AddendumEffect = 'addsWork' | 'changesTerms'`
  - `Instalment` — spec §4.1 plus `readyOn: string | null` (date Mark ready was clicked); `InstalmentShare = { percent: number } | { amount: number }`, `InstalmentDue = { on: 'signing' } | { on: 'acceptance' } | { on: 'date'; date: string }`
  - `PeriodicPlan = { type: 'periodic'; every: 'month' | 'quarter'; amount: number; first: string; last: string }`, `Plan`, `Contract`, `ContractRef`
  - `Bill.contractRef?: ContractRef`
  - `Settings.contractType: string`, `Settings.contractSuffix: string`, with defaults `'HĐDV'` and `''`
- `tests/contractFixtures.ts`: `sampleContract(over?: Partial<Contract>): Contract`, an active contract with:
  - id `k1`, number `12/2026/HĐDV-SM`, signed `2026-09-15`, start `2026-09-15`, end `2027-09-14`;
  - customer snapshot from `sampleBill().customer`, customerId `c1`;
  - lines `[Website 1 × 20.000.000]`, VAT 8;
  - plan instalments `[{id:'i1', name:'Đợt 1 – Tạm ứng', share:{percent:50}, due:{on:'signing'}, ready:false, readyOn:null}, {id:'i2', name:'Đợt 2 – Nghiệm thu', share:{percent:50}, due:{on:'acceptance'}, ready:false, readyOn:null}]`;
  - paymentTerms `''`, paymentDays 10, business null.
- `sampleAddendum(over?)`: kind `addendum`, parentId `k1`, number `PL01`, effect `addsWork`, perUse plan, signed `2026-10-01`.

- [ ] **Step 1: Failing test** — `normalizeSettings({})` has `contractType === 'HĐDV'` and `contractSuffix === ''`. Also, `tests/contractFixtures.ts` compiles: `npx tsc --noEmit`.
- [ ] **Step 2: Run** `npx vitest run tests/domain/settings.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the types and defaults. Also add `contractType`/`contractSuffix` string checks to `validSettings` in `backup.ts`, the same pattern as `googleClientId`.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: contract types and settings`

---

### Task 2: Plan maths and validation (`contractPlan.ts`)

**Files:** Create `src/domain/contractPlan.ts`; Test `tests/domain/contractPlan.test.ts`

**Interfaces:**
- Consumes: `computeTotals` (money.ts), types (Task 1)
- Produces:
  - `valueBeforeVat(c: Pick<Contract, 'lines'>): number`, `contractValue(c: Pick<Contract, 'lines' | 'vatRate'>): number`
  - `instalmentAmounts(items: Instalment[], base: number): number[]`
  - `periodKeys(p: PeriodicPlan): string[]`, `periodLabel(key: string, every: 'month' | 'quarter'): { vi: string; en: string }`
  - `planErrors(c: Contract, parent?: Contract | null): string[]`
  - `nextAddendumNumber(siblings: Pick<Contract, 'number'>[]): string`
  - `isDuplicateNumber(all: Pick<Contract, 'id' | 'number'>[], number: string, selfId: string | null): boolean`

- [ ] **Step 1: Failing tests**
  - `values`: the sample contract → `valueBeforeVat` 20.000.000 and `contractValue` 21.600.000.
  - `percent instalments`: 50/50 of 20.000.000 → `[10000000, 10000000]`.
  - `rounding difference goes to the last instalment`: percents `[33.33, 33.33, 33.34]` of `10000001` → `[3333000, 3333000, 3334001]`, sum `10000001`.
  - `amount and mixed shares`: `[{amount:5000000},{percent:75}]` of 20.000.000 → `[5000000, 15000000]`.
  - `monthly periods`: first `2026-10`, last `2027-01` → `['2026-10','2026-11','2026-12','2027-01']`. Quarterly `2026-10`..`2027-06` → `['2026-10','2027-01','2027-04']`.
  - `period labels`: `('2026-10','month')` → `{ vi: 'Kỳ tháng 10/2026', en: 'Period 10/2026' }`; `('2026-10','quarter')` → `{ vi: 'Quý 4/2026', en: 'Quarter 4/2026' }`.
  - `planErrors`:
    - percents 50+40 → contains `Instalments add up to 90%, not 100%`;
    - amounts total 19.000.000 of 20.000.000 → contains `Instalments add up to 19.000.000 ₫, not 20.000.000 ₫`;
    - periodic first > last → `The first period is after the last one`;
    - start > end → `The end date is before the start date`;
    - an addendum `changesTerms` effective date outside the parent → `planErrors(c, parent)` returns `The effective date is outside the contract's dates`.
  - `addendum numbers`: `[]` → `PL01`; `[PL01, PL02]` → `PL03`; `[PL01, 'custom']` → `PL02`.
  - `duplicate numbers`: detects the same number on another id, not on `selfId`, and matches case- and space-insensitively (`' 12/2026/hđdv-sm '` duplicates `12/2026/HĐDV-SM`).
- [ ] **Step 2: Run** `npx vitest run tests/domain/contractPlan.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Money in the messages uses `formatVnd`. Percent sums are compared with a tolerance of 0.001.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: contract plan maths and validation`

---

### Task 3: Items, states, terms, due and totals (`contractTerms.ts`)

**Files:** Create `src/domain/contractTerms.ts`; Test `tests/domain/contractTerms.test.ts`

**Interfaces:**
- Consumes: Task 2; `Bill`, `Contract`
- Produces:
  - `interface PlanItem { key: string; sourceId: string; label: { vi: string; en: string }; amount: number; dueDate: string | null }`
    - `key` = instalment id, or the period key;
    - `amount` is before VAT;
    - `dueDate` is `null` for acceptance instalments that aren't ready.
  - `planItems(c: Contract): PlanItem[]`
    - an instalment label is `{ vi: name, en: '' }`;
    - an `on: acceptance` instalment is due from `readyOn` when `ready`, else its due date is `null` (waiting);
    - a period's due date = `max(period start, c.startDate)`.
  - `type ItemState = 'waiting' | 'notDue' | 'due' | 'billed' | 'paid' | 'superseded'`
  - `interface ItemRow extends PlanItem { state: ItemState; billId: string | null; billNumber: string | null }`
  - `applicableTerms(contract: Contract, addenda: Contract[], date: string): Contract` — the latest active `changesTerms` addendum with `effectiveDate ≤ date`, else the contract.
  - `contractItems(contract: Contract, addenda: Contract[], bills: Bill[], today: string): ItemRow[]`
    - the contract's items plus each active `addsWork` addendum's items plus each active `changesTerms` addendum's items;
    - a contract item whose due date is ≥ some changesTerms `effectiveDate` and is not billed → `superseded`;
    - a changesTerms addendum's items with a due date before its effective date are dropped.
  - `dueItems(contracts: Contract[], bills: Bill[], today: string): (ItemRow & { contract: Contract })[]` — for each active top-level contract, the rows in state `due`, sorted by due date.
  - `needsBillingReminder(due: { dueDate: string | null }[], today: string): boolean`
  - `contractSummary(contract: Contract, addenda: Contract[], bills: Bill[]): { value: number; totalValue: number; billed: number; paid: number; left: number }`
  - `linkedBills(contract: Contract, addenda: Contract[], bills: Bill[]): Bill[]` — bills whose `contractRef.contractId` is the contract or one of its addenda.

- [ ] **Step 1: Failing tests** (fixtures from Task 1; bills built with `sampleBill({ contractRef: {...} })`)
  - `instalment states`:
    - today `2026-09-20`: i1 `due`, i2 `waiting`;
    - with i2 `ready: true` → `due`;
    - a draft bill on i1 → `billed` with its number;
    - a paid bill → `paid`;
    - a cancelled bill → `due` again.
  - `dated instalment is notDue before its date`.
  - `first period is due from the contract start`: start `2026-10-15`, monthly `2026-10`..`2026-12` → the first item's `dueDate` is `2026-10-15`; others `2026-11-01`, `2026-12-01`.
  - `changes terms from an effective date`:
    - contract monthly `2026-10`..`2027-03` at 1.000.000;
    - a changesTerms addendum effective `2027-01-01`, monthly `2027-01`..`2027-06` at 1.200.000;
    - the contract's `2027-01..03` are `superseded`, and the addendum supplies `2027-01..06`;
    - `applicableTerms(..., '2027-02-01')` is the addendum; on `2026-12-01` it's the contract.
  - `billed items are never superseded`: a bill on the contract's `2027-01` before the addendum → that row is `billed`, not superseded.
  - `adds-work addenda add items; draft or terminated contracts give no due items`.
  - `due items across contracts, sorted`; `reminder after 3 days`: due `2026-09-15`, today `2026-09-18` → false; `2026-09-19` → true.
  - `summary`:
    - contract 21.600.000 plus an adds-work addendum of 5.400.000 → totalValue 27.000.000;
    - bills: a sent 10.800.000 and a paid 10.800.000, plus a cancelled one → billed 21.600.000, paid 10.800.000, left 16.200.000;
    - left is never negative.
- [ ] **Step 2: Run** `npx vitest run tests/domain/contractTerms.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - A bill is "live" when `status !== 'cancelled'`; `paid` when `status === 'paid'`.
  - Bill totals use `computeTotals(bill.lines, bill.vatRate).total`.
  - Item state with a live bill: `paid` if paid, else `billed`; otherwise `superseded` / `waiting` / `notDue` / `due` by date.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: contract items, states, terms, due list and totals`

---

### Task 4: Bill auto-fill and reference line

**Files:** Create `src/domain/contractFill.ts`; Modify `src/ui/BillPage.tsx`, `src/domain/draft.ts` (duplicate drops `itemKey`); Test `tests/domain/contractFill.test.ts`, `tests/ui/BillPage.test.tsx`, `tests/domain/draft.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3; `DraftBill`, `addDays`, `formatDateVn`
- Produces:
  - `contractRefFor(record: Contract, parent: Contract | null, itemKey: string | null): ContractRef` — copies numbers and dates. For an addendum, `number`/`signedDate` are the addendum's and `parentNumber`/`parentSignedDate` the parent's.
  - `fillFromContract(d: DraftBill, terms: Contract, ctx: { record: Contract; parent: Contract | null; item: PlanItem | null }): DraftBill`
    - `terms` is the record whose lines, VAT and payment days apply (the caller uses `applicableTerms` or the item's source).
    - It sets `customerId`, `customer` (from `ctx.record` or the parent's snapshot), `vatRate`, `dueDate = addDays(d.billDate, terms.paymentDays)`, `lines`, and `contractRef` (spec §5.4).
  - `referenceLine(ref: ContractRef): { vi: string; en: string }`
  - `DraftBill` now carries `contractRef?: ContractRef`, via `draftFromBill`/`cleanDraft`; `duplicateAsDraft` sets `itemKey: null`.

- [ ] **Step 1: Failing tests**
  - `instalment fill`: sample contract, item i1 →
    - one line `{ nameVi: 'Đợt 1 – Tạm ứng – 50% giá trị hợp đồng', nameEn: '', qty: 1, unitPrice: 10000000, details: ['Website'] }`;
    - `vatRate` 8; `dueDate` = billDate + 10; `contractRef.itemKey` `i1`;
    - an amount-share instalment's name has no `%`.
  - `period fill`:
    - monthly plan amount equal to the line totals → the contract's lines, each with an extra detail `Kỳ tháng 10/2026 / Period 10/2026`;
    - a plan amount different from the line totals → a single line with that amount, named after the contract title, with the same detail.
  - `per use and Other`: the contract's lines with qty 1.
  - `addendum`: `contractRefFor(addendum, parent, null)` has number `PL01`, parentNumber `12/2026/HĐDV-SM`.
  - `reference line`:
    - contract → vi `Căn cứ Hợp đồng số 12/2026/HĐDV-SM ký ngày 15/09/2026`, en `Under Contract No. 12/2026/HĐDV-SM dated 15/09/2026`;
    - addendum → vi `Căn cứ Hợp đồng số 12/2026/HĐDV-SM ký ngày 15/09/2026 và Phụ lục số 01 ký ngày 01/10/2026`, en `… and Addendum No. 01 dated 01/10/2026`.
  - `reference line uses the bill's copies` (BillPage test): a bill with `contractRef.number '5/2026/HĐDV'` prints `Căn cứ Hợp đồng số 5/2026/HĐDV`, whatever contracts exist. A bill without `contractRef` prints no reference line (no element `.bill-ref`).
  - `duplicate keeps the contract but not the item` (draft test).
- [ ] **Step 2: Run** `npx vitest run tests/domain/contractFill.test.ts tests/ui/BillPage.test.tsx tests/domain/draft.test.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The BillPage prints `<div class="bill-ref">{vi} <En>/ {en}</En></div>` as the last line of `.bill-to`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: fill bills from contracts and print the contract reference`

---

### Task 5: Storage — DB v2, contracts, numbering

**Files:** Modify `src/storage/db.ts`, `src/main.tsx`; Create `src/storage/contractNumbering.ts`; Test `tests/storage/contracts.test.ts`

**Interfaces:**
- Produces:
  - `AppSchema.contracts: { key: string; value: Contract; indexes: { byCustomer: string; byParent: string } }`
  - `openAppDb(name?: string, opts?: { onBlocked?: () => void }): Promise<AppDb>`
    - version **2**;
    - the upgrade creates the v1 stores when `oldVersion < 1` and `contracts` when `oldVersion < 2`;
    - `blocking` closes this connection and calls `location.reload()` (skip the reload when `location` is unavailable);
    - `blocked` calls `opts.onBlocked`.
  - `listContracts(db)`, `getContract(db, id)`, `putContract(db, c)`
  - `deleteContract(db, id): Promise<'deleted' | 'refused'>` — refused when there are addenda (`byParent`) or bills linked (`contractRef.contractId`).
  - `deleteOrArchiveCustomer` also archives when any contract has `customerId`.
  - `allocateContractNumber(db: AppDb, s: Settings, signedDate: string): Promise<string>` — `contract-counter-YYYY`.
  - In `main.tsx`: pass `onBlocked` to render a message: `Please close other tabs of this app to finish updating, then reload.`

- [ ] **Step 1: Failing tests** (fake-indexeddb)
  - `upgrade from version 1 keeps existing data`:
    - create a v1 database with raw `idb.openDB(name, 1, …v1 stores…)`, add a bill, customer and settings, then close;
    - `openAppDb(name)` → the data is still there and `listContracts` returns `[]`.
  - `contracts CRUD and delete rules`: delete a draft with nothing linked → `deleted`; with an addendum or a linked bill → `refused`.
  - `customer used by a contract is archived`.
  - `contract numbers`:
    - settings `{contractType:'HĐDV', contractSuffix:'SM'}` → `1/2026/HĐDV-SM`, then `2/2026/HĐDV-SM`;
    - signed in 2027 → `1/2027/HĐDV-SM`;
    - suffix `''` → `1/2026/HĐDV`;
    - bill counters unaffected: `allocateBillNumber` still gives `TT-2026-0001`.
  - `reports when another tab blocks the upgrade`: keep a raw v1 connection open, and `openAppDb(name, { onBlocked })` calls `onBlocked`. Close the old connection in the test afterwards so the promise resolves.
- [ ] **Step 2: Run** `npx vitest run tests/storage/contracts.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces.
- [ ] **Step 4: Run** `npm test` — Expected: PASS, with all existing storage tests still green.
- [ ] **Step 5: Commit** `feat: contracts store (DB v2), contract numbering and delete rules`

---

### Task 6: Backup with contracts

**Files:** Modify `src/storage/backup.ts`; Test `tests/storage/backup.test.ts`

**Interfaces:**
- Produces: `BackupData.contracts: Contract[]`. `exportAll` includes contracts and `contract-counter-*` counters. `parseBackup` treats a missing `contracts` as `[]`, validates contracts and bills' `contractRef`, and counts contracts in the summary. `restoreAll` clears and writes contracts.

- [ ] **Step 1: Failing tests**
  - `round trip with contracts and contract counters`: after restore, `listContracts` equals the source, and the next contract number continues.
  - `old backup without contracts restores`, and the summary includes `0 contracts`. The summary format becomes `{n} bills, {n} customers, {n} services, {n} contracts`; update the existing summary assertion to match.
  - `rejects damaged contracts`: bad status, missing plan, a plan type `weird`, an instalment without an id or with `readyOn: 5`, a contract line with qty 0, an addendum without a parentId.
  - `rejects a damaged contractRef on a bill` (e.g. `contractRef: { contractId: 5 }`).
  - `counter keys`: both `counter-2026` and `contract-counter-2026` are accepted; `contract-counter-abc` is rejected.
- [ ] **Step 2: Run** `npx vitest run tests/storage/backup.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Validation reuses the bill-line and snapshot checks already in `backup.ts`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: contracts in backup and restore`

---

### Task 7: Routes, menu, contracts list and editor

**Files:** Modify `src/router.ts`, `src/app.tsx`; Create `src/screens/Contracts.tsx`, `src/screens/ContractEditor.tsx`; Test `tests/router.test.ts`, `tests/ui/contracts-ui.test.tsx`

**Interfaces:**
- Produces:
  - Routes:
    - `{ name: 'contracts' }` → `#/contracts`
    - `{ name: 'newContract' }` → `#/contracts/new`
    - `{ name: 'contract'; id }` → `#/contracts/<id>`
    - `{ name: 'editContract'; id }` → `#/contracts/<id>/edit`
    - `{ name: 'newAddendum'; parentId }` → `#/contracts/<id>/addendum`
    - `{ name: 'newBillFromContract'; contractId: string; itemKey: string | null }` → `#/bills/new/contract/<id>[/<itemKey>]`
  - Menu item **Contracts** between Bills and Customers; it matches all contract routes.
  - `ContractEditor({ mode: { kind: 'new' } | { kind: 'edit'; id } | { kind: 'addendum'; parentId } })`

- [ ] **Step 1: Failing tests**
  - The router round-trips each new route, including `itemKey` null vs `2026-10`.
  - **UI** (render `<App>` as in `tests/ui/drive-ui.test.tsx`):
    - `new contract suggests the next number`: `1/2026/HĐDV` with default settings and signing date 2026.
    - `Save & activate blocks unbalanced instalments`: 50% + 40% → message `Instalments add up to 90%, not 100%`; nothing active is saved; **Save draft** still saves.
    - `activating copies customer and business details`: the saved contract has `status 'active'` and `business.businessName` from settings.
    - `duplicate number warns but saves`: an existing contract with the typed number → warning `Another contract already uses this number` shown, and the save still succeeds.
    - `addendum editor`: from `#/contracts/k1/addendum`, the number is `PL01`, the parent is shown, and the effect choice exists; `changesTerms` requires an effective date.
    - `contracts list`: shows number, customer, title, status, value and billed/paid; the status filter narrows the list.
- [ ] **Step 2: Run** `npx vitest run tests/router.test.ts tests/ui/contracts-ui.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The editor reuses the bill editor's line-editing pattern (VI/EN name, unit, qty, price, details textarea).
  - Plan UI: a method select, then an instalment rows editor (name, % or ₫ toggle, due select with a date input) or period fields (every, amount, first/last month inputs defaulting from the start/end dates).
  - New numbers come from `allocateContractNumber`, only when the number field is left as suggested at first save. Addendum numbers come from `nextAddendumNumber`.
  - Editing an active contract's plan asks for confirmation: `This contract is active. Consider an addendum instead. Change the plan anyway?`
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: PASS, clean build.
- [ ] **Step 5: Commit** `feat: contracts list and editor`

---

### Task 8: Contract page

**Files:** Create `src/screens/ContractView.tsx`; Test `tests/ui/contracts-ui.test.tsx`

**Interfaces:**
- Consumes: `contractItems`, `contractSummary`, `linkedBills` (Task 3), storage (Task 5), routes (Task 7)

- [ ] **Step 1: Failing tests**
  - `summary`: value / billed / paid / left, formatted with dots (e.g. `21.600.000`).
  - `plan table states`:
    - a due item shows **Create bill**, linking to `#/bills/new/contract/k1/i1`;
    - a waiting acceptance instalment shows **Mark ready**; clicking it saves `ready: true, readyOn: today` and the row becomes due;
    - a billed row shows the bill number as a link.
  - `addenda and bills listed`, and **+ New addendum** navigates to `#/contracts/k1/addendum`.
  - `delete refused for a contract with bills`: the message is `This contract has bills or addenda. Terminate it instead.`; **Terminate** sets the status.
- [ ] **Step 2: Run** `npx vitest run tests/ui/contracts-ui.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** per spec §3.4. Superseded rows are greyed with the text `Replaced by PLnn`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: contract page with plan, bills and addenda`

---

### Task 9: Bill editor and bill view integration

**Files:** Modify `src/screens/Editor.tsx`, `src/screens/BillView.tsx`, `src/app.tsx` (the `newBillFromContract` route); Test `tests/ui/contracts-ui.test.tsx`

**Interfaces:**
- Consumes: `fillFromContract`, `contractRefFor`, `applicableTerms`, `contractItems` (Tasks 3–4); `EditorMode` gains `{ kind: 'fromContract'; contractId: string; itemKey: string | null }`.

- [ ] **Step 1: Failing tests**
  - `create bill from a contract item`: `#/bills/new/contract/k1/i1` opens the editor with customer `Công ty CP Hoa Sen Xanh`, one line `Đợt 1 – Tạm ứng – 50% giá trị hợp đồng`, and total `10.800.000`. Saving stores `contractRef` with `itemKey 'i1'`, number `12/2026/HĐDV-SM` and signedDate `2026-09-15`.
  - `Bill options contract picker`: in a new bill, choosing contract k1 lists items `Đợt 1 – Tạm ứng` (due) and `Other (no specific item)`. `Đợt 2` (waiting) is listed as `Đợt 2 – Nghiệm thu (not ready)` and disabled.
  - `clearing the contract removes the link but keeps the lines`.
  - `already billed item is blocked on save`: two drafts for i1 → the second save shows `This contract item is already billed` and isn't saved.
  - `bill view shows the contract link`: `Contract 12/2026/HĐDV-SM` links to `#/contracts/k1`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/contracts-ui.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The picker is in `BillOptions`, listing only active contracts and addenda of the chosen customer, or all when no customer is picked yet.
  - Choosing an item runs `fillFromContract` with the item's source record as `terms`. "Other" uses `applicableTerms(contract, addenda, draft.billDate)`.
  - The save check lives in `saveDraftBill`: it loads bills and throws `Error('This contract item is already billed')` when another live bill has the same `contractId` + `itemKey`.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: link bills to contracts with auto-fill`

---

### Task 10: Home "To bill", banner, docs and manual check

**Files:** Modify `src/screens/Home.tsx`, `README.md`, `docs/manual-test-checklist.md`; Test `tests/ui/contracts-ui.test.tsx`

**Interfaces:**
- Consumes: `dueItems`, `needsBillingReminder` (Task 3)

- [ ] **Step 1: Failing tests**
  - `To bill box`: with a due item, Home shows `To bill` and a row `12/2026/HĐDV-SM · Công ty CP Hoa Sen Xanh · Đợt 1 – Tạm ứng · 10.000.000 · due since 15/09/2026` with **Create bill**. No due items → no box.
  - `reminder banner after 3 days`: text `1 contract item is waiting to be billed` (plural `N contract items are waiting to be billed`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Home loads contracts alongside bills. The box sits above the summary boxes; the banner sits below the backup banner.
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: PASS.
- [ ] **Step 5: Docs.**
  - README Features: a Contracts bullet.
  - Checklist: a **Contracts** section with spec §8's manual check, plus "open the app in two tabs, then update: the other tab reloads or you're asked to close it".
- [ ] **Step 6: Manual browser check** (dev server at 5173 or a test port):
  1. Create a contract with 2 instalments and an adds-work monthly addendum.
  2. Bill i1 from Home and cancel it; it returns to To bill.
  3. Mark i2 ready and bill it.
  4. Print a bill and check the reference line.

  Record the result in the ledger.
- [ ] **Step 7: Commit** `feat: To bill list and reminder; docs`

---

## Self-review notes

| Spec | Task |
|---|---|
| §3.1 menu | 7 |
| §3.2 list | 7 |
| §3.3 editor | 7 |
| §3.4 contract page | 8 |
| §3.5 bills | 4, 9 |
| §3.6 Home | 10 |
| §4 data | 1 |
| §5.1 numbers | 2, 5 |
| §5.2 values and validation | 2, 3 |
| §5.3 due and terms | 3 |
| §5.4 auto-fill and reference line | 4, 9 |
| §6 storage, backup, migration | 5, 6 |
| §7 errors | 5 (delete, customer), 7 (validation, active-edit warning), 9 (stale link), 3 (cancelled → billable), 4 (copies) |
| §8 testing | 2–10 |

Deviations from the spec, decided here:
- `Instalment.readyOn` is added so an acceptance instalment's due date is the day it was marked ready, not a date that moves when the contract is edited.
- A period's due date is `max(period start, contract start)` (Review Focus 2). The spec's "due from its first day" is read as "from when the contract actually covers it".
