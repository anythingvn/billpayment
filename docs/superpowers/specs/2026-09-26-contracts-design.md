# Contracts, Addenda and Bill Auto-fill — Design Spec (Project 1 of 2)

Date: 2026-09-26 · Status: awaiting review
Builds on: `2026-09-25-payment-bill-app-design.md`
Follow-up: Project 2 — Word (.docx) documents for contracts, addenda and payment bills (separate spec).

## 1. Purpose and scope

The owner bills customers under service contracts (hợp đồng) and their addenda (phụ lục).
They want to:
- keep a register of contracts and addenda;
- link each payment bill to the contract or addendum it bills;
- have bills filled in automatically from the contract;
- see on Home what is due to be billed.

**Success**
- Creating a bill for a contract item takes one click from Home, and the bill is already filled in (customer, lines, VAT, due date, "Căn cứ Hợp đồng…" line).
- Each contract shows value, billed, paid and left.
- Nothing billable is forgotten: the "To bill" list and a reminder banner show it.

**In scope**
- Contracts and addenda (stored as one record type).
- Three billing methods: instalments, fixed amount per period, pay per use.
- Addenda that add work, and addenda that change terms from an effective date.
- Automatic, editable numbering.
- Bill link and auto-fill, the reference line on the bill.
- Contract totals, the Home "To bill" list and the reminder banner.
- Backups.

**Out of scope (this project)**
- Word documents (Project 2).
- Attaching scanned signed contracts.
- Email or other outside reminders.
- Automatic renewals.
- Multiple currencies.
- Contracts without a customer.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Billing methods | Per contract: instalments, fixed amount per period (monthly/quarterly), or pay per use |
| Addenda | Either **adds work** (own lines, value and plan; billed separately) or **changes terms** from an effective date (replaces lines, VAT, plan and payment terms for items due on or after that date) |
| Storage | Addenda are contract records with `kind: 'addendum'`, `parentId` and `effect` |
| Numbering | Automatic, editable. Contracts `{n}/{YYYY}/{type}-{suffix}` (e.g. `12/2026/HĐDV-SM`), per-year counter separate from bills. Addenda `PL01, PL02…` within their contract. Duplicate numbers give a warning, not a block |
| To bill | Home list of due items across active contracts, plus a banner when an item has been due more than 3 days |
| Bills without a contract | Work exactly as today |

## 3. Screens and flow

### 3.1 Menu
A new **Contracts** item between Bills and Customers.

### 3.2 Contracts list
- Columns: number, customer, title, signing date, status, value, billed, paid.
- Status filter and search (number, customer, title). Addenda are listed under their contract, not as rows.
- **+ New contract** at the top.

### 3.3 Contract editor
One page, with these sections top to bottom:

1. **Basics**
   - number (suggested, editable), customer (pick from saved), title, signing date, start date, end date, status.
   - For an addendum: parent contract (fixed), effect (Adds work / Changes terms), and effective date (for Changes terms).
2. **Services:** lines exactly like bill lines (name VI/EN, unit VI/EN, qty, unit price, detail lines), VAT rate, and the calculated **value** (lines + VAT).
3. **Billing:** choose one method.
   - **Instalments:** a list of `{ name, share: percent | amount, due: on signing | on acceptance | on date }`.
   - **Per period:** every month or every quarter; amount per period (before VAT); first and last period (default from the start/end dates).
   - **Pay per use:** no extra fields.
4. **Payment terms:** a free text line printed on documents in Project 2, and **payment days** (default: Settings' default payment days) used for bill due dates.

Save buttons: **Save draft** and **Save & activate**. Activating copies the customer and business details onto the contract.

### 3.4 Contract page
- Summary: **value, billed, paid, left**.
- **Billing plan table**, one row per item: name or period, amount, due date or condition, and state (not due, due, billed [bill number], paid, or superseded). A row that is due has **Create bill**. An "on acceptance" instalment that is not ready has **Mark ready**.
- **Bills** linked to the contract (number, date, total, status).
- **Addenda:** a list with number, effect, effective date and value; **+ New addendum** opens the editor as a phụ lục of this contract.
- Actions:
  - **Edit** (a draft, or an active contract with a warning suggesting an addendum);
  - **Mark completed**, **Terminate**;
  - **Delete**: only for a draft with no bills and no addenda.

### 3.5 Bills
- **Editor step 1 → Bill options:** a new optional **Contract** field. Picking an active contract (or addendum) lists its currently billable items (due or not yet due), plus "Other (no specific item)". Choosing an item fills in the bill (§5.3).
- Everything stays editable. Clearing the contract removes the link and the reference line; the lines already filled in remain.
- **Bill page:** under the customer block, prints the reference line (§5.4) when linked.
- **Bill view:** shows "Contract 12/2026/HĐDV-SM" as a link to the contract page.

### 3.6 Home
- A **To bill** box (shown only when there are due items). Each row shows contract number, customer, item, amount and "due since dd/mm/yyyy", with **Create bill**.
- A **banner** when any item has been due for more than 3 days: "N contract items are waiting to be billed", with a link to the box.

## 4. Data

### 4.1 Contract record (IndexedDB store `contracts`, keyPath `id`)
```
Contract {
  id: string
  kind: 'contract' | 'addendum'
  parentId: string | null            // addendum → its contract
  effect: 'addsWork' | 'changesTerms' | null   // addenda only
  effectiveDate: string | null       // changesTerms only (YYYY-MM-DD)
  number: string
  title: string
  status: 'draft' | 'active' | 'completed' | 'terminated'
  signedDate: string                 // YYYY-MM-DD
  startDate: string
  endDate: string | null
  customerId: string
  customer: CustomerSnapshot         // copied at activation (live copy while draft)
  business: BusinessSnapshot | null  // copied at activation
  lines: BillLine[]
  vatRate: VatRate
  plan: Plan
  paymentTerms: string
  paymentDays: number
  createdAt: string; updatedAt: string
}
Plan =
  | { type: 'instalments'; items: Instalment[] }
  | { type: 'periodic'; every: 'month' | 'quarter'; amount: number; first: string /*YYYY-MM*/; last: string /*YYYY-MM*/ }
  | { type: 'perUse' }
Instalment = { id: string; name: string; share: { percent: number } | { amount: number };
               due: { on: 'signing' } | { on: 'acceptance' } | { on: 'date'; date: string }; ready: boolean }
```
Indexes: `byCustomer` (customerId) and `byParent` (parentId).

### 4.2 Bill link
`Bill.contractRef?: { contractId: string; itemKey: string | null; number: string; signedDate: string; parentNumber: string | null; parentSignedDate: string | null }`
- `contractId` is the contract or the addendum.
- `number`/`signedDate` (and, for an addendum, the parent's number and signing date) are copied when the bill is saved. The reference line always prints from these copies, so it stays correct even if the contract is later edited or deleted.
- `itemKey` is an instalment id or a period key `YYYY-MM` (a quarter uses its first month); `null` means "Other".
- A draft copies `contractRef` like the other fields. Duplicating a bill keeps `contractId` and drops `itemKey`.

### 4.3 Settings
- `contractType: string` (default `HĐDV`) and `contractSuffix: string` (default `''`). The suffix and its `-` are omitted when empty.
- Contract counter meta key: `contract-counter-YYYY` (year of the signing date).

## 5. Rules

### 5.1 Numbers
- **Contracts:** the next number is `{counter}/{YYYY}/{contractType}[-{contractSuffix}]`, e.g. `12/2026/HĐDV-SM`.
  - The counter is allocated when the contract is first saved, like bills.
  - An edited number is kept as typed. If another contract already has that number, a warning is shown and saving is allowed.
- **Addenda:** `PL` + a two-digit sequence within the parent (`PL01`…), editable. Displayed as "Phụ lục số 01 của Hợp đồng số …".

### 5.2 Values
- **Contract value** = its line totals + VAT (same maths as bills). **Total value** of a contract = its own value + the values of its active "adds work" addenda.
- **Instalment amount** (before VAT):
  - a percent share is `round(valueBeforeVat × percent / 100)`;
  - the **last** instalment takes the difference so the instalments add up exactly to the value before VAT;
  - fixed amounts are used as is.
- **Billed** = the sum of totals of linked bills with status sent/paid/draft (not cancelled).
- **Paid** = the sum of linked Paid bills.
- **Left** = total value − paid (never negative in the display).
- Bills linked to any addendum count towards the parent contract's summary too.
- **Validation:**
  - instalments must total 100% (all percent) or exactly the value before VAT (all amounts). Mixed shares must total the value before VAT once the percents are converted;
  - periodic plans need `first ≤ last`;
  - dates must satisfy `startDate ≤ endDate`;
  - an addendum's effective date must fall within the parent's start and end dates (end open when null).

### 5.3 What is due and which terms apply
- **Plan items** of a contract or addendum:
  - **Instalments:** each is due from:
    - the signing date (`on: signing`);
    - the day it is marked ready (`on: acceptance`, ready = true);
    - its date (`on: date`).
  - **Periodic:** each period from `first` to `last` (monthly or quarterly) is due from its first day.
  - **Pay per use:** no items.
- **Changes terms:** for a contract with "changes terms" addenda, an item due on or after the latest effective date (≤ the item's due date) comes from that addendum's plan. The contract's own items due from that date on are **superseded** (shown greyed, not billable). Items already billed are never superseded.
- **Adds work:** addenda contribute their own items.
- **An item is billable** when:
  - its contract or addendum is active,
  - it is not superseded,
  - and it has no linked bill with status other than cancelled.
- **An item is due** when it is billable and its due date ≤ today.
- **Banner:** some due item's due date is ≤ today − 3 days.

### 5.4 Bill auto-fill (from a contract or addendum and an optional item)

| Field | Filled with |
|---|---|
| customer | the contract's customer snapshot (the customer id is also set) |
| vatRate | the applicable terms' VAT |
| dueDate | billDate + the applicable terms' `paymentDays` |
| lines | see below |
| contractRef | `{ contractId, itemKey }` |

Lines:
- **Instalment:** one line.
  - name VI `{name} – {percent}% giá trị hợp đồng` (or just `{name}` for an amount); EN name empty unless given.
  - qty 1, unit price = the instalment amount.
  - detail lines = the contract's line names (VI / EN).
- **Period:** the applicable lines, each with an added detail line `Kỳ tháng MM/YYYY / Period MM/YYYY` (quarter: `Quý Q/YYYY / Quarter Q/YYYY`). The quantities and prices are the plan's; if the plan amount differs from the line totals, a single line with the plan amount is used instead.
- **Pay per use or "Other":** the applicable lines, with quantity 1.

**Reference line on the bill page**, under the customer block:
- `Căn cứ Hợp đồng số {number} ký ngày {dd/mm/yyyy} / Under Contract No. {number} dated {dd/mm/yyyy}`
- for an addendum, `… và Phụ lục số {PLnn} ký ngày … / and Addendum No. … dated …`.

## 6. Storage, backups, migration

- **Database version 1 → 2.** The upgrade adds the store `contracts` with indexes `byCustomer` and `byParent`. Existing stores are unchanged.
- **Customers:** `deleteOrArchiveCustomer` also treats a customer as "used" when any contract references it.
- **Backups:**
  - `BackupData.contracts: Contract[]`. A missing `contracts` list is treated as `[]`, so older backups restore.
  - `schemaVersion` stays 1.
  - Contract counters (`contract-counter-*`) are exported alongside the bill counters.
  - `parseBackup` validates contracts with the same rigour as bills: ids and strings, statuses, dates, plan shape, lines.
  - A bill's `contractRef` is validated as an optional object.

## 7. Errors and edge cases

| Situation | Behaviour |
|---|---|
| Delete a contract with bills or addenda | Refused; offer Terminate |
| Delete a customer used by a contract | Archived instead (message) |
| Link a bill to a non-active contract, or an already-billed item | Not offered in the picker; a stale link is blocked when saving with "This contract item is already billed" |
| Instalments don't add up | Save & activate blocked with a message naming the difference; Save draft is allowed |
| Edit the plan of an active contract | Allowed after confirming "Consider an addendum instead"; billed items keep their bills |
| A linked bill is cancelled | Its item becomes billable again |
| Contract deleted or missing for a linked bill | The bill still shows; its reference line prints from the copies in `contractRef` (§4.2) |

## 8. Testing

**Unit tests** (written first):
- Contract numbering: pattern, empty suffix, per-year counter separate from bills, addendum `PL01…`, duplicate detection.
- Instalment amounts: percent rounding with the last-instalment difference; amounts; mixed shares; validation messages.
- Periods: monthly and quarterly lists, `first`/`last`, keys.
- Due items on a given date: signing, acceptance (ready), date; periods; cancelled bill → billable again; inactive contract; superseded items; adds-work addenda; the banner threshold.
- Applicable terms with several "changes terms" addenda.
- Contract totals: value, total value with addenda, billed, paid, left.
- Auto-fill for each plan type, "Other", and addenda; the reference line text (contract and addendum).
- Database upgrade v1 → v2 keeps existing data (fake-indexeddb: create v1, add data, open v2).
- Backup round trip with contracts; an old backup without contracts; damaged contracts rejected.
- Customer delete/archive with contracts.

**Screen tests:**
- Contract editor validation and Save & activate.
- Contract page actions (Mark ready, Create bill).
- Bill options contract picker and auto-fill.
- Home To bill box and banner.

**Manual check:** create a contract with 2 instalments and an "adds work" monthly addendum; bill items from Home; cancel one and confirm it returns; print a bill and check the reference line.
