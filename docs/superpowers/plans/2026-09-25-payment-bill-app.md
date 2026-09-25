# Payment Bill App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline, single-user browser app that creates bilingual (Vietnamese/English) payment requests ("Phiếu thanh toán / Payment request") with a VietQR code, exports them to PDF via the browser, and tracks Draft / Sent / Paid / Overdue / Cancelled.

**Architecture:** A static Preact + TypeScript app built with Vite, with no backend. Pure domain modules (`src/domain/*`) hold all calculation and rules and are unit-tested. `src/storage/*` is the only code that touches IndexedDB (via `idb`). `src/ui/BillPage.tsx` renders the A4 bill for both preview and print. Screens (`src/screens/*`) are thin presentation over those modules. Hash-based routing.

**Tech Stack:** Vite, Preact, TypeScript, `idb`, `qrcode`, `vite-plugin-pwa`; tests with Vitest, jsdom, `fake-indexeddb` and `@testing-library/preact`.

**Spec:** `docs/superpowers/specs/2026-09-25-payment-bill-app-design.md` (read it before starting any task). Mockups: `docs/superpowers/specs/mockups/`.

## Global Constraints

- Document type is a payment request only. Never label it "hóa đơn" / "invoice" on the bill. Title: **PHIẾU THANH TOÁN** / *PAYMENT REQUEST*.
- Currency is VND only, and all money values are integers (đồng). Display format uses dot thousand separators: `20.952.000`.
- VAT is one rate per bill: `'none' | 0 | 5 | 8 | 10`. VAT = `Math.round(subtotal * rate / 100)`. `'none'` prints no VAT row.
- Bill number format: `{prefix}-{YYYY}-{NNNN}` (e.g. `TT-2026-0012`). The year comes from the bill date at first save. There is a per-year counter, and numbers are never reused.
- Payment reference = bill number without hyphens (`TT20260012`).
- Status set: `draft | sent | paid | cancelled`. "Overdue" is derived (status `sent` and today > dueDate) and is never stored.
- Allowed transitions: draft→sent, draft→cancelled, sent→paid, sent→cancelled, paid→sent.
- Only drafts are editable. Other statuses are locked.
- Dates are stored as ISO `YYYY-MM-DD` strings in local time and displayed as `dd/mm/yyyy`.
- The bill layout is style A (classic Vietnamese document), A4, with Vietnamese labels and an English line beneath each.
- App UI language: English.
- No network calls at runtime. The QR is generated locally.
- Data lives in IndexedDB database `payment-bills`. Backup files use `{ app: "payment-bills", schemaVersion: 1, ... }`.
- Default settings: prefix `TT`, default VAT `8`, default payment days `10`, footer note `Hóa đơn GTGT điện tử sẽ được xuất sau khi thanh toán. / An official VAT e-invoice will be issued after payment.`
- Backup reminder: show when the last backup is older than 7 days or has never been made.

## Review Focus

1. **Very large totals** (≥ 1 tỷ, e.g. 12.345.678.901 ₫) must still produce correct words in both languages and a valid QR amount. Pinned in Task 2 (`words` tests) and Task 3 (`vietqr` large amount test).
2. **An account number typed with spaces or dots** ("0071 0001 23456") must produce a scannable QR with the digits only. Pinned in Task 3.
3. **A zero-total bill** (all free items) must not put amount `0` into the QR; the amount field is omitted so the payer enters it. Pinned in Task 3.
4. **Restoring a wrong or corrupt file** (random JSON, an older schema, a bill with a missing field) must be rejected with a message, leaving current data untouched. Pinned in Task 6.
5. **A draft dated in a different year than today** (e.g. created 30/12 for 02/01) must take its number from the bill-date year, and a customer name with `/` or `:` must still give a valid PDF filename. Pinned in Task 5 (numbering) and Task 1 (`pdfFileName`).

---

## File Structure

```
index.html
package.json
tsconfig.json
vite.config.ts
src/
  main.tsx                    boot: open DB, request persistent storage, render App or error
  app.tsx                     AppContext (db, settings), layout with nav, route switch
  router.ts                   parseRoute, navigate, navigation guard
  styles.css                  app chrome styles
  domain/
    types.ts                  all shared types + DEFAULT_SETTINGS
    format.ts                 formatVnd, formatDateVn, todayIso, addDays, pdfFileName
    money.ts                  computeTotals
    words.ts                  vndToWordsVi, vndToWordsEn
    vietqr.ts                 crc16, buildVietQrPayload, paymentReference
    banks.ts                  NAPAS bank list (name + BIN)
    status.ts                 canTransition, applyStatus, isOverdue, displayStatus, isLocked
    summary.ts                homeSummary
    validate.ts               exportBlockers, lineErrors, dateErrors
    draft.ts                  pure editor-state helpers
  storage/
    db.ts                     openAppDb + CRUD helpers
    numbering.ts              allocateBillNumber
    backup.ts                 exportAll, parseBackup, restoreAll, needsBackupReminder, markBackedUp, lastBackupAt
  ui/
    BillPage.tsx              A4 bill component (style A)
    bill-page.css             screen + print styles for the bill
    useQrDataUrl.ts           hook: payload → PNG data URL
    print.ts                  printBill (sets document title, calls window.print)
  screens/
    Home.tsx                  summary boxes, bill list, filter, search, backup banner
    BillView.tsx              one bill: preview + status actions + export again + duplicate
    Editor.tsx                3-step editor
    Customers.tsx
    Services.tsx
    Settings.tsx
    Backup.tsx
tests/                        mirrors src/ (domain/, storage/, ui/, router.test.ts)
docs/manual-test-checklist.md
```

---

### Task 1: Project scaffold, shared types, formatting and money

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx` (temporary stub), `src/domain/types.ts`, `src/domain/format.ts`, `src/domain/money.ts`
- Test: `tests/domain/format.test.ts`, `tests/domain/money.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - Types from `src/domain/types.ts`: `VatRate`, `BillStatus`, `Customer`, `CustomerSnapshot`, `Service`, `BillLine`, `Bill`, `Settings`, `DEFAULT_SETTINGS`
  - `formatVnd(n: number): string`, `formatDateVn(iso: string): string`, `todayIso(d?: Date): string`, `addDays(iso: string, days: number): string`, `pdfFileName(number: string, customerName: string): string`
  - `computeTotals(lines: BillLine[], vatRate: VatRate): Totals` where `Totals = { lineAmounts: number[]; subtotal: number; vat: number; total: number; vatApplies: boolean }`

- [ ] **Step 1: Scaffold the project**

Run in the repo root (it already has `docs/` and `.gitignore`):

```bash
npm init -y
npm install preact idb qrcode
npm install -D vite @preact/preset-vite typescript vitest jsdom fake-indexeddb @testing-library/preact @types/qrcode vite-plugin-pwa
```

Replace the `scripts` section of `package.json` with:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Also set `"type": "module"` in `package.json`.

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

Create `vite.config.ts` (the PWA plugin is added in Task 12):

```ts
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Phiếu thanh toán</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create the stub `src/main.tsx` (replaced in Task 8):

```tsx
import { render } from 'preact';
render(<p>Payment bills</p>, document.getElementById('app')!);
```

- [ ] **Step 2: Create the shared types**

Create `src/domain/types.ts`:

```ts
export type VatRate = 'none' | 0 | 5 | 8 | 10;
export const VAT_RATES: VatRate[] = ['none', 0, 5, 8, 10];

export type BillStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

export interface CustomerSnapshot {
  name: string;
  address: string;
  taxId: string;
  contactPerson: string;
  email: string;
  phone: string;
}

export interface Customer extends CustomerSnapshot {
  id: string;
  archived: boolean;
}

export interface Service {
  id: string;
  nameVi: string;
  nameEn: string;
  unitVi: string;
  unitEn: string;
  unitPrice: number;
  archived: boolean;
}

export interface BillLine {
  nameVi: string;
  nameEn: string;
  unitVi: string;
  unitEn: string;
  qty: number;
  unitPrice: number;
}

export interface Bill {
  id: string;
  number: string;
  status: BillStatus;
  billDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  paidDate: string | null;
  customerId: string;
  customer: CustomerSnapshot;
  lines: BillLine[];
  vatRate: VatRate;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Settings {
  businessName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  bankBin: string;
  accountNumber: string;
  accountHolder: string;
  preparedBy: string;
  numberPrefix: string;
  defaultVatRate: VatRate;
  defaultPaymentDays: number;
  footerNote: string;
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
  logoDataUrl: null,
  bankBin: '',
  accountNumber: '',
  accountHolder: '',
  preparedBy: '',
  numberPrefix: 'TT',
  defaultVatRate: 8,
  defaultPaymentDays: 10,
  footerNote:
    'Hóa đơn GTGT điện tử sẽ được xuất sau khi thanh toán. / An official VAT e-invoice will be issued after payment.',
};
```

- [ ] **Step 3: Write failing tests for formatting and money**

Create `tests/domain/format.test.ts`:

```ts
import { formatVnd, formatDateVn, todayIso, addDays, pdfFileName } from '../../src/domain/format';

describe('formatVnd', () => {
  it('uses dot thousand separators', () => {
    expect(formatVnd(0)).toBe('0');
    expect(formatVnd(800000)).toBe('800.000');
    expect(formatVnd(20952000)).toBe('20.952.000');
    expect(formatVnd(12345678901)).toBe('12.345.678.901');
  });
});

describe('dates', () => {
  it('formats ISO dates as dd/mm/yyyy', () => {
    expect(formatDateVn('2026-09-05')).toBe('05/09/2026');
  });
  it('gives today in local time', () => {
    expect(todayIso(new Date(2026, 8, 25, 23, 59))).toBe('2026-09-25');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-09-25', 10)).toBe('2026-10-05');
    expect(addDays('2026-12-28', 10)).toBe('2027-01-07');
  });
});

describe('pdfFileName', () => {
  it('joins number and customer and strips characters not allowed in filenames', () => {
    expect(pdfFileName('TT-2026-0012', 'Công ty CP Hoa Sen Xanh')).toBe(
      'TT-2026-0012_Công ty CP Hoa Sen Xanh',
    );
    expect(pdfFileName('TT-2026-0013', 'A/B: "C" <D>*?|\\')).toBe('TT-2026-0013_A B C D');
  });
});
```

Create `tests/domain/money.test.ts`:

```ts
import { computeTotals } from '../../src/domain/money';
import type { BillLine } from '../../src/domain/types';

const line = (qty: number, unitPrice: number): BillLine => ({
  nameVi: 'x', nameEn: 'x', unitVi: '', unitEn: '', qty, unitPrice,
});

describe('computeTotals', () => {
  it('matches the spec example with 8% VAT', () => {
    const t = computeTotals([line(1, 5000000), line(1, 12000000), line(3, 800000)], 8);
    expect(t.lineAmounts).toEqual([5000000, 12000000, 2400000]);
    expect(t.subtotal).toBe(19400000);
    expect(t.vat).toBe(1552000);
    expect(t.total).toBe(20952000);
    expect(t.vatApplies).toBe(true);
  });
  it('rounds VAT half up to the nearest dong', () => {
    expect(computeTotals([line(1, 12345)], 5).vat).toBe(617); // 617.25
    expect(computeTotals([line(1, 30)], 5).vat).toBe(2); // 1.5
  });
  it('has no VAT when not applicable', () => {
    const t = computeTotals([line(2, 1000)], 'none');
    expect(t.vat).toBe(0);
    expect(t.total).toBe(2000);
    expect(t.vatApplies).toBe(false);
  });
  it('treats 0% as applicable (row printed) with zero VAT', () => {
    const t = computeTotals([line(2, 1000)], 0);
    expect(t.vat).toBe(0);
    expect(t.vatApplies).toBe(true);
  });
  it('handles no lines', () => {
    expect(computeTotals([], 10).total).toBe(0);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/domain`
Expected: FAIL, "Failed to resolve import ../../src/domain/format" (and money).

- [ ] **Step 5: Implement format.ts and money.ts**

Create `src/domain/format.ts`:

```ts
export function formatVnd(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatDateVn(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

export function pdfFileName(number: string, customerName: string): string {
  const safe = customerName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${number}_${safe}`;
}
```

Create `src/domain/money.ts`:

```ts
import type { BillLine, VatRate } from './types';

export interface Totals {
  lineAmounts: number[];
  subtotal: number;
  vat: number;
  total: number;
  vatApplies: boolean;
}

export function computeTotals(lines: BillLine[], vatRate: VatRate): Totals {
  const lineAmounts = lines.map((l) => l.qty * l.unitPrice);
  const subtotal = lineAmounts.reduce((a, b) => a + b, 0);
  const vatApplies = vatRate !== 'none';
  const vat = vatApplies ? Math.round((subtotal * vatRate) / 100) : 0;
  return { lineAmounts, subtotal, vat, total: subtotal + vat, vatApplies };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/domain`
Expected: PASS (all tests in format and money).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests
git commit -m "feat: scaffold app with shared types, formatting and totals"
```

---

### Task 2: Amounts in words (Vietnamese and English)

**Files:**
- Create: `src/domain/words.ts`
- Test: `tests/domain/words.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `vndToWordsVi(n: number): string`, `vndToWordsEn(n: number): string`. Both are capitalised, end with " đồng." / " dong.", and support integers from 0 up to 999.999.999.999.999.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/words.test.ts`:

```ts
import { vndToWordsVi, vndToWordsEn } from '../../src/domain/words';

const cases: [number, string, string][] = [
  [0, 'Không đồng.', 'Zero dong.'],
  [5, 'Năm đồng.', 'Five dong.'],
  [15, 'Mười lăm đồng.', 'Fifteen dong.'],
  [21, 'Hai mươi mốt đồng.', 'Twenty-one dong.'],
  [25, 'Hai mươi lăm đồng.', 'Twenty-five dong.'],
  [105, 'Một trăm linh năm đồng.', 'One hundred five dong.'],
  [110, 'Một trăm mười đồng.', 'One hundred ten dong.'],
  [1001, 'Một nghìn không trăm linh một đồng.', 'One thousand one dong.'],
  [1000005, 'Một triệu không trăm linh năm đồng.', 'One million five dong.'],
  [
    1005015,
    'Một triệu không trăm linh năm nghìn không trăm mười lăm đồng.',
    'One million five thousand fifteen dong.',
  ],
  [21000000, 'Hai mươi mốt triệu đồng.', 'Twenty-one million dong.'],
  [
    20952000,
    'Hai mươi triệu chín trăm năm mươi hai nghìn đồng.',
    'Twenty million nine hundred fifty-two thousand dong.',
  ],
  [1000000000, 'Một tỷ đồng.', 'One billion dong.'],
  [
    12345678901,
    'Mười hai tỷ ba trăm bốn mươi lăm triệu sáu trăm bảy mươi tám nghìn chín trăm linh một đồng.',
    'Twelve billion three hundred forty-five million six hundred seventy-eight thousand nine hundred one dong.',
  ],
];

describe('amount in words', () => {
  it.each(cases)('%i', (n, vi, en) => {
    expect(vndToWordsVi(n)).toBe(vi);
    expect(vndToWordsEn(n)).toBe(en);
  });
  it('rejects negative or non-integer amounts', () => {
    expect(() => vndToWordsVi(-1)).toThrow();
    expect(() => vndToWordsEn(1.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/domain/words.test.ts`
Expected: FAIL, cannot resolve `../../src/domain/words`.

- [ ] **Step 3: Implement words.ts**

Create `src/domain/words.ts`:

```ts
const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VI_SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function assertAmount(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n >= 1e15) {
    throw new RangeError(`Unsupported amount: ${n}`);
  }
}

/** Split into groups of three digits, least significant first. */
function groups(n: number): number[] {
  const g: number[] = [];
  while (n > 0) {
    g.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  return g;
}

const capitalise = (s: string) => s[0].toUpperCase() + s.slice(1);

/** `full` = this group follows a higher group, so "không trăm" / "linh" must be spoken. */
function viTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor(n / 10) % 10;
  const u = n % 10;
  const p: string[] = [];
  if (h > 0 || full) p.push(VI_DIGITS[h], 'trăm');
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) p.push('linh');
  } else if (t === 1) {
    p.push('mười');
  } else {
    p.push(VI_DIGITS[t], 'mươi');
  }
  if (u > 0) {
    if (u === 1 && t >= 2) p.push('mốt');
    else if (u === 5 && t >= 1) p.push('lăm');
    else p.push(VI_DIGITS[u]);
  }
  return p.join(' ');
}

export function vndToWordsVi(n: number): string {
  assertAmount(n);
  if (n === 0) return 'Không đồng.';
  const g = groups(n);
  const parts: string[] = [];
  for (let i = g.length - 1; i >= 0; i--) {
    if (g[i] === 0) continue;
    parts.push(viTriple(g[i], i < g.length - 1));
    if (VI_SCALES[i]) parts.push(VI_SCALES[i]);
  }
  return `${capitalise(parts.join(' '))} đồng.`;
}

function enTriple(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const p: string[] = [];
  if (h > 0) p.push(EN_ONES[h], 'hundred');
  if (r > 0) {
    if (r < 20) p.push(EN_ONES[r]);
    else p.push(r % 10 ? `${EN_TENS[Math.floor(r / 10)]}-${EN_ONES[r % 10]}` : EN_TENS[r / 10]);
  }
  return p.join(' ');
}

export function vndToWordsEn(n: number): string {
  assertAmount(n);
  if (n === 0) return 'Zero dong.';
  const g = groups(n);
  const parts: string[] = [];
  for (let i = g.length - 1; i >= 0; i--) {
    if (g[i] === 0) continue;
    parts.push(enTriple(g[i]));
    if (EN_SCALES[i]) parts.push(EN_SCALES[i]);
  }
  return `${capitalise(parts.join(' '))} dong.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain/words.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/words.ts tests/domain/words.test.ts
git commit -m "feat: amount in words for Vietnamese and English"
```

---

### Task 3: VietQR payload and bank list

**Files:**
- Create: `src/domain/vietqr.ts`, `src/domain/banks.ts`
- Test: `tests/domain/vietqr.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `crc16(s: string): string` (CRC-16/CCITT-FALSE, 4 uppercase hex characters)
  - `paymentReference(billNumber: string): string`
  - `buildVietQrPayload(input: { bankBin: string; accountNumber: string; amount: number; reference: string }): string`
  - `BANKS: { bin: string; shortName: string; name: string }[]`, `bankByBin(bin: string): Bank | undefined`

**Background for the implementer:** VietQR is the NAPAS standard built on EMVCo "merchant presented" QR codes. The payload is a sequence of TLV fields: 2-digit ID, 2-digit length, then the value. Field 38 holds the NAPAS GUID `A000000727`, a nested field 01 (bank BIN in 00, account in 01) and the service code `QRIBFTTA` (transfer to account). Field 54 is the amount, and 62 contains 08 (the purpose/reference). The payload ends with `6304` + CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) computed over everything before it, including the `6304`. Use `01` = `12` (dynamic) when an amount is present and `11` (static) when it is not.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/vietqr.test.ts`:

```ts
import { crc16, buildVietQrPayload, paymentReference } from '../../src/domain/vietqr';
import { bankByBin, BANKS } from '../../src/domain/banks';

describe('crc16', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('paymentReference', () => {
  it('removes hyphens from the bill number', () => {
    expect(paymentReference('TT-2026-0012')).toBe('TT20260012');
  });
});

describe('buildVietQrPayload', () => {
  it('builds the exact payload for the spec example', () => {
    expect(
      buildVietQrPayload({
        bankBin: '970436',
        accountNumber: '0071000123456',
        amount: 20952000,
        reference: 'TT20260012',
      }),
    ).toBe(
      '00020101021238570010A00000072701270006970436011300710001234560208QRIBFTTA53037045408209520005802VN62140810TT202600126304F243',
    );
  });

  it('strips spaces and dots from the account number', () => {
    const a = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071 0001.23456', amount: 20952000, reference: 'TT20260012' });
    const b = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 20952000, reference: 'TT20260012' });
    expect(a).toBe(b);
  });

  it('omits the amount and uses a static code when the total is 0', () => {
    expect(
      buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 0, reference: 'TT20260013' }),
    ).toBe(
      '00020101021138570010A00000072701270006970436011300710001234560208QRIBFTTA53037045802VN62140810TT202600136304F54A',
    );
  });

  it('supports amounts of 1 tỷ and more', () => {
    const p = buildVietQrPayload({ bankBin: '970436', accountNumber: '0071000123456', amount: 12345678901, reference: 'TT20260014' });
    expect(p).toContain('5401112345678901');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it('rejects invalid input', () => {
    expect(() => buildVietQrPayload({ bankBin: '', accountNumber: '123', amount: 1, reference: 'X' })).toThrow();
    expect(() => buildVietQrPayload({ bankBin: '970436', accountNumber: 'abc', amount: 1, reference: 'X' })).toThrow();
  });
});

describe('banks', () => {
  it('finds a bank by BIN and has unique BINs', () => {
    expect(bankByBin('970436')?.shortName).toBe('Vietcombank');
    expect(new Set(BANKS.map((b) => b.bin)).size).toBe(BANKS.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/domain/vietqr.test.ts`
Expected: FAIL, cannot resolve `../../src/domain/vietqr`.

- [ ] **Step 3: Implement vietqr.ts and banks.ts**

Create `src/domain/vietqr.ts`:

```ts
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`VietQR field ${id} too long`);
  return id + String(value.length).padStart(2, '0') + value;
}

export function paymentReference(billNumber: string): string {
  return billNumber.replace(/-/g, '');
}

export interface VietQrInput {
  bankBin: string;
  accountNumber: string;
  amount: number;
  reference: string;
}

export function buildVietQrPayload({ bankBin, accountNumber, amount, reference }: VietQrInput): string {
  const account = accountNumber.replace(/[\s.]/g, '');
  if (!/^\d{6}$/.test(bankBin)) throw new Error('Bank BIN must be 6 digits');
  if (!/^[0-9A-Za-z]{1,19}$/.test(account)) throw new Error('Invalid account number');
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Invalid amount');

  const merchantAccount =
    tlv('00', 'A000000727') + tlv('01', tlv('00', bankBin) + tlv('01', account)) + tlv('02', 'QRIBFTTA');

  const payload =
    tlv('00', '01') +
    tlv('01', amount > 0 ? '12' : '11') +
    tlv('38', merchantAccount) +
    tlv('53', '704') +
    (amount > 0 ? tlv('54', String(amount)) : '') +
    tlv('58', 'VN') +
    tlv('62', tlv('08', reference)) +
    '6304';
  return payload + crc16(payload);
}
```

Create `src/domain/banks.ts`:

```ts
export interface Bank {
  bin: string;
  shortName: string;
  name: string;
}

// NAPAS BINs. Verify against https://api.vietqr.io/v2/banks during the manual bank-app test.
export const BANKS: Bank[] = [
  { bin: '970436', shortName: 'Vietcombank', name: 'Ngân hàng TMCP Ngoại thương Việt Nam' },
  { bin: '970415', shortName: 'VietinBank', name: 'Ngân hàng TMCP Công thương Việt Nam' },
  { bin: '970418', shortName: 'BIDV', name: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam' },
  { bin: '970405', shortName: 'Agribank', name: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam' },
  { bin: '970407', shortName: 'Techcombank', name: 'Ngân hàng TMCP Kỹ thương Việt Nam' },
  { bin: '970422', shortName: 'MB Bank', name: 'Ngân hàng TMCP Quân đội' },
  { bin: '970416', shortName: 'ACB', name: 'Ngân hàng TMCP Á Châu' },
  { bin: '970432', shortName: 'VPBank', name: 'Ngân hàng TMCP Việt Nam Thịnh Vượng' },
  { bin: '970423', shortName: 'TPBank', name: 'Ngân hàng TMCP Tiên Phong' },
  { bin: '970403', shortName: 'Sacombank', name: 'Ngân hàng TMCP Sài Gòn Thương Tín' },
  { bin: '970437', shortName: 'HDBank', name: 'Ngân hàng TMCP Phát triển TP.HCM' },
  { bin: '970441', shortName: 'VIB', name: 'Ngân hàng TMCP Quốc tế Việt Nam' },
  { bin: '970443', shortName: 'SHB', name: 'Ngân hàng TMCP Sài Gòn - Hà Nội' },
  { bin: '970431', shortName: 'Eximbank', name: 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam' },
  { bin: '970426', shortName: 'MSB', name: 'Ngân hàng TMCP Hàng Hải Việt Nam' },
  { bin: '970448', shortName: 'OCB', name: 'Ngân hàng TMCP Phương Đông' },
  { bin: '970440', shortName: 'SeABank', name: 'Ngân hàng TMCP Đông Nam Á' },
  { bin: '970449', shortName: 'LPBank', name: 'Ngân hàng TMCP Lộc Phát Việt Nam' },
  { bin: '970428', shortName: 'Nam A Bank', name: 'Ngân hàng TMCP Nam Á' },
  { bin: '970409', shortName: 'Bac A Bank', name: 'Ngân hàng TMCP Bắc Á' },
  { bin: '970425', shortName: 'ABBANK', name: 'Ngân hàng TMCP An Bình' },
  { bin: '970454', shortName: 'Viet Capital Bank', name: 'Ngân hàng TMCP Bản Việt' },
  { bin: '970412', shortName: 'PVcomBank', name: 'Ngân hàng TMCP Đại Chúng Việt Nam' },
  { bin: '970452', shortName: 'KienlongBank', name: 'Ngân hàng TMCP Kiên Long' },
];

export function bankByBin(bin: string): Bank | undefined {
  return BANKS.find((b) => b.bin === bin);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain/vietqr.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/vietqr.ts src/domain/banks.ts tests/domain/vietqr.test.ts
git commit -m "feat: offline VietQR payload builder and NAPAS bank list"
```

---

### Task 4: Status rules, home summary, validation and editor draft helpers

**Files:**
- Create: `src/domain/status.ts`, `src/domain/summary.ts`, `src/domain/validate.ts`, `src/domain/draft.ts`
- Test: `tests/fixtures.ts`, `tests/domain/status.test.ts`, `tests/domain/summary.test.ts`, `tests/domain/validate.test.ts`, `tests/domain/draft.test.ts`

**Interfaces:**
- Consumes: types (Task 1), `computeTotals` (Task 1), `addDays` (Task 1)
- Produces:
  - `canTransition(from: BillStatus, to: BillStatus): boolean`
  - `applyStatus(bill: Bill, to: BillStatus, today: string, nowIso: string): Bill` (throws on an invalid transition)
  - `isOverdue(bill: Bill, today: string): boolean`, `displayStatus(bill: Bill, today: string): BillStatus | 'overdue'`, `isLocked(bill: Bill): boolean`
  - `homeSummary(bills: Bill[], today: string): { unpaid: Stat; overdue: Stat; paidThisMonth: Stat }` where `Stat = { amount: number; count: number }`
  - `lineErrors(line: BillLine): string[]`, `dateErrors(billDate: string, dueDate: string): string[]`
  - `exportBlockers(draft: DraftBill, settings: Settings): Blocker[]` where `Blocker = { message: string; target: 'customer' | 'services' | 'settings' }`
  - `DraftBill` type = `Omit<Bill, 'id' | 'number' | 'status' | 'paidDate' | 'createdAt' | 'updatedAt'> & { id: string | null; number: string | null }`
  - `newDraft(settings: Settings, today: string): DraftBill`, `setCustomer(d: DraftBill, c: Customer): DraftBill`, `addServiceLine(d: DraftBill, s: Service): DraftBill`, `addCustomLine(d: DraftBill): DraftBill`, `updateLine(d: DraftBill, index: number, patch: Partial<BillLine>): DraftBill`, `removeLine(d: DraftBill, index: number): DraftBill`, `setBillDate(d: DraftBill, billDate: string, paymentDays: number): DraftBill`, `draftFromBill(b: Bill): DraftBill`, `duplicateAsDraft(b: Bill, settings: Settings, today: string): DraftBill`

- [ ] **Step 1: Write the failing tests**

Create the shared fixture `tests/fixtures.ts` (import it from tests; never import one test file from another, or its tests run twice):

```ts
import type { Bill } from '../src/domain/types';

export const sampleBill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1', number: 'TT-2026-0012', status: 'draft', billDate: '2026-09-25', dueDate: '2026-10-05',
  paidDate: null, customerId: 'c1',
  customer: { name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '' },
  lines: [{ nameVi: 'Thiết kế logo', nameEn: 'Logo design', unitVi: '', unitEn: '', qty: 1, unitPrice: 5000000 }],
  vatRate: 8, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', ...over,
});
```

Create `tests/domain/status.test.ts`:

```ts
import { canTransition, applyStatus, isOverdue, displayStatus, isLocked } from '../../src/domain/status';
import { sampleBill } from '../fixtures';

describe('status transitions', () => {
  it('allows exactly the spec transitions', () => {
    const allowed = ['draft>sent', 'draft>cancelled', 'sent>paid', 'sent>cancelled', 'paid>sent'];
    const all = ['draft', 'sent', 'paid', 'cancelled'] as const;
    for (const f of all) for (const t of all) {
      expect(canTransition(f, t)).toBe(allowed.includes(`${f}>${t}`));
    }
  });
  it('records and clears the paid date', () => {
    const paid = applyStatus(sampleBill({ status: 'sent' }), 'paid', '2026-10-01', '2026-10-01T09:00:00.000Z');
    expect(paid.paidDate).toBe('2026-10-01');
    expect(paid.updatedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(applyStatus(paid, 'sent', '2026-10-02', 'x').paidDate).toBeNull();
  });
  it('throws on an invalid transition', () => {
    expect(() => applyStatus(sampleBill({ status: 'cancelled' }), 'sent', '2026-10-01', 'x')).toThrow();
  });
});

describe('overdue and locking', () => {
  it('is overdue only when sent and past the due date', () => {
    expect(isOverdue(sampleBill({ status: 'sent' }), '2026-10-05')).toBe(false);
    expect(isOverdue(sampleBill({ status: 'sent' }), '2026-10-06')).toBe(true);
    expect(isOverdue(sampleBill({ status: 'paid' }), '2026-12-01')).toBe(false);
    expect(displayStatus(sampleBill({ status: 'sent' }), '2026-10-06')).toBe('overdue');
    expect(displayStatus(sampleBill({ status: 'draft' }), '2026-10-06')).toBe('draft');
  });
  it('locks everything except drafts', () => {
    expect(isLocked(sampleBill())).toBe(false);
    expect(isLocked(sampleBill({ status: 'sent' }))).toBe(true);
    expect(isLocked(sampleBill({ status: 'cancelled' }))).toBe(true);
  });
});
```

Create `tests/domain/summary.test.ts`:

```ts
import { homeSummary } from '../../src/domain/summary';
import { sampleBill } from '../fixtures';

describe('homeSummary', () => {
  it('sums unpaid, overdue and paid-this-month using bill totals', () => {
    const bills = [
      sampleBill({ id: '1', status: 'sent', dueDate: '2026-10-05' }), // 5.400.000 incl. 8% VAT, not overdue
      sampleBill({ id: '2', status: 'sent', dueDate: '2026-09-11' }), // overdue
      sampleBill({ id: '3', status: 'paid', paidDate: '2026-09-02' }),
      sampleBill({ id: '4', status: 'paid', paidDate: '2026-08-30' }), // last month
      sampleBill({ id: '5', status: 'draft' }),
      sampleBill({ id: '6', status: 'cancelled' }),
    ];
    const s = homeSummary(bills, '2026-09-25');
    expect(s.unpaid).toEqual({ amount: 10800000, count: 2 });
    expect(s.overdue).toEqual({ amount: 5400000, count: 1 });
    expect(s.paidThisMonth).toEqual({ amount: 5400000, count: 1 });
  });
});
```

Create `tests/domain/validate.test.ts`:

```ts
import { exportBlockers, lineErrors, dateErrors } from '../../src/domain/validate';
import { newDraft, setCustomer, addCustomLine, updateLine } from '../../src/domain/draft';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/types';

const filledSettings: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'Sao Mai', bankBin: '970436', accountNumber: '0071000123456',
};
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };

describe('lineErrors', () => {
  it('requires a name, qty ≥ 1 and an integer price ≥ 0', () => {
    const ok = { nameVi: 'A', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 0 };
    expect(lineErrors(ok)).toEqual([]);
    expect(lineErrors({ ...ok, nameVi: '  ' })).toContain('Service name is required');
    expect(lineErrors({ ...ok, qty: 0 })).toContain('Quantity must be a whole number of at least 1');
    expect(lineErrors({ ...ok, qty: 1.5 })).toContain('Quantity must be a whole number of at least 1');
    expect(lineErrors({ ...ok, unitPrice: -1 })).toContain('Unit price must be a whole number of at least 0');
  });
});

describe('dateErrors', () => {
  it('rejects a due date before the bill date', () => {
    expect(dateErrors('2026-09-25', '2026-09-25')).toEqual([]);
    expect(dateErrors('2026-09-25', '2026-09-24')).toEqual(['Due date cannot be before the bill date']);
  });
});

describe('exportBlockers', () => {
  it('lists what is missing and where to fix it', () => {
    const d = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    expect(exportBlockers(d, DEFAULT_SETTINGS).map((b) => b.target)).toEqual([
      'customer', 'services', 'settings', 'settings', 'settings',
    ]);
  });
  it('is empty for a complete draft', () => {
    let d = setCustomer(newDraft(filledSettings, '2026-09-25'), customer);
    d = updateLine(addCustomLine(d), 0, { nameVi: 'Thiết kế', qty: 1, unitPrice: 100 });
    expect(exportBlockers(d, filledSettings)).toEqual([]);
  });
  it('blocks on invalid lines and dates', () => {
    let d = setCustomer(newDraft(filledSettings, '2026-09-25'), customer);
    d = addCustomLine(d); // empty name
    d = { ...d, dueDate: '2026-09-01' };
    const msgs = exportBlockers(d, filledSettings).map((b) => b.message);
    expect(msgs).toContain('Line 1: Service name is required');
    expect(msgs).toContain('Due date cannot be before the bill date');
  });
});
```

Create `tests/domain/draft.test.ts`:

```ts
import {
  newDraft, setCustomer, addServiceLine, addCustomLine, updateLine, removeLine, setBillDate, draftFromBill, duplicateAsDraft,
} from '../../src/domain/draft';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const service = { id: 's1', nameVi: 'Bảo trì website', nameEn: 'Website maintenance', unitVi: 'tháng', unitEn: 'month', unitPrice: 800000, archived: false };
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: '', email: '', phone: '', archived: false };

describe('draft helpers', () => {
  it('starts with settings defaults', () => {
    const d = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    expect(d).toMatchObject({ id: null, number: null, billDate: '2026-09-25', dueDate: '2026-10-05', vatRate: 8, lines: [], customerId: '' });
  });
  it('copies a customer snapshot without id or archived flag', () => {
    const d = setCustomer(newDraft(DEFAULT_SETTINGS, '2026-09-25'), customer);
    expect(d.customerId).toBe('c1');
    expect(d.customer).toEqual({ name: 'Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: '', email: '', phone: '' });
  });
  it('adds, updates and removes lines immutably', () => {
    const d0 = newDraft(DEFAULT_SETTINGS, '2026-09-25');
    const d1 = addServiceLine(d0, service);
    expect(d0.lines).toHaveLength(0);
    expect(d1.lines[0]).toEqual({ nameVi: 'Bảo trì website', nameEn: 'Website maintenance', unitVi: 'tháng', unitEn: 'month', qty: 1, unitPrice: 800000 });
    const d2 = updateLine(addCustomLine(d1), 0, { qty: 3 });
    expect(d2.lines[0].qty).toBe(3);
    expect(d2.lines[1].nameVi).toBe('');
    expect(removeLine(d2, 0).lines).toHaveLength(1);
  });
  it('moves the due date with the bill date', () => {
    expect(setBillDate(newDraft(DEFAULT_SETTINGS, '2026-09-25'), '2026-12-28', 10).dueDate).toBe('2027-01-07');
  });
  it('round-trips a stored bill and duplicates as a fresh draft', () => {
    const b = sampleBill({ status: 'sent' });
    expect(draftFromBill(b)).toMatchObject({ id: 'b1', number: 'TT-2026-0012', lines: b.lines });
    const dup = duplicateAsDraft(b, DEFAULT_SETTINGS, '2026-11-01');
    expect(dup).toMatchObject({ id: null, number: null, billDate: '2026-11-01', dueDate: '2026-11-11', customerId: 'c1', lines: b.lines });
    expect(dup.lines).not.toBe(b.lines);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/domain`
Expected: FAIL, cannot resolve `status`, `summary`, `validate` and `draft`.

- [ ] **Step 3: Implement status.ts and summary.ts**

Create `src/domain/status.ts`:

```ts
import type { Bill, BillStatus } from './types';

const ALLOWED: Record<BillStatus, BillStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['paid', 'cancelled'],
  paid: ['sent'],
  cancelled: [],
};

export function canTransition(from: BillStatus, to: BillStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function applyStatus(bill: Bill, to: BillStatus, today: string, nowIso: string): Bill {
  if (!canTransition(bill.status, to)) {
    throw new Error(`Cannot change a ${bill.status} bill to ${to}`);
  }
  return { ...bill, status: to, paidDate: to === 'paid' ? today : null, updatedAt: nowIso };
}

export function isOverdue(bill: Bill, today: string): boolean {
  return bill.status === 'sent' && today > bill.dueDate;
}

export function displayStatus(bill: Bill, today: string): BillStatus | 'overdue' {
  return isOverdue(bill, today) ? 'overdue' : bill.status;
}

export function isLocked(bill: Bill): boolean {
  return bill.status !== 'draft';
}
```

Create `src/domain/summary.ts`:

```ts
import type { Bill } from './types';
import { computeTotals } from './money';
import { isOverdue } from './status';

export interface Stat {
  amount: number;
  count: number;
}

export function homeSummary(bills: Bill[], today: string) {
  const unpaid: Stat = { amount: 0, count: 0 };
  const overdue: Stat = { amount: 0, count: 0 };
  const paidThisMonth: Stat = { amount: 0, count: 0 };
  const month = today.slice(0, 7);
  for (const b of bills) {
    const total = computeTotals(b.lines, b.vatRate).total;
    if (b.status === 'sent') {
      unpaid.amount += total;
      unpaid.count++;
      if (isOverdue(b, today)) {
        overdue.amount += total;
        overdue.count++;
      }
    } else if (b.status === 'paid' && b.paidDate?.slice(0, 7) === month) {
      paidThisMonth.amount += total;
      paidThisMonth.count++;
    }
  }
  return { unpaid, overdue, paidThisMonth };
}
```

- [ ] **Step 4: Implement draft.ts and validate.ts**

Create `src/domain/draft.ts`:

```ts
import type { Bill, BillLine, Customer, CustomerSnapshot, Service, Settings } from './types';
import { addDays } from './format';

export type DraftBill = Omit<Bill, 'id' | 'number' | 'status' | 'paidDate' | 'createdAt' | 'updatedAt'> & {
  id: string | null;
  number: string | null;
};

const EMPTY_CUSTOMER: CustomerSnapshot = { name: '', address: '', taxId: '', contactPerson: '', email: '', phone: '' };

export function newDraft(settings: Settings, today: string): DraftBill {
  return {
    id: null,
    number: null,
    billDate: today,
    dueDate: addDays(today, settings.defaultPaymentDays),
    customerId: '',
    customer: { ...EMPTY_CUSTOMER },
    lines: [],
    vatRate: settings.defaultVatRate,
  };
}

export function setCustomer(d: DraftBill, c: Customer): DraftBill {
  const { name, address, taxId, contactPerson, email, phone } = c;
  return { ...d, customerId: c.id, customer: { name, address, taxId, contactPerson, email, phone } };
}

export function addServiceLine(d: DraftBill, s: Service): DraftBill {
  const line: BillLine = { nameVi: s.nameVi, nameEn: s.nameEn, unitVi: s.unitVi, unitEn: s.unitEn, qty: 1, unitPrice: s.unitPrice };
  return { ...d, lines: [...d.lines, line] };
}

export function addCustomLine(d: DraftBill): DraftBill {
  const line: BillLine = { nameVi: '', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 0 };
  return { ...d, lines: [...d.lines, line] };
}

export function updateLine(d: DraftBill, index: number, patch: Partial<BillLine>): DraftBill {
  return { ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) };
}

export function removeLine(d: DraftBill, index: number): DraftBill {
  return { ...d, lines: d.lines.filter((_, i) => i !== index) };
}

export function setBillDate(d: DraftBill, billDate: string, paymentDays: number): DraftBill {
  return { ...d, billDate, dueDate: addDays(billDate, paymentDays) };
}

export function draftFromBill(b: Bill): DraftBill {
  return {
    id: b.id, number: b.number, billDate: b.billDate, dueDate: b.dueDate, customerId: b.customerId,
    customer: { ...b.customer }, lines: b.lines.map((l) => ({ ...l })), vatRate: b.vatRate,
  };
}

export function duplicateAsDraft(b: Bill, settings: Settings, today: string): DraftBill {
  return {
    ...draftFromBill(b), id: null, number: null, billDate: today, dueDate: addDays(today, settings.defaultPaymentDays),
  };
}
```

Create `src/domain/validate.ts`:

```ts
import type { BillLine, Settings } from './types';
import type { DraftBill } from './draft';

export interface Blocker {
  message: string;
  target: 'customer' | 'services' | 'settings';
}

export function lineErrors(line: BillLine): string[] {
  const errs: string[] = [];
  if (!line.nameVi.trim()) errs.push('Service name is required');
  if (!Number.isInteger(line.qty) || line.qty < 1) errs.push('Quantity must be a whole number of at least 1');
  if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) errs.push('Unit price must be a whole number of at least 0');
  return errs;
}

export function dateErrors(billDate: string, dueDate: string): string[] {
  return dueDate < billDate ? ['Due date cannot be before the bill date'] : [];
}

export function exportBlockers(d: DraftBill, s: Settings): Blocker[] {
  const out: Blocker[] = [];
  if (!d.customerId || !d.customer.name.trim()) out.push({ message: 'Choose a customer', target: 'customer' });
  if (d.lines.length === 0) out.push({ message: 'Add at least one service line', target: 'services' });
  d.lines.forEach((l, i) => lineErrors(l).forEach((e) => out.push({ message: `Line ${i + 1}: ${e}`, target: 'services' })));
  dateErrors(d.billDate, d.dueDate).forEach((e) => out.push({ message: e, target: 'services' }));
  if (!s.businessName.trim()) out.push({ message: 'Enter your business name in Settings', target: 'settings' });
  if (!s.bankBin) out.push({ message: 'Choose your bank in Settings', target: 'settings' });
  if (!s.accountNumber.trim()) out.push({ message: 'Enter your account number in Settings', target: 'settings' });
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/domain`
Expected: PASS (all domain tests).

- [ ] **Step 6: Commit**

```bash
git add src/domain tests/domain tests/fixtures.ts
git commit -m "feat: bill status rules, home summary, validation and draft helpers"
```

---

### Task 5: IndexedDB storage and bill numbering

**Files:**
- Create: `src/storage/db.ts`, `src/storage/numbering.ts`
- Test: `tests/storage/db.test.ts`, `tests/storage/numbering.test.ts`

**Interfaces:**
- Consumes: types (Task 1)
- Produces:
  - `type AppDb = IDBPDatabase<AppSchema>`; `openAppDb(name?: string): Promise<AppDb>` (default name `'payment-bills'`)
  - `listCustomers(db)`, `putCustomer(db, c: Customer)`, `deleteOrArchiveCustomer(db, id: string): Promise<'deleted' | 'archived'>`
  - `listServices(db)`, `putService(db, s: Service)`
  - `listBills(db): Promise<Bill[]>` (newest bill date first, then number descending), `getBill(db, id)`, `putBill(db, b: Bill)`
  - `getSettings(db): Promise<Settings>` (returns `DEFAULT_SETTINGS` merged with stored values), `putSettings(db, s: Settings)`
  - `getMeta<T>(db, key: string): Promise<T | undefined>`, `setMeta(db, key: string, value: unknown)`
  - `newId(): string`
  - `allocateBillNumber(db, prefix: string, billDate: string): Promise<string>`

**Background:** The `meta` store holds `counter-YYYY` → last used number, plus `lastBackupAt` (Task 6). The counter increment happens inside a single `readwrite` transaction, so two quick saves can never get the same number. The counter only increases, which is why numbers are never reused.

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/db.test.ts`:

```ts
import 'fake-indexeddb/auto';
import {
  openAppDb, listCustomers, putCustomer, deleteOrArchiveCustomer, listServices, putService,
  listBills, getBill, putBill, getSettings, putSettings, getMeta, setMeta,
} from '../../src/storage/db';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const freshDb = () => openAppDb(`test-db-${n++}`);
const customer = (id: string) => ({ id, name: `C ${id}`, address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false });

describe('storage', () => {
  it('returns default settings until saved, then the saved values', async () => {
    const db = await freshDb();
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai' });
    expect((await getSettings(db)).businessName).toBe('Sao Mai');
  });

  it('stores customers and services', async () => {
    const db = await freshDb();
    await putCustomer(db, customer('c1'));
    await putService(db, { id: 's1', nameVi: 'A', nameEn: '', unitVi: '', unitEn: '', unitPrice: 1, archived: false });
    expect(await listCustomers(db)).toHaveLength(1);
    expect(await listServices(db)).toHaveLength(1);
  });

  it('deletes an unused customer but archives one used on a bill', async () => {
    const db = await freshDb();
    await putCustomer(db, customer('c1'));
    await putCustomer(db, customer('c2'));
    await putBill(db, sampleBill({ customerId: 'c2' }));
    expect(await deleteOrArchiveCustomer(db, 'c1')).toBe('deleted');
    expect(await deleteOrArchiveCustomer(db, 'c2')).toBe('archived');
    const left = await listCustomers(db);
    expect(left).toHaveLength(1);
    expect(left[0].archived).toBe(true);
  });

  it('lists bills newest first', async () => {
    const db = await freshDb();
    await putBill(db, sampleBill({ id: 'a', number: 'TT-2026-0001', billDate: '2026-09-01' }));
    await putBill(db, sampleBill({ id: 'b', number: 'TT-2026-0003', billDate: '2026-09-20' }));
    await putBill(db, sampleBill({ id: 'c', number: 'TT-2026-0002', billDate: '2026-09-20' }));
    expect((await listBills(db)).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect((await getBill(db, 'a'))?.number).toBe('TT-2026-0001');
  });

  it('stores meta values', async () => {
    const db = await freshDb();
    expect(await getMeta(db, 'lastBackupAt')).toBeUndefined();
    await setMeta(db, 'lastBackupAt', '2026-09-25T00:00:00.000Z');
    expect(await getMeta(db, 'lastBackupAt')).toBe('2026-09-25T00:00:00.000Z');
  });
});
```

Create `tests/storage/numbering.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/storage/db';
import { allocateBillNumber } from '../../src/storage/numbering';

let n = 0;
const freshDb = () => openAppDb(`num-db-${n++}`);

describe('allocateBillNumber', () => {
  it('counts up per year with 4-digit padding', async () => {
    const db = await freshDb();
    expect(await allocateBillNumber(db, 'TT', '2026-09-25')).toBe('TT-2026-0001');
    expect(await allocateBillNumber(db, 'TT', '2026-12-31')).toBe('TT-2026-0002');
  });
  it('restarts at 0001 for a new year based on the bill date, not today', async () => {
    const db = await freshDb();
    await allocateBillNumber(db, 'TT', '2026-12-30');
    expect(await allocateBillNumber(db, 'TT', '2027-01-02')).toBe('TT-2027-0001');
    expect(await allocateBillNumber(db, 'TT', '2026-12-31')).toBe('TT-2026-0002');
  });
  it('never hands out the same number twice, even when called concurrently', async () => {
    const db = await freshDb();
    const nums = await Promise.all(Array.from({ length: 10 }, () => allocateBillNumber(db, 'TT', '2026-01-01')));
    expect(new Set(nums).size).toBe(10);
  });
  it('uses the current prefix', async () => {
    const db = await freshDb();
    expect(await allocateBillNumber(db, 'SM', '2026-01-01')).toBe('SM-2026-0001');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/storage`
Expected: FAIL, cannot resolve `../../src/storage/db`.

- [ ] **Step 3: Implement db.ts and numbering.ts**

Create `src/storage/db.ts`:

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Bill, type Customer, type Service, type Settings } from '../domain/types';

export interface AppSchema extends DBSchema {
  customers: { key: string; value: Customer };
  services: { key: string; value: Service };
  bills: { key: string; value: Bill; indexes: { byCustomer: string } };
  settings: { key: string; value: Settings };
  meta: { key: string; value: unknown };
}

export type AppDb = IDBPDatabase<AppSchema>;

export function openAppDb(name = 'payment-bills'): Promise<AppDb> {
  return openDB<AppSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('customers', { keyPath: 'id' });
      db.createObjectStore('services', { keyPath: 'id' });
      const bills = db.createObjectStore('bills', { keyPath: 'id' });
      bills.createIndex('byCustomer', 'customerId');
      db.createObjectStore('settings');
      db.createObjectStore('meta');
    },
  });
}

export const newId = (): string => crypto.randomUUID();

export const listCustomers = (db: AppDb) => db.getAll('customers');
export const putCustomer = (db: AppDb, c: Customer) => db.put('customers', c);

export async function deleteOrArchiveCustomer(db: AppDb, id: string): Promise<'deleted' | 'archived'> {
  const tx = db.transaction(['customers', 'bills'], 'readwrite');
  const used = (await tx.objectStore('bills').index('byCustomer').count(id)) > 0;
  const store = tx.objectStore('customers');
  if (used) {
    const c = await store.get(id);
    if (c) await store.put({ ...c, archived: true });
  } else {
    await store.delete(id);
  }
  await tx.done;
  return used ? 'archived' : 'deleted';
}

export const listServices = (db: AppDb) => db.getAll('services');
export const putService = (db: AppDb, s: Service) => db.put('services', s);

export async function listBills(db: AppDb): Promise<Bill[]> {
  const all = await db.getAll('bills');
  return all.sort((a, b) => b.billDate.localeCompare(a.billDate) || b.number.localeCompare(a.number));
}
export const getBill = (db: AppDb, id: string) => db.get('bills', id);
export const putBill = (db: AppDb, b: Bill) => db.put('bills', b);

export async function getSettings(db: AppDb): Promise<Settings> {
  const stored = await db.get('settings', 'settings');
  return { ...DEFAULT_SETTINGS, ...stored };
}
export const putSettings = (db: AppDb, s: Settings) => db.put('settings', s, 'settings');

export async function getMeta<T>(db: AppDb, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}
export const setMeta = (db: AppDb, key: string, value: unknown) => db.put('meta', value, key);
```

Create `src/storage/numbering.ts`:

```ts
import type { AppDb } from './db';

export async function allocateBillNumber(db: AppDb, prefix: string, billDate: string): Promise<string> {
  const year = billDate.slice(0, 4);
  const key = `counter-${year}`;
  const tx = db.transaction('meta', 'readwrite');
  const next = (((await tx.store.get(key)) as number | undefined) ?? 0) + 1;
  await tx.store.put(next, key);
  await tx.done;
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/storage`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage tests/storage
git commit -m "feat: IndexedDB storage and per-year bill numbering"
```

---

### Task 6: Backup and restore

**Files:**
- Create: `src/storage/backup.ts`
- Test: `tests/storage/backup.test.ts`

**Interfaces:**
- Consumes: `AppDb`, `openAppDb`, the CRUD helpers and `getMeta`/`setMeta` (Task 5); types (Task 1)
- Produces:
  - `interface BackupData { app: 'payment-bills'; schemaVersion: 1; exportedAt: string; customers: Customer[]; services: Service[]; bills: Bill[]; settings: Settings; counters: Record<string, number> }`
  - `exportAll(db: AppDb, nowIso: string): Promise<BackupData>`
  - `parseBackup(text: string): { ok: true; data: BackupData; summary: string } | { ok: false; error: string }`
  - `restoreAll(db: AppDb, data: BackupData): Promise<void>` (replaces everything in one transaction; keeps `lastBackupAt`)
  - `backupFileName(nowIso: string): string` → `payment-bills-backup-2026-09-25.json`
  - `markBackedUp(db, nowIso)`, `lastBackupAt(db): Promise<string | null>`, `needsBackupReminder(last: string | null, nowIso: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/backup.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { openAppDb, putCustomer, putBill, putSettings, listBills, listCustomers, getSettings } from '../../src/storage/db';
import { allocateBillNumber } from '../../src/storage/numbering';
import {
  exportAll, parseBackup, restoreAll, needsBackupReminder, backupFileName, markBackedUp, lastBackupAt,
} from '../../src/storage/backup';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

let n = 0;
const freshDb = () => openAppDb(`backup-db-${n++}`);
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };

async function seeded() {
  const db = await freshDb();
  await putCustomer(db, customer);
  await putBill(db, sampleBill());
  await putSettings(db, { ...DEFAULT_SETTINGS, businessName: 'Sao Mai' });
  await allocateBillNumber(db, 'TT', '2026-09-25');
  return db;
}

describe('backup round trip', () => {
  it('restores identical data into an empty database, including counters', async () => {
    const src = await seeded();
    const text = JSON.stringify(await exportAll(src, '2026-09-25T10:00:00.000Z'));
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.summary).toBe('1 bills, 1 customers, 0 services');

    const dst = await freshDb();
    await restoreAll(dst, parsed.data);
    expect(await listBills(dst)).toEqual(await listBills(src));
    expect(await listCustomers(dst)).toEqual(await listCustomers(src));
    expect(await getSettings(dst)).toEqual(await getSettings(src));
    expect(await allocateBillNumber(dst, 'TT', '2026-10-01')).toBe('TT-2026-0002');
  });

  it('replaces existing data rather than merging', async () => {
    const dst = await seeded();
    const empty = await freshDb();
    const parsed = parseBackup(JSON.stringify(await exportAll(empty, 'x')));
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreAll(dst, parsed.data);
    expect(await listBills(dst)).toEqual([]);
  });
});

describe('parseBackup rejects bad files', () => {
  it.each([
    ['not json', 'hello'],
    ['another app', JSON.stringify({ app: 'other', schemaVersion: 1 })],
    ['newer schema', JSON.stringify({ app: 'payment-bills', schemaVersion: 2 })],
    ['missing arrays', JSON.stringify({ app: 'payment-bills', schemaVersion: 1, settings: {} })],
    [
      'bill without lines',
      JSON.stringify({
        app: 'payment-bills', schemaVersion: 1, exportedAt: 'x', customers: [], services: [], settings: {}, counters: {},
        bills: [{ id: 'b', number: 'TT-2026-0001', status: 'sent', billDate: '2026-01-01', dueDate: '2026-01-02' }],
      }),
    ],
  ])('%s', (_label, text) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
  });

  it('leaves current data untouched when a bad file is rejected', async () => {
    const db = await seeded();
    const r = parseBackup('{"app":"payment-bills","schemaVersion":1}');
    expect(r.ok).toBe(false);
    expect(await listBills(db)).toHaveLength(1);
  });
});

describe('reminder and bookkeeping', () => {
  it('reminds when never backed up or older than 7 days', () => {
    expect(needsBackupReminder(null, '2026-09-25T00:00:00.000Z')).toBe(true);
    expect(needsBackupReminder('2026-09-18T00:00:00.000Z', '2026-09-25T00:00:00.000Z')).toBe(false);
    expect(needsBackupReminder('2026-09-17T23:59:00.000Z', '2026-09-25T00:00:00.000Z')).toBe(true);
  });
  it('names the file by date and records the last backup', async () => {
    expect(backupFileName('2026-09-25T10:00:00.000Z')).toBe('payment-bills-backup-2026-09-25.json');
    const db = await freshDb();
    expect(await lastBackupAt(db)).toBeNull();
    await markBackedUp(db, '2026-09-25T10:00:00.000Z');
    expect(await lastBackupAt(db)).toBe('2026-09-25T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/storage/backup.test.ts`
Expected: FAIL, cannot resolve `../../src/storage/backup`.

- [ ] **Step 3: Implement backup.ts**

Create `src/storage/backup.ts`:

```ts
import type { AppDb } from './db';
import { getMeta, getSettings, setMeta } from './db';
import { DEFAULT_SETTINGS, type Bill, type Customer, type Service, type Settings } from '../domain/types';

export interface BackupData {
  app: 'payment-bills';
  schemaVersion: 1;
  exportedAt: string;
  customers: Customer[];
  services: Service[];
  bills: Bill[];
  settings: Settings;
  counters: Record<string, number>;
}

export async function exportAll(db: AppDb, nowIso: string): Promise<BackupData> {
  const counters: Record<string, number> = {};
  const tx = db.transaction('meta');
  for (const key of await tx.store.getAllKeys()) {
    if (String(key).startsWith('counter-')) counters[String(key)] = (await tx.store.get(key)) as number;
  }
  await tx.done;
  return {
    app: 'payment-bills',
    schemaVersion: 1,
    exportedAt: nowIso,
    customers: await db.getAll('customers'),
    services: await db.getAll('services'),
    bills: await db.getAll('bills'),
    settings: await getSettings(db),
    counters,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const STATUSES = ['draft', 'sent', 'paid', 'cancelled'];

function validBill(b: unknown): boolean {
  return (
    isObj(b) && isStr(b.id) && isStr(b.number) && STATUSES.includes(b.status as string) &&
    isStr(b.billDate) && isStr(b.dueDate) && isStr(b.customerId) && isObj(b.customer) &&
    Array.isArray(b.lines) &&
    b.lines.every((l) => isObj(l) && isStr(l.nameVi) && Number.isInteger(l.qty) && Number.isInteger(l.unitPrice))
  );
}

export function parseBackup(
  text: string,
): { ok: true; data: BackupData; summary: string } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a backup (not valid JSON).' };
  }
  if (!isObj(raw) || raw.app !== 'payment-bills') return { ok: false, error: 'This file is not a payment-bills backup.' };
  if (raw.schemaVersion !== 1) return { ok: false, error: 'This backup was made by a different version of the app.' };
  if (!Array.isArray(raw.customers) || !Array.isArray(raw.services) || !Array.isArray(raw.bills) || !isObj(raw.settings) || !isObj(raw.counters)) {
    return { ok: false, error: 'The backup file is incomplete.' };
  }
  if (!raw.customers.every((c) => isObj(c) && isStr(c.id) && isStr(c.name))) return { ok: false, error: 'A customer in the backup is damaged.' };
  if (!raw.services.every((s) => isObj(s) && isStr(s.id) && isStr(s.nameVi))) return { ok: false, error: 'A service in the backup is damaged.' };
  const badBill = raw.bills.findIndex((b) => !validBill(b));
  if (badBill >= 0) return { ok: false, error: `Bill ${badBill + 1} in the backup is damaged.` };

  const data = { ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings } } as unknown as BackupData;
  return {
    ok: true,
    data,
    summary: `${data.bills.length} bills, ${data.customers.length} customers, ${data.services.length} services`,
  };
}

export async function restoreAll(db: AppDb, data: BackupData): Promise<void> {
  const tx = db.transaction(['customers', 'services', 'bills', 'settings', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  const keepLastBackup = await meta.get('lastBackupAt');
  await Promise.all([
    tx.objectStore('customers').clear(),
    tx.objectStore('services').clear(),
    tx.objectStore('bills').clear(),
    tx.objectStore('settings').clear(),
    meta.clear(),
  ]);
  for (const c of data.customers) await tx.objectStore('customers').put(c);
  for (const s of data.services) await tx.objectStore('services').put(s);
  for (const b of data.bills) await tx.objectStore('bills').put(b);
  await tx.objectStore('settings').put(data.settings, 'settings');
  for (const [k, v] of Object.entries(data.counters)) await meta.put(v, k);
  if (keepLastBackup !== undefined) await meta.put(keepLastBackup, 'lastBackupAt');
  await tx.done;
}

export const backupFileName = (nowIso: string) => `payment-bills-backup-${nowIso.slice(0, 10)}.json`;

export const markBackedUp = (db: AppDb, nowIso: string) => setMeta(db, 'lastBackupAt', nowIso);

export async function lastBackupAt(db: AppDb): Promise<string | null> {
  return (await getMeta<string>(db, 'lastBackupAt')) ?? null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export function needsBackupReminder(last: string | null, nowIso: string): boolean {
  return last === null || Date.parse(nowIso) - Date.parse(last) > SEVEN_DAYS_MS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/storage/backup.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/backup.ts tests/storage/backup.test.ts
git commit -m "feat: validated backup export and restore"
```

---

### Task 7: Bill page (A4, style A), QR hook and printing

**Files:**
- Create: `src/ui/BillPage.tsx`, `src/ui/bill-page.css`, `src/ui/useQrDataUrl.ts`, `src/ui/print.ts`
- Test: `tests/ui/BillPage.test.tsx`

**Interfaces:**
- Consumes: `computeTotals`, `formatVnd`, `formatDateVn`, `pdfFileName` (Task 1); `vndToWordsVi`, `vndToWordsEn` (Task 2); `buildVietQrPayload`, `paymentReference`, `bankByBin` (Task 3); `DraftBill` (Task 4)
- Produces:
  - `<BillPage bill={DraftBill} settings={Settings} qrDataUrl={string | null} />`, which renders `<div class="bill-sheet">…</div>`. A draft without a number shows "(chưa đánh số / not numbered)".
  - `billQrPayload(bill: DraftBill, settings: Settings): string | null` (null when the number or bank details are missing)
  - `useQrDataUrl(payload: string | null): string | null`, `qrToDataUrl(payload: string): Promise<string>`
  - `printBill(fileTitle: string): void`

**Background:** The page is laid out like the chosen mockup `docs/superpowers/specs/mockups/bill-style.html`, option A. Open that file in a browser for reference. The print CSS hides everything except `.bill-sheet` and sets A4 margins. The table header repeats on each page (`thead { display: table-header-group }`), and the ending block (words, QR and signatures) must not split (`break-inside: avoid`).

- [ ] **Step 1: Write the failing test**

Create `tests/ui/BillPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/preact';
import { BillPage, billQrPayload } from '../../src/ui/BillPage';
import { draftFromBill } from '../../src/domain/draft';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/types';
import { sampleBill } from '../fixtures';

const settings: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH THIẾT KẾ SAO MAI', taxId: '0312345678',
  bankBin: '970436', accountNumber: '0071000123456', accountHolder: 'CONG TY TNHH THIET KE SAO MAI', preparedBy: 'Nguyễn Văn An',
};

const bill = draftFromBill(
  sampleBill({
    lines: [
      { nameVi: 'Thiết kế logo', nameEn: 'Logo design', unitVi: '', unitEn: '', qty: 1, unitPrice: 5000000 },
      { nameVi: 'Website gói cơ bản', nameEn: 'Basic website', unitVi: '', unitEn: '', qty: 1, unitPrice: 12000000 },
      { nameVi: 'Bảo trì website', nameEn: 'Maintenance', unitVi: 'tháng', unitEn: 'month', qty: 3, unitPrice: 800000 },
    ],
  }),
);

describe('BillPage', () => {
  it('renders the bilingual title, number, customer, lines and totals', () => {
    render(<BillPage bill={bill} settings={settings} qrDataUrl="data:image/png;base64,xx" />);
    expect(screen.getByText('PHIẾU THANH TOÁN')).toBeTruthy();
    expect(screen.getByText('PAYMENT REQUEST')).toBeTruthy();
    expect(screen.getByText('TT-2026-0012')).toBeTruthy();
    expect(screen.getByText('Công ty CP Hoa Sen Xanh')).toBeTruthy();
    expect(screen.getByText('Bảo trì website')).toBeTruthy();
    expect(screen.getByText('2.400.000')).toBeTruthy();
    expect(screen.getByText('1.552.000')).toBeTruthy();
    expect(screen.getByText('20.952.000')).toBeTruthy();
    expect(screen.getByText('Hai mươi triệu chín trăm năm mươi hai nghìn đồng.')).toBeTruthy();
    expect(screen.getByText('Twenty million nine hundred fifty-two thousand dong.')).toBeTruthy();
    expect(screen.getByText('TT20260012')).toBeTruthy();
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
    expect(screen.getByAltText('VietQR')).toBeTruthy();
  });

  it('omits the VAT row when VAT is not applicable', () => {
    render(<BillPage bill={{ ...bill, vatRate: 'none' }} settings={settings} qrDataUrl={null} />);
    expect(screen.queryByText(/Thuế GTGT/)).toBeNull();
  });

  it('marks an unnumbered draft', () => {
    render(<BillPage bill={{ ...bill, number: null }} settings={settings} qrDataUrl={null} />);
    expect(screen.getByText('(chưa đánh số / not numbered)')).toBeTruthy();
  });
});

describe('billQrPayload', () => {
  it('uses the bill total and reference', () => {
    expect(billQrPayload(bill, settings)).toContain('540820952000');
    expect(billQrPayload(bill, settings)).toContain('0810TT20260012');
  });
  it('is null without a number or bank details', () => {
    expect(billQrPayload({ ...bill, number: null }, settings)).toBeNull();
    expect(billQrPayload(bill, { ...settings, bankBin: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui`
Expected: FAIL, cannot resolve `../../src/ui/BillPage`.

- [ ] **Step 3: Implement BillPage.tsx, bill-page.css, useQrDataUrl.ts and print.ts**

Create `src/ui/BillPage.tsx`:

```tsx
import './bill-page.css';
import type { Settings } from '../domain/types';
import type { DraftBill } from '../domain/draft';
import { computeTotals } from '../domain/money';
import { formatDateVn, formatVnd } from '../domain/format';
import { vndToWordsEn, vndToWordsVi } from '../domain/words';
import { buildVietQrPayload, paymentReference } from '../domain/vietqr';
import { bankByBin } from '../domain/banks';

export function billQrPayload(bill: DraftBill, s: Settings): string | null {
  if (!bill.number || !s.bankBin || !s.accountNumber.trim()) return null;
  try {
    return buildVietQrPayload({
      bankBin: s.bankBin,
      accountNumber: s.accountNumber,
      amount: computeTotals(bill.lines, bill.vatRate).total,
      reference: paymentReference(bill.number),
    });
  } catch {
    return null;
  }
}

const En = ({ children }: { children: string }) => <span class="en">{children}</span>;

export function BillPage({ bill, settings: s, qrDataUrl }: { bill: DraftBill; settings: Settings; qrDataUrl: string | null }) {
  const t = computeTotals(bill.lines, bill.vatRate);
  const bank = bankByBin(s.bankBin);
  const c = bill.customer;
  return (
    <div class="bill-sheet">
      <header class="bill-head">
        <div class="bill-biz">
          {s.logoDataUrl && <img class="bill-logo" src={s.logoDataUrl} alt="" />}
          <div>
            <b>{s.businessName}</b>
            {s.taxId && <div>MST / Tax ID: {s.taxId}</div>}
            {s.address && <div>{s.address}</div>}
            {(s.phone || s.email) && <div>{[s.phone, s.email].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
        <div class="bill-meta">
          <div>Số <En>/ No.:</En> {bill.number ? <b>{bill.number}</b> : <i>(chưa đánh số / not numbered)</i>}</div>
          <div>Ngày <En>/ Date:</En> {formatDateVn(bill.billDate)}</div>
        </div>
      </header>

      <h1 class="bill-title">PHIẾU THANH TOÁN</h1>
      <div class="bill-subtitle">PAYMENT REQUEST</div>

      <section class="bill-to">
        <div>Kính gửi <En>/ To:</En> <b>{c.name}</b></div>
        {c.address && <div>Địa chỉ <En>/ Address:</En> {c.address}</div>}
        {c.taxId && <div>MST <En>/ Tax ID:</En> {c.taxId}</div>}
        {c.contactPerson && <div>Người liên hệ <En>/ Attn:</En> {c.contactPerson}</div>}
      </section>

      <table class="bill-table">
        <thead>
          <tr>
            <th>STT<br /><En>No.</En></th>
            <th>Nội dung dịch vụ<br /><En>Service</En></th>
            <th>ĐVT<br /><En>Unit</En></th>
            <th class="r">SL<br /><En>Qty</En></th>
            <th class="r">Đơn giá<br /><En>Unit price</En></th>
            <th class="r">Thành tiền<br /><En>Amount</En></th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><span>{l.nameVi}</span>{l.nameEn && <><br /><En>{l.nameEn}</En></>}</td>
              <td>{l.unitVi}{l.unitEn && <><br /><En>{l.unitEn}</En></>}</td>
              <td class="r">{l.qty}</td>
              <td class="r">{formatVnd(l.unitPrice)}</td>
              <td class="r">{formatVnd(t.lineAmounts[i])}</td>
            </tr>
          ))}
          <tr><td colSpan={5} class="r">Cộng <En>/ Subtotal</En></td><td class="r">{formatVnd(t.subtotal)}</td></tr>
          {t.vatApplies && (
            <tr><td colSpan={5} class="r">Thuế GTGT {bill.vatRate}% <En>{`/ VAT ${bill.vatRate}%`}</En></td><td class="r">{formatVnd(t.vat)}</td></tr>
          )}
          <tr class="bill-total"><td colSpan={5} class="r">Tổng cộng <En>/ Total (VND)</En></td><td class="r">{formatVnd(t.total)}</td></tr>
        </tbody>
      </table>

      <div class="bill-end">
        <p>
          Bằng chữ <En>/ In words:</En> <i>{vndToWordsVi(t.total)}</i>
          <br />
          <En>{vndToWordsEn(t.total)}</En>
        </p>
        <p>Hạn thanh toán <En>/ Due date:</En> <b>{formatDateVn(bill.dueDate)}</b></p>
        <div class="bill-pay">
          {qrDataUrl && <img class="bill-qr" src={qrDataUrl} alt="VietQR" />}
          <div>
            <div><b>Thông tin chuyển khoản</b> <En>/ Bank transfer</En></div>
            <div>Ngân hàng <En>/ Bank:</En> {bank ? `${bank.shortName} – ${bank.name}` : ''}</div>
            <div>Số tài khoản <En>/ Account:</En> <b>{s.accountNumber}</b></div>
            {s.accountHolder && <div>Chủ tài khoản <En>/ Holder:</En> {s.accountHolder}</div>}
            {bill.number && <div>Nội dung <En>/ Reference:</En> <b>{paymentReference(bill.number)}</b></div>}
          </div>
        </div>
        <div class="bill-sign">
          <div><b>Người lập phiếu</b><br /><En>Prepared by</En><div class="bill-sign-space" /><div>{s.preparedBy}</div></div>
          <div><b>Khách hàng</b><br /><En>Customer</En><div class="bill-sign-space" /></div>
        </div>
        {s.footerNote && <p class="bill-footer">{s.footerNote}</p>}
      </div>
    </div>
  );
}
```

Create `src/ui/bill-page.css`:

```css
.bill-sheet { background: #fff; color: #111; width: 210mm; min-height: 297mm; padding: 16mm 15mm; box-sizing: border-box;
  font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.4; margin: 0 auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); }
.bill-sheet .en { color: #666; font-style: italic; }
.bill-head { display: flex; justify-content: space-between; gap: 16px; }
.bill-biz { display: flex; gap: 10px; }
.bill-logo { max-height: 48px; max-width: 120px; object-fit: contain; }
.bill-meta { text-align: right; white-space: nowrap; }
.bill-title { text-align: center; font-size: 18pt; margin: 18px 0 0; letter-spacing: .5px; }
.bill-subtitle { text-align: center; font-style: italic; color: #666; margin-bottom: 14px; }
.bill-to { margin-bottom: 10px; }
.bill-table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
.bill-table thead { display: table-header-group; }
.bill-table tr { break-inside: avoid; }
.bill-table th, .bill-table td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; text-align: left; }
.bill-table th { background: #f0f0f0; }
.bill-table .r { text-align: right; }
.bill-total td { font-weight: 700; }
.bill-end { break-inside: avoid; }
.bill-pay { display: flex; gap: 14px; align-items: center; margin: 10px 0; }
.bill-qr { width: 30mm; height: 30mm; image-rendering: pixelated; }
.bill-sign { display: flex; justify-content: space-around; text-align: center; margin-top: 16px; }
.bill-sign > div { width: 40%; }
.bill-sign-space { height: 22mm; }
.bill-footer { margin-top: 18px; font-size: 9pt; color: #555; text-align: center; }

@page { size: A4; margin: 0; }
@media print {
  body * { visibility: hidden; }
  .bill-sheet, .bill-sheet * { visibility: visible; }
  .bill-sheet { position: absolute; left: 0; top: 0; box-shadow: none; margin: 0; }
  .bill-sheet .en, .bill-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
```

Create `src/ui/useQrDataUrl.ts`:

```ts
import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';

export const qrToDataUrl = (payload: string): Promise<string> =>
  QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 360 });

export function useQrDataUrl(payload: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setUrl(null);
      return;
    }
    qrToDataUrl(payload)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [payload]);
  return url;
}
```

Create `src/ui/print.ts`:

```ts
/** Opens the browser print dialog; the chosen PDF name comes from document.title. */
export function printBill(fileTitle: string): void {
  const previous = document.title;
  document.title = fileTitle;
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ui`
Expected: PASS (5 tests). If Vitest complains about importing `.css`, add `css: false` under `test` in `vite.config.ts`; Vitest ignores CSS by default, so this should not be needed.

- [ ] **Step 5: Commit**

```bash
git add src/ui tests/ui
git commit -m "feat: A4 bilingual bill page with VietQR and print styles"
```

---

### Task 8: App shell, router, Settings, Customers and Services screens

**Files:**
- Create: `src/router.ts`, `src/app.tsx`, `src/styles.css`, `src/screens/Settings.tsx`, `src/screens/Customers.tsx`, `src/screens/Services.tsx`
- Modify: `src/main.tsx` (replace the stub)
- Test: `tests/router.test.ts`

**Interfaces:**
- Consumes: the storage helpers (Task 5); `getSettings`/`putSettings`; `BANKS` (Task 3); `VAT_RATES` (Task 1)
- Produces:
  - `type Route = { name: 'home' } | { name: 'newBill' } | { name: 'bill'; id: string } | { name: 'editBill'; id: string } | { name: 'duplicateBill'; id: string } | { name: 'customers' } | { name: 'services' } | { name: 'settings' } | { name: 'backup' }`
  - `parseRoute(hash: string): Route`, `routeToHash(r: Route): string`, `navigate(r: Route): void`, `setNavigationGuard(fn: (() => boolean) | null): void`, `useRoute(): Route`
  - `AppContext` giving `{ db: AppDb; settings: Settings; reloadSettings(): Promise<void> }`, and `useApp()`
  - Placeholder screens for home, bill, editor and backup, filled in by Tasks 9–11

- [ ] **Step 1: Write the failing router test**

Create `tests/router.test.ts`:

```ts
import { parseRoute, routeToHash } from '../src/router';

describe('router', () => {
  it.each([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/bills/new', { name: 'newBill' }],
    ['#/bills/abc', { name: 'bill', id: 'abc' }],
    ['#/bills/abc/edit', { name: 'editBill', id: 'abc' }],
    ['#/bills/abc/duplicate', { name: 'duplicateBill', id: 'abc' }],
    ['#/customers', { name: 'customers' }],
    ['#/services', { name: 'services' }],
    ['#/settings', { name: 'settings' }],
    ['#/backup', { name: 'backup' }],
    ['#/nonsense', { name: 'home' }],
  ])('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });
  it('round-trips', () => {
    expect(parseRoute(routeToHash({ name: 'editBill', id: 'x1' }))).toEqual({ name: 'editBill', id: 'x1' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL, cannot resolve `../src/router`.

- [ ] **Step 3: Implement router.ts**

Create `src/router.ts`:

```ts
import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'home' }
  | { name: 'newBill' }
  | { name: 'bill'; id: string }
  | { name: 'editBill'; id: string }
  | { name: 'duplicateBill'; id: string }
  | { name: 'customers' }
  | { name: 'services' }
  | { name: 'settings' }
  | { name: 'backup' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'bills') {
    if (parts[1] === 'new' && parts.length === 2) return { name: 'newBill' };
    if (parts[1] && parts.length === 2) return { name: 'bill', id: parts[1] };
    if (parts[1] && parts[2] === 'edit') return { name: 'editBill', id: parts[1] };
    if (parts[1] && parts[2] === 'duplicate') return { name: 'duplicateBill', id: parts[1] };
  }
  if (parts.length === 1 && ['customers', 'services', 'settings', 'backup'].includes(parts[0])) {
    return { name: parts[0] } as Route;
  }
  return { name: 'home' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'newBill': return '#/bills/new';
    case 'bill': return `#/bills/${r.id}`;
    case 'editBill': return `#/bills/${r.id}/edit`;
    case 'duplicateBill': return `#/bills/${r.id}/duplicate`;
    default: return `#/${r.name}`;
  }
}

let guard: (() => boolean) | null = null;
/** A guard returns true when it is OK to leave the current screen. */
export function setNavigationGuard(fn: (() => boolean) | null): void {
  guard = fn;
}

export function navigate(r: Route): void {
  if (guard && !guard()) return;
  guard = null;
  location.hash = routeToHash(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    let current = location.hash;
    const onChange = () => {
      if (location.hash === current) return;
      if (guard && !guard()) {
        // Browser back/forward with unsaved changes: put the old hash back.
        history.pushState(null, '', current);
        return;
      }
      guard = null;
      current = location.hash;
      setRoute(parseRoute(current));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
```

Run: `npx vitest run tests/router.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 4: Create the app shell, styles and main.tsx**

Create `src/styles.css`:

```css
:root { --bg: #f5f6f8; --panel: #fff; --text: #1d1d1f; --muted: #666; --border: #d9dce1; --accent: #0f6e56;
  --nav: #1e293b; --danger: #b91c1c; --ok: #166534; font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-size: 14px; }
.layout { display: flex; min-height: 100vh; }
.nav { background: var(--nav); color: #cbd5e1; width: 190px; padding: 16px 10px; flex-shrink: 0; }
.nav h1 { color: #fff; font-size: 15px; margin: 0 0 16px 8px; }
.nav button { display: block; width: 100%; text-align: left; background: none; border: 0; color: inherit; padding: 8px 10px; border-radius: 6px; font: inherit; cursor: pointer; }
.nav button.on, .nav button:hover { background: #334155; color: #fff; }
.main { flex: 1; padding: 24px; min-width: 0; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.page-head h2 { margin: 0; font-size: 20px; }
.btn { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; }
.btn.ghost { background: #fff; color: var(--text); border: 1px solid var(--border); }
.btn.danger { background: var(--danger); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
label.field { display: block; font-size: 12px; color: var(--muted); }
label.field input, label.field select, label.field textarea { display: block; width: 100%; margin-top: 4px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; font: inherit; color: var(--text); background: #fff; }
table.list { width: 100%; border-collapse: collapse; background: #fff; }
table.list th { text-align: left; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); padding: 8px; }
table.list td { border-bottom: 1px solid #eef0f3; padding: 9px 8px; }
table.list tr.click { cursor: pointer; }
table.list tr.click:hover { background: #f8fafc; }
.r { text-align: right; }
.badge { border-radius: 10px; padding: 2px 9px; font-size: 12px; font-weight: 600; }
.badge.draft { background: #f1f5f9; color: #475569; } .badge.sent { background: #dbeafe; color: #1e40af; }
.badge.paid { background: #dcfce7; color: var(--ok); } .badge.overdue { background: #fee2e2; color: #991b1b; }
.badge.cancelled { background: #f1f5f9; color: #94a3b8; text-decoration: line-through; }
.banner { background: #fff7e6; border: 1px solid #f5d38a; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.errors { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.errors button { background: none; border: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
.muted { color: var(--muted); }
.preview-wrap { overflow-x: auto; padding: 12px 0; }
@media (max-width: 720px) { .layout { flex-direction: column; } .nav { width: auto; display: flex; flex-wrap: wrap; } .nav h1 { width: 100%; } .nav button { width: auto; } }
@media print { .nav, .no-print { display: none !important; } .main { padding: 0; } }
```

Create `src/app.tsx`:

```tsx
import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { AppDb } from './storage/db';
import { getSettings } from './storage/db';
import type { Settings } from './domain/types';
import { navigate, useRoute, type Route } from './router';
import { Home } from './screens/Home';
import { BillView } from './screens/BillView';
import { Editor } from './screens/Editor';
import { Customers } from './screens/Customers';
import { Services } from './screens/Services';
import { SettingsScreen } from './screens/Settings';
import { BackupScreen } from './screens/Backup';

interface AppCtx {
  db: AppDb;
  settings: Settings;
  reloadSettings(): Promise<void>;
}
const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => useContext(Ctx)!;

const NAV: { label: string; route: Route; match: Route['name'][] }[] = [
  { label: 'Bills', route: { name: 'home' }, match: ['home', 'bill', 'newBill', 'editBill', 'duplicateBill'] },
  { label: 'Customers', route: { name: 'customers' }, match: ['customers'] },
  { label: 'Services', route: { name: 'services' }, match: ['services'] },
  { label: 'Settings', route: { name: 'settings' }, match: ['settings'] },
  { label: 'Backup / Restore', route: { name: 'backup' }, match: ['backup'] },
];

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home': return <Home />;
    case 'bill': return <BillView id={route.id} />;
    case 'newBill': return <Editor key="new" mode={{ kind: 'new' }} />;
    case 'editBill': return <Editor key={`e-${route.id}`} mode={{ kind: 'edit', id: route.id }} />;
    case 'duplicateBill': return <Editor key={`d-${route.id}`} mode={{ kind: 'duplicate', id: route.id }} />;
    case 'customers': return <Customers />;
    case 'services': return <Services />;
    case 'settings': return <SettingsScreen />;
    case 'backup': return <BackupScreen />;
  }
}

export function App({ db, initialSettings }: { db: AppDb; initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const route = useRoute();
  const reloadSettings = async () => setSettings(await getSettings(db));
  return (
    <Ctx.Provider value={{ db, settings, reloadSettings }}>
      <div class="layout">
        <nav class="nav">
          <h1>Phiếu thanh toán</h1>
          {NAV.map((n) => (
            <button key={n.label} class={n.match.includes(route.name) ? 'on' : ''} onClick={() => navigate(n.route)}>
              {n.label}
            </button>
          ))}
        </nav>
        <main class="main">
          <Screen route={route} />
        </main>
      </div>
    </Ctx.Provider>
  );
}
```

Replace `src/main.tsx`:

```tsx
import { render } from 'preact';
import './styles.css';
import { App } from './app';
import { openAppDb, getSettings } from './storage/db';

async function boot() {
  const root = document.getElementById('app')!;
  try {
    const db = await openAppDb();
    const settings = await getSettings(db);
    navigator.storage?.persist?.().catch(() => undefined);
    render(<App db={db} initialSettings={settings} />, root);
  } catch (e) {
    render(
      <div style="max-width:560px;margin:60px auto;font-family:system-ui;padding:0 16px">
        <h2>Cannot open your saved data</h2>
        <p>The browser did not allow this app to store data ({String(e)}).</p>
        <p>Open the app in a normal (not private/incognito) window of Chrome or Edge. If this keeps happening, restore from your latest backup file.</p>
      </div>,
      root,
    );
  }
}
boot();
```

Create temporary placeholders so the app compiles. Tasks 9–11 replace them. Create each file with this content, changing the component name and heading each time:

`src/screens/Home.tsx`:
```tsx
export function Home() { return <h2>Bills</h2>; }
```
`src/screens/BillView.tsx`:
```tsx
export function BillView({ id }: { id: string }) { return <h2>Bill {id}</h2>; }
```
`src/screens/Editor.tsx`:
```tsx
export type EditorMode = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string };
export function Editor({ mode }: { mode: EditorMode }) { return <h2>Editor ({mode.kind})</h2>; }
```
`src/screens/Backup.tsx`:
```tsx
export function BackupScreen() { return <h2>Backup / Restore</h2>; }
```

- [ ] **Step 5: Implement the Settings screen**

Create `src/screens/Settings.tsx`:

```tsx
import { useState } from 'preact/hooks';
import { useApp } from '../app';
import { putSettings } from '../storage/db';
import { BANKS } from '../domain/banks';
import { VAT_RATES, type Settings, type VatRate } from '../domain/types';

const MAX_LOGO_BYTES = 300 * 1024;

export function SettingsScreen() {
  const { db, settings, reloadSettings } = useApp();
  const [s, setS] = useState<Settings>(settings);
  const [msg, setMsg] = useState('');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS({ ...s, [k]: v }); setMsg(''); };
  const text = (k: keyof Settings, label: string) => (
    <label class="field">{label}
      <input value={s[k] as string} onInput={(e) => set(k, e.currentTarget.value as never)} />
    </label>
  );

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) { setMsg('Logo must be smaller than 300 KB.'); return; }
    const r = new FileReader();
    r.onload = () => set('logoDataUrl', r.result as string);
    r.readAsDataURL(file);
  };

  const save = async () => {
    if (!/^[A-Za-z0-9]{1,6}$/.test(s.numberPrefix)) { setMsg('Bill number prefix must be 1–6 letters or digits.'); return; }
    if (!Number.isInteger(s.defaultPaymentDays) || s.defaultPaymentDays < 0) { setMsg('Payment days must be a whole number ≥ 0.'); return; }
    try {
      await putSettings(db, s);
      await reloadSettings();
      setMsg('Saved.');
    } catch (e) {
      setMsg(`Could not save: ${String(e)}`);
    }
  };

  return (
    <div>
      <div class="page-head"><h2>Settings</h2><button class="btn" onClick={save}>Save</button></div>
      {msg && <p class={msg === 'Saved.' ? 'muted' : 'errors'}>{msg}</p>}
      <div class="panel"><h3>Your business</h3>
        <div class="grid2">
          {text('businessName', 'Business name (as printed)')}
          {text('taxId', 'Tax ID (MST)')}
          {text('address', 'Address')}
          {text('phone', 'Phone')}
          {text('email', 'Email')}
          {text('preparedBy', '"Prepared by" name')}
          <label class="field">Logo (optional, < 300 KB)
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.currentTarget.files?.[0])} />
          </label>
          {s.logoDataUrl && <div><img src={s.logoDataUrl} alt="" style="max-height:48px" /> <button class="btn ghost" onClick={() => set('logoDataUrl', null)}>Remove logo</button></div>}
        </div>
      </div>
      <div class="panel"><h3>Bank for VietQR</h3>
        <div class="grid2">
          <label class="field">Bank
            <select value={s.bankBin} onChange={(e) => set('bankBin', e.currentTarget.value)}>
              <option value="">— Choose —</option>
              {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.shortName} – {b.name}</option>)}
            </select>
          </label>
          {text('accountNumber', 'Account number')}
          {text('accountHolder', 'Account holder (as the bank shows it)')}
        </div>
      </div>
      <div class="panel"><h3>Bill defaults</h3>
        <div class="grid2">
          {text('numberPrefix', 'Bill number prefix')}
          <label class="field">Default VAT
            <select value={String(s.defaultVatRate)} onChange={(e) => {
              const v = e.currentTarget.value;
              set('defaultVatRate', (v === 'none' ? 'none' : Number(v)) as VatRate);
            }}>
              {VAT_RATES.map((r) => <option key={String(r)} value={String(r)}>{r === 'none' ? 'Not applicable' : `${r}%`}</option>)}
            </select>
          </label>
          <label class="field">Default payment days
            <input type="number" min={0} value={s.defaultPaymentDays} onInput={(e) => set('defaultPaymentDays', Number(e.currentTarget.value))} />
          </label>
        </div>
        <label class="field" style="margin-top:12px">Footer note on bills (leave empty for none)
          <textarea rows={2} value={s.footerNote} onInput={(e) => set('footerNote', e.currentTarget.value)} />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement the Customers and Services screens**

Create `src/screens/Customers.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { deleteOrArchiveCustomer, listCustomers, newId, putCustomer } from '../storage/db';
import type { Customer } from '../domain/types';

export const emptyCustomer = (): Customer => ({
  id: newId(), name: '', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false,
});

/** Shared by this screen and the editor's "add customer inline". */
export function CustomerForm({ value, onSave, onCancel }: { value: Customer; onSave(c: Customer): void; onCancel(): void }) {
  const [c, setC] = useState(value);
  const [err, setErr] = useState('');
  const f = (k: keyof Customer, label: string) => (
    <label class="field">{label}<input value={c[k] as string} onInput={(e) => setC({ ...c, [k]: e.currentTarget.value })} /></label>
  );
  return (
    <div class="panel">
      {err && <p class="errors">{err}</p>}
      <div class="grid2">
        {f('name', 'Name *')}{f('taxId', 'Tax ID (MST)')}{f('address', 'Address')}
        {f('contactPerson', 'Contact person')}{f('email', 'Email')}{f('phone', 'Phone')}
      </div>
      <p>
        <button class="btn" onClick={() => (c.name.trim() ? onSave({ ...c, name: c.name.trim() }) : setErr('Name is required.'))}>Save customer</button>{' '}
        <button class="btn ghost" onClick={onCancel}>Cancel</button>
      </p>
    </div>
  );
}

export function Customers() {
  const { db } = useApp();
  const [items, setItems] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const load = async () => setItems((await listCustomers(db)).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
  useEffect(() => { load(); }, []);

  const save = async (c: Customer) => { await putCustomer(db, c); setEditing(null); load(); };
  const remove = async (c: Customer) => {
    if (!confirm(`Delete ${c.name}?`)) return;
    const r = await deleteOrArchiveCustomer(db, c.id);
    if (r === 'archived') alert(`${c.name} is used on bills, so it was archived instead of deleted.`);
    load();
  };

  const shown = items.filter((c) => showArchived || !c.archived);
  return (
    <div>
      <div class="page-head"><h2>Customers</h2><button class="btn" onClick={() => setEditing(emptyCustomer())}>+ New customer</button></div>
      {editing && <CustomerForm key={editing.id} value={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <label class="muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} /> Show archived</label>
      <table class="list">
        <thead><tr><th>Name</th><th>Tax ID</th><th>Contact</th><th /></tr></thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td>{c.name}{c.archived && <span class="muted"> (archived)</span>}</td>
              <td>{c.taxId}</td>
              <td>{[c.contactPerson, c.phone, c.email].filter(Boolean).join(' · ')}</td>
              <td class="r">
                <button class="btn ghost" onClick={() => setEditing(c)}>Edit</button>{' '}
                {c.archived
                  ? <button class="btn ghost" onClick={() => save({ ...c, archived: false })}>Unarchive</button>
                  : <button class="btn ghost" onClick={() => remove(c)}>Delete</button>}
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} class="muted">No customers yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

Create `src/screens/Services.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { listServices, newId, putService } from '../storage/db';
import type { Service } from '../domain/types';
import { formatVnd } from '../domain/format';

const emptyService = (): Service => ({ id: newId(), nameVi: '', nameEn: '', unitVi: '', unitEn: '', unitPrice: 0, archived: false });

function ServiceForm({ value, onSave, onCancel }: { value: Service; onSave(s: Service): void; onCancel(): void }) {
  const [s, setS] = useState(value);
  const [err, setErr] = useState('');
  const f = (k: 'nameVi' | 'nameEn' | 'unitVi' | 'unitEn', label: string) => (
    <label class="field">{label}<input value={s[k]} onInput={(e) => setS({ ...s, [k]: e.currentTarget.value })} /></label>
  );
  const save = () => {
    if (!s.nameVi.trim()) return setErr('Vietnamese name is required.');
    if (!Number.isInteger(s.unitPrice) || s.unitPrice < 0) return setErr('Price must be a whole number ≥ 0.');
    onSave({ ...s, nameVi: s.nameVi.trim(), nameEn: s.nameEn.trim() });
  };
  return (
    <div class="panel">
      {err && <p class="errors">{err}</p>}
      <div class="grid2">
        {f('nameVi', 'Name (Vietnamese) *')}{f('nameEn', 'Name (English)')}
        {f('unitVi', 'Unit (Vietnamese), e.g. tháng')}{f('unitEn', 'Unit (English), e.g. month')}
        <label class="field">Default unit price (VND)
          <input type="number" min={0} step={1000} value={s.unitPrice} onInput={(e) => setS({ ...s, unitPrice: Number(e.currentTarget.value) })} />
        </label>
      </div>
      <p><button class="btn" onClick={save}>Save service</button> <button class="btn ghost" onClick={onCancel}>Cancel</button></p>
    </div>
  );
}

export function Services() {
  const { db } = useApp();
  const [items, setItems] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const load = async () => setItems((await listServices(db)).sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')));
  useEffect(() => { load(); }, []);
  const save = async (s: Service) => { await putService(db, s); setEditing(null); load(); };
  const shown = items.filter((s) => showArchived || !s.archived);
  return (
    <div>
      <div class="page-head"><h2>Services</h2><button class="btn" onClick={() => setEditing(emptyService())}>+ New service</button></div>
      {editing && <ServiceForm key={editing.id} value={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <label class="muted"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} /> Show archived</label>
      <table class="list">
        <thead><tr><th>Service</th><th>Unit</th><th class="r">Price</th><th /></tr></thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.id}>
              <td>{s.nameVi}{s.nameEn && <span class="muted"> / {s.nameEn}</span>}{s.archived && <span class="muted"> (archived)</span>}</td>
              <td>{[s.unitVi, s.unitEn].filter(Boolean).join(' / ')}</td>
              <td class="r">{formatVnd(s.unitPrice)}</td>
              <td class="r">
                <button class="btn ghost" onClick={() => setEditing(s)}>Edit</button>{' '}
                <button class="btn ghost" onClick={() => save({ ...s, archived: !s.archived })}>{s.archived ? 'Unarchive' : 'Archive'}</button>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} class="muted">No services yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Verify the build and run it by hand**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc` reports no errors; Vite writes `dist/`.

Run: `npm run dev` and open the printed URL. Check: the left menu switches screens; Settings saves and survives a page reload; you can add, edit and delete customers; you can add, edit and archive services, and reloading keeps them.

- [ ] **Step 8: Commit**

```bash
git add src tests/router.test.ts
git commit -m "feat: app shell, routing, settings, customers and services screens"
```

---

### Task 9: Three-step bill editor

**Files:**
- Modify: `src/screens/Editor.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `DraftBill` and its helpers, `exportBlockers`, `lineErrors`, `dateErrors` (Task 4); `computeTotals`, `formatVnd`, `todayIso`, `pdfFileName` (Task 1); `listCustomers`, `putCustomer`, `listServices`, `getBill`, `putBill`, `newId` (Task 5); `allocateBillNumber` (Task 5); `BillPage`, `billQrPayload`, `useQrDataUrl`, `qrToDataUrl`, `printBill` (Task 7); `CustomerForm`, `emptyCustomer` (Task 8); `navigate`, `setNavigationGuard` (Task 8); `useApp` (Task 8)
- Produces: `Editor({ mode: EditorMode })` with `EditorMode = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string }`; `saveDraftBill(db, draft, settings, status): Promise<Bill>` (exported for BillView reuse)

**Behaviour to implement (from the spec):**
- Step 1 · Customer: search a list of non-archived customers and click one to select it. "+ New customer" shows the `CustomerForm` inline; saving it stores the customer and selects it.
- Step 2 · Services: a "From saved services" dropdown adds a line; "+ Custom line" adds an empty line. Each line has editable fields (Vietnamese name, English name, Vietnamese unit, English unit, qty, unit price) and a remove button. Bill-level controls: VAT rate, bill date (changing it moves the due date by the default payment days), and due date. Running subtotal, VAT and total are shown, with line errors under each line.
- Step 3 · Review & export: blockers from `exportBlockers`, each with a button to go to the step or the Settings page. The `BillPage` preview. **Save draft** saves (assigning a number on first save) and returns to Home. **Save & export PDF** is disabled while there are blockers; it saves with status `sent`, prints, then goes to the bill's view.
- The Back/Next buttons move between steps. Next is always allowed; blockers only stop export.
- Unsaved changes: the navigation guard and a `beforeunload` handler are active while the draft differs from its last saved state.
- Edit mode on a non-draft bill redirects to the bill view (locked).

- [ ] **Step 1: Implement Editor.tsx**

Replace `src/screens/Editor.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate, setNavigationGuard } from '../router';
import type { AppDb } from '../storage/db';
import { getBill, listCustomers, listServices, newId, putBill, putCustomer } from '../storage/db';
import { allocateBillNumber } from '../storage/numbering';
import type { Bill, BillStatus, Customer, Service, Settings, VatRate } from '../domain/types';
import { VAT_RATES } from '../domain/types';
import {
  addCustomLine, addServiceLine, draftFromBill, duplicateAsDraft, newDraft, removeLine, setBillDate, setCustomer, updateLine,
  type DraftBill,
} from '../domain/draft';
import { dateErrors, exportBlockers, lineErrors, type Blocker } from '../domain/validate';
import { computeTotals } from '../domain/money';
import { formatVnd, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { qrToDataUrl, useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { CustomerForm, emptyCustomer } from './Customers';

export type EditorMode = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'duplicate'; id: string };
type Step = 1 | 2 | 3;

export async function saveDraftBill(db: AppDb, d: DraftBill, settings: Settings, status: BillStatus): Promise<Bill> {
  const now = new Date().toISOString();
  const existing = d.id ? await getBill(db, d.id) : undefined;
  const bill: Bill = {
    ...d,
    id: d.id ?? newId(),
    number: d.number ?? (await allocateBillNumber(db, settings.numberPrefix, d.billDate)),
    status,
    paidDate: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await putBill(db, bill);
  return bill;
}

export function Editor({ mode }: { mode: EditorMode }) {
  const { db, settings } = useApp();
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [saved, setSaved] = useState('');
  const [step, setStep] = useState<Step>(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState('');
  const [exportQr, setExportQr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCustomers((await listCustomers(db)).filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name, 'vi')));
      setServices((await listServices(db)).filter((s) => !s.archived).sort((a, b) => a.nameVi.localeCompare(b.nameVi, 'vi')));
      let d: DraftBill;
      if (mode.kind === 'new') d = newDraft(settings, todayIso());
      else {
        const b = await getBill(db, mode.id);
        if (!b) return navigate({ name: 'home' });
        if (mode.kind === 'edit' && b.status !== 'draft') return navigate({ name: 'bill', id: b.id });
        d = mode.kind === 'edit' ? draftFromBill(b) : duplicateAsDraft(b, settings, todayIso());
        if (mode.kind === 'duplicate') setStep(2);
      }
      setDraft(d);
      // A duplicate counts as unsaved from the start; a new or edited bill only after a change.
      setSaved(mode.kind === 'duplicate' ? '' : JSON.stringify(d));
    })();
  }, []);

  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  useEffect(() => {
    if (!dirty) {
      setNavigationGuard(null);
      return;
    }
    setNavigationGuard(() => confirm('You have unsaved changes. Leave without saving?'));
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); setNavigationGuard(null); };
  }, [dirty]);

  const blockers = useMemo(() => (draft ? exportBlockers(draft, settings) : []), [draft, settings]);
  const qr = useQrDataUrl(draft ? billQrPayload(draft, settings) : null);

  if (!draft) return <p class="muted">Loading…</p>;

  const save = async (status: BillStatus) => {
    setError('');
    try {
      const bill = await saveDraftBill(db, draft, settings, status);
      setNavigationGuard(null);
      setSaved(JSON.stringify(draftFromBill(bill)));
      setDraft(draftFromBill(bill));
      return bill;
    } catch (e) {
      setError(`Could not save: ${String(e)}. Make a backup and check that the browser is not in private mode.`);
      return null;
    }
  };

  const saveDraftOnly = async () => {
    if (await save('draft')) navigate({ name: 'home' });
  };

  const saveAndExport = async () => {
    const bill = await save('sent');
    if (!bill) return;
    // Build the QR now so the printed page never misses it, then let the preview re-render.
    const payload = billQrPayload(draftFromBill(bill), settings);
    setExportQr(payload ? await qrToDataUrl(payload) : null);
    requestAnimationFrame(() => setTimeout(() => {
      printBill(pdfFileName(bill.number, bill.customer.name));
      navigate({ name: 'bill', id: bill.id });
    }, 0));
  };

  const goTo = (b: Blocker) => (b.target === 'settings' ? navigate({ name: 'settings' }) : setStep(b.target === 'customer' ? 1 : 2));
  const title = mode.kind === 'edit' ? `Edit draft ${draft.number ?? ''}` : 'New bill';

  return (
    <div>
      <div class="page-head no-print"><h2>{title}</h2></div>
      <Steps step={step} onStep={setStep} />
      {error && <p class="errors no-print">{error}</p>}
      {step === 1 && (
        <CustomerStep
          draft={draft}
          customers={customers}
          onPick={(c) => { setDraft(setCustomer(draft, c)); setStep(2); }}
          onCreate={async (c) => {
            await putCustomer(db, c);
            setCustomers([...customers, c].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
            setDraft(setCustomer(draft, c));
            setStep(2);
          }}
        />
      )}
      {step === 2 && <ServicesStep draft={draft} services={services} settings={settings} onChange={setDraft} />}
      {step === 3 && (
        <div>
          {blockers.length > 0 && (
            <div class="errors no-print">
              <b>Before exporting:</b>
              <ul>{blockers.map((b, i) => <li key={i}><button onClick={() => goTo(b)}>{b.message}</button></li>)}</ul>
            </div>
          )}
          <div class="preview-wrap"><BillPage bill={draft} settings={settings} qrDataUrl={exportQr ?? qr} /></div>
          {!draft.number && <p class="muted no-print">The bill number and QR code appear after saving.</p>}
        </div>
      )}
      <div class="page-head no-print" style="margin-top:16px">
        <button class="btn ghost" disabled={step === 1} onClick={() => setStep((step - 1) as Step)}>← Back</button>
        <span>
          <button class="btn ghost" onClick={saveDraftOnly}>Save draft</button>{' '}
          {step < 3
            ? <button class="btn" onClick={() => setStep((step + 1) as Step)}>Next →</button>
            : <button class="btn" disabled={blockers.length > 0} onClick={saveAndExport}>Save &amp; export PDF</button>}
        </span>
      </div>
    </div>
  );
}

function Steps({ step, onStep }: { step: Step; onStep(s: Step): void }) {
  const labels = ['1 · Customer', '2 · Services', '3 · Review & export'];
  return (
    <div class="no-print" style="display:flex;gap:6px;margin-bottom:16px">
      {labels.map((l, i) => (
        <button key={l} class={step === i + 1 ? 'btn' : 'btn ghost'} style="flex:1" onClick={() => onStep((i + 1) as Step)}>{l}</button>
      ))}
    </div>
  );
}

function CustomerStep({ draft, customers, onPick, onCreate }: {
  draft: DraftBill; customers: Customer[]; onPick(c: Customer): void; onCreate(c: Customer): void;
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const shown = customers.filter((c) => `${c.name} ${c.taxId}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div class="panel">
      <div class="page-head">
        <input class="field" placeholder="Search customers…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px" />
        <button class="btn ghost" onClick={() => setAdding(true)}>+ New customer</button>
      </div>
      {adding && <CustomerForm value={emptyCustomer()} onSave={(c) => { setAdding(false); onCreate(c); }} onCancel={() => setAdding(false)} />}
      <table class="list">
        <tbody>
          {shown.map((c) => (
            <tr key={c.id} class="click" onClick={() => onPick(c)}>
              <td>{draft.customerId === c.id ? '● ' : ''}<b>{c.name}</b></td>
              <td class="muted">{c.taxId}</td>
              <td class="muted">{c.address}</td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td class="muted">No matching customers. Add one with “+ New customer”.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ServicesStep({ draft, services, settings, onChange }: {
  draft: DraftBill; services: Service[]; settings: Settings; onChange(d: DraftBill): void;
}) {
  const t = computeTotals(draft.lines, draft.vatRate);
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  return (
    <div class="panel">
      <p class="muted">Customer: <b>{draft.customer.name || '— not chosen —'}</b></p>
      <table class="list">
        <thead><tr><th>Service (VI / EN)</th><th>Unit (VI / EN)</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th><th /></tr></thead>
        <tbody>
          {draft.lines.map((l, i) => {
            const errs = lineErrors(l);
            return (
              <tr key={i}>
                <td>
                  <input value={l.nameVi} placeholder="Tên dịch vụ" onInput={(e) => onChange(updateLine(draft, i, { nameVi: e.currentTarget.value }))} />
                  <input value={l.nameEn} placeholder="Service name" onInput={(e) => onChange(updateLine(draft, i, { nameEn: e.currentTarget.value }))} />
                  {errs.map((er) => <div key={er} style="color:var(--danger);font-size:12px">{er}</div>)}
                </td>
                <td>
                  <input size={8} value={l.unitVi} placeholder="tháng" onInput={(e) => onChange(updateLine(draft, i, { unitVi: e.currentTarget.value }))} />
                  <input size={8} value={l.unitEn} placeholder="month" onInput={(e) => onChange(updateLine(draft, i, { unitEn: e.currentTarget.value }))} />
                </td>
                <td class="r"><input type="number" min={1} step={1} style="width:70px" value={l.qty} onInput={(e) => onChange(updateLine(draft, i, { qty: num(e.currentTarget.value) }))} /></td>
                <td class="r"><input type="number" min={0} step={1000} style="width:130px" value={l.unitPrice} onInput={(e) => onChange(updateLine(draft, i, { unitPrice: num(e.currentTarget.value) }))} /></td>
                <td class="r">{errs.length ? '—' : formatVnd(t.lineAmounts[i])}</td>
                <td><button class="btn ghost" title="Remove line" onClick={() => onChange(removeLine(draft, i))}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style="display:flex;gap:8px;flex-wrap:wrap">
        <select value="" onChange={(e) => {
          const s = services.find((x) => x.id === e.currentTarget.value);
          if (s) onChange(addServiceLine(draft, s));
          e.currentTarget.value = '';
        }}>
          <option value="">+ From saved services…</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.nameVi} — {formatVnd(s.unitPrice)}</option>)}
        </select>
        <button class="btn ghost" onClick={() => onChange(addCustomLine(draft))}>+ Custom line</button>
      </p>
      <div class="grid2">
        <label class="field">Bill date
          <input type="date" value={draft.billDate} onInput={(e) => e.currentTarget.value && onChange(setBillDate(draft, e.currentTarget.value, settings.defaultPaymentDays))} />
        </label>
        <label class="field">Due date
          <input type="date" value={draft.dueDate} onInput={(e) => e.currentTarget.value && onChange({ ...draft, dueDate: e.currentTarget.value })} />
          {dateErrors(draft.billDate, draft.dueDate).map((er) => <span key={er} style="color:var(--danger)">{er}</span>)}
        </label>
        <label class="field">VAT
          <select value={String(draft.vatRate)} onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ ...draft, vatRate: (v === 'none' ? 'none' : Number(v)) as VatRate });
          }}>
            {VAT_RATES.map((r) => <option key={String(r)} value={String(r)}>{r === 'none' ? 'Not applicable' : `${r}%`}</option>)}
          </select>
        </label>
      </div>
      <p class="r">
        Subtotal <b>{formatVnd(t.subtotal)}</b>
        {t.vatApplies && <> · VAT {draft.vatRate}% <b>{formatVnd(t.vat)}</b></>}
        {' '}· Total <b style="font-size:18px">{formatVnd(t.total)} ₫</b>
      </p>
    </div>
  );
}
```

Note on `qty`/`unitPrice`: an empty input stores `NaN`, which `lineErrors` reports as invalid, so export stays blocked until the value is fixed.

- [ ] **Step 2: Verify the build and run the flow by hand**

Run: `npm test && npm run build`
Expected: tests pass and the build has no type errors.

Run: `npm run dev`. With Settings filled in (business name, bank Vietcombank, account `0071000123456`) and one customer and one service saved:
1. Bills → (for now, go to `#/bills/new` directly) → Step 1: pick the customer, and the editor moves to Step 2.
2. Add the saved service, set qty to 3, and add a custom line "Thiết kế logo", 1 × 5.000.000. The total updates live.
3. Set the due date before the bill date. The red error appears, and Step 3 lists it as a blocker with the export button disabled. Fix it.
4. Step 3: the preview shows "(chưa đánh số / not numbered)". Click **Save draft**; you return to `#/` (the Home placeholder). Open `#/bills/<id>/edit` using the id from the URL of the bill in IndexedDB (DevTools → Application → IndexedDB → payment-bills → bills). The bill number is `TT-2026-0001`.
5. Change a qty, then click another menu item. The "unsaved changes" confirm appears, and Cancel keeps you in the editor.
6. Step 3 → **Save & export PDF**. The print dialog opens with the suggested file name `TT-2026-0001_<customer>`. Save as PDF; it has one A4 page, correct accents, and a QR code.

- [ ] **Step 3: Commit**

```bash
git add src/screens/Editor.tsx
git commit -m "feat: three-step bill editor with live totals, blockers and export"
```

---

### Task 10: Home screen and bill view

**Files:**
- Modify: `src/screens/Home.tsx`, `src/screens/BillView.tsx` (replace the placeholders)

**Interfaces:**
- Consumes: `listBills`, `getBill`, `putBill` (Task 5); `homeSummary` (Task 4); `displayStatus`, `applyStatus`, `canTransition` (Task 4); `computeTotals`, `formatVnd`, `formatDateVn`, `todayIso`, `pdfFileName` (Task 1); `draftFromBill` (Task 4); `BillPage`, `billQrPayload`, `useQrDataUrl`, `printBill` (Task 7); `lastBackupAt`, `needsBackupReminder` (Task 6); `navigate`, `useApp` (Task 8)
- Produces: finished `Home` and `BillView` screens. `StatusBadge({ bill, today })` is exported from `Home.tsx`.

- [ ] **Step 1: Implement Home.tsx**

Replace `src/screens/Home.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { listBills } from '../storage/db';
import { lastBackupAt, needsBackupReminder } from '../storage/backup';
import type { Bill } from '../domain/types';
import { homeSummary } from '../domain/summary';
import { displayStatus } from '../domain/status';
import { computeTotals } from '../domain/money';
import { formatDateVn, formatVnd, todayIso } from '../domain/format';

const LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' } as const;
type Filter = 'all' | keyof typeof LABEL;

export function StatusBadge({ bill, today }: { bill: Bill; today: string }) {
  const s = displayStatus(bill, today);
  return <span class={`badge ${s}`}>{LABEL[s]}</span>;
}

export function Home() {
  const { db } = useApp();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [remind, setRemind] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const today = todayIso();

  useEffect(() => {
    (async () => {
      setBills(await listBills(db));
      setRemind(needsBackupReminder(await lastBackupAt(db), new Date().toISOString()));
    })();
  }, []);

  if (!bills) return <p class="muted">Loading…</p>;
  const sum = homeSummary(bills, today);
  const needle = q.trim().toLowerCase();
  const shown = bills.filter(
    (b) => (filter === 'all' || displayStatus(b, today) === filter) &&
      (!needle || b.number.toLowerCase().includes(needle) || b.customer.name.toLowerCase().includes(needle)),
  );

  return (
    <div>
      {remind && (
        <div class="banner">
          <span>You haven't backed up in the last 7 days. A backup protects your bills if browser data is cleared.</span>
          <button class="btn" onClick={() => navigate({ name: 'backup' })}>Back up now</button>
        </div>
      )}
      <div class="page-head"><h2>Bills</h2><button class="btn" onClick={() => navigate({ name: 'newBill' })}>+ New bill</button></div>
      <div class="grid2" style="margin-bottom:16px">
        <Kpi label="Unpaid" stat={sum.unpaid} />
        <Kpi label="Overdue" stat={sum.overdue} color="var(--danger)" />
        <Kpi label="Paid this month" stat={sum.paidThisMonth} color="var(--ok)" />
      </div>
      <div class="page-head">
        <input placeholder="Search number or customer…" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px" />
        <select value={filter} onChange={(e) => setFilter(e.currentTarget.value as Filter)}>
          <option value="all">All statuses</option>
          {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <table class="list">
        <thead><tr><th>No.</th><th>Customer</th><th>Date</th><th>Due</th><th class="r">Total</th><th>Status</th></tr></thead>
        <tbody>
          {shown.map((b) => (
            <tr key={b.id} class="click" onClick={() => navigate({ name: 'bill', id: b.id })}>
              <td>{b.number}</td>
              <td>{b.customer.name}</td>
              <td>{formatDateVn(b.billDate)}</td>
              <td>{formatDateVn(b.dueDate)}</td>
              <td class="r">{formatVnd(computeTotals(b.lines, b.vatRate).total)}</td>
              <td><StatusBadge bill={b} today={today} /></td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr><td colSpan={6} class="muted">{bills.length === 0 ? 'No bills yet. Start with “+ New bill”.' : 'No bills match.'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, stat, color }: { label: string; stat: { amount: number; count: number }; color?: string }) {
  return (
    <div class="panel" style="margin:0">
      <div class="muted">{label}</div>
      <div style={`font-size:22px;font-weight:700;color:${color ?? 'inherit'}`}>{formatVnd(stat.amount)} ₫</div>
      <div class="muted">{stat.count} bill{stat.count === 1 ? '' : 's'}</div>
    </div>
  );
}
```

- [ ] **Step 2: Implement BillView.tsx**

Replace `src/screens/BillView.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { getBill, putBill } from '../storage/db';
import type { Bill, BillStatus } from '../domain/types';
import { applyStatus, canTransition } from '../domain/status';
import { draftFromBill } from '../domain/draft';
import { formatDateVn, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { StatusBadge } from './Home';

const ACTIONS: { to: BillStatus; label: string; confirm?: string }[] = [
  { to: 'sent', label: 'Mark as sent' },
  { to: 'paid', label: 'Mark as paid' },
  { to: 'cancelled', label: 'Cancel bill', confirm: 'Cancel this bill? Its number will not be reused.' },
];

export function BillView({ id }: { id: string }) {
  const { db, settings } = useApp();
  const [bill, setBill] = useState<Bill | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => { getBill(db, id).then((b) => setBill(b ?? null)); }, [id]);
  const draft = bill ? draftFromBill(bill) : null;
  const qr = useQrDataUrl(draft ? billQrPayload(draft, settings) : null);

  if (bill === undefined) return <p class="muted">Loading…</p>;
  if (bill === null || !draft) return <p>Bill not found. <button class="btn ghost" onClick={() => navigate({ name: 'home' })}>Back to bills</button></p>;

  const change = async (to: BillStatus, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    // Undoing "paid" is labelled clearly so it is not clicked by accident.
    try {
      const next = applyStatus(bill, to, todayIso(), new Date().toISOString());
      await putBill(db, next);
      setBill(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const actions = [
    ...ACTIONS.filter((a) => canTransition(bill.status, a.to) && !(bill.status === 'paid' && a.to === 'sent')),
    ...(bill.status === 'paid' ? [{ to: 'sent' as BillStatus, label: 'Undo paid', confirm: 'Mark this bill as not paid?' }] : []),
  ];

  return (
    <div>
      <div class="page-head no-print">
        <h2>{bill.number} <StatusBadge bill={bill} today={todayIso()} /></h2>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          {bill.status === 'draft' && <button class="btn ghost" onClick={() => navigate({ name: 'editBill', id: bill.id })}>Edit</button>}
          {actions.map((a) => <button key={a.label} class={a.to === 'cancelled' ? 'btn danger' : 'btn ghost'} onClick={() => change(a.to, a.confirm)}>{a.label}</button>)}
          <button class="btn ghost" onClick={() => navigate({ name: 'duplicateBill', id: bill.id })}>Duplicate</button>
          {bill.status !== 'cancelled' && <button class="btn" disabled={!qr} onClick={() => printBill(pdfFileName(bill.number, bill.customer.name))}>Export PDF</button>}
        </span>
      </div>
      {error && <p class="errors no-print">{error}</p>}
      {bill.paidDate && <p class="muted no-print">Paid on {formatDateVn(bill.paidDate)}</p>}
      {bill.status !== 'draft' && <p class="muted no-print">This bill is locked. Duplicate it to make changes.</p>}
      <div class="preview-wrap"><BillPage bill={draft} settings={settings} qrDataUrl={qr} /></div>
    </div>
  );
}
```

Note: the bill page uses the **current** Settings for business and bank details, while customer and lines come from the bill's saved snapshot. This matches the spec (only the customer is snapshotted).

- [ ] **Step 3: Verify the build and run it by hand**

Run: `npm test && npm run build`
Expected: tests pass and the build has no type errors.

Run: `npm run dev`:
1. Home shows the three boxes and the list, including the bill created in Task 9, with the "Sent" badge.
2. Open it; it's locked, with no Edit button. Click **Mark as paid** and go back. "Paid this month" includes it, and "Unpaid" doesn't. Open it again and click **Undo paid**; it's Sent again.
3. **Duplicate** opens the editor at Step 2 with the same lines and today's date. Save the draft; it gets the next number.
4. In DevTools, change a sent bill's `dueDate` to last month (or create a bill with a past due date and export it). The badge shows "Overdue" and the Overdue box counts it.
5. Search by part of a customer name, then filter by "Draft"; only the matching rows remain.
6. **Cancel bill** asks for confirmation; afterwards, no Export button is shown.

- [ ] **Step 4: Commit**

```bash
git add src/screens/Home.tsx src/screens/BillView.tsx
git commit -m "feat: home dashboard and bill view with status actions"
```

---

### Task 11: Backup / Restore screen

**Files:**
- Modify: `src/screens/Backup.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `exportAll`, `parseBackup`, `restoreAll`, `backupFileName`, `markBackedUp`, `lastBackupAt` (Task 6); `useApp` (Task 8)
- Produces: finished `BackupScreen`

- [ ] **Step 1: Implement Backup.tsx**

Replace `src/screens/Backup.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { backupFileName, exportAll, lastBackupAt, markBackedUp, parseBackup, restoreAll, type BackupData } from '../storage/backup';

function download(data: BackupData, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function BackupScreen() {
  const { db, reloadSettings } = useApp();
  const [last, setLast] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { lastBackupAt(db).then(setLast); }, []);

  const backup = async () => {
    const now = new Date().toISOString();
    download(await exportAll(db, now), backupFileName(now));
    await markBackedUp(db, now);
    setLast(now);
    setMsg('Backup file downloaded. Keep it somewhere safe, e.g. Google Drive.');
  };

  const restore = async (file: File | undefined) => {
    setMsg(''); setErr('');
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { setErr(parsed.error); return; }
    if (!confirm(`Replace ALL current data with this backup (${parsed.summary})?\n\nA backup of your current data will be downloaded first.`)) return;
    try {
      const now = new Date().toISOString();
      download(await exportAll(db, now), backupFileName(now).replace('.json', '-before-restore.json'));
      await restoreAll(db, parsed.data);
      await reloadSettings();
      setMsg(`Restored: ${parsed.summary}.`);
    } catch (e) {
      setErr(`Restore failed, current data was not changed: ${String(e)}`);
    }
  };

  return (
    <div>
      <div class="page-head"><h2>Backup / Restore</h2></div>
      {msg && <p class="panel">{msg}</p>}
      {err && <p class="errors">{err}</p>}
      <div class="panel">
        <h3>Back up</h3>
        <p class="muted">Last backup: {last ? new Date(last).toLocaleString('vi-VN') : 'never'}</p>
        <button class="btn" onClick={backup}>Download backup file</button>
      </div>
      <div class="panel">
        <h3>Restore</h3>
        <p class="muted">Replaces everything in this app with the contents of a backup file.</p>
        <input type="file" accept="application/json,.json" onChange={(e) => { restore(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}
```

`restoreAll` runs in one IndexedDB transaction, so a failure part-way through rolls back automatically. That's why the error message can say that current data was not changed.

- [ ] **Step 2: Verify the build and run it by hand**

Run: `npm test && npm run build`
Expected: tests pass and the build has no type errors.

Run: `npm run dev`:
1. Home shows the backup banner. Backup → **Download backup file**; a `payment-bills-backup-YYYY-MM-DD.json` file downloads, and the banner no longer shows on Home.
2. Choose a random `.json` file (e.g. `package.json`) to restore. The red message "This file is not a payment-bills backup." appears, and your bills are unchanged.
3. DevTools → Application → Storage → **Clear site data**, then reload. The app is empty. Restore the backup file; the confirm shows the counts, and after accepting, all bills, customers, services and settings are back. Create a new bill; its number continues the sequence (no reuse).

- [ ] **Step 3: Commit**

```bash
git add src/screens/Backup.tsx
git commit -m "feat: backup and restore screen with safety backup before restore"
```

---

### Task 12: Offline install (PWA), final checks and manual test checklist

**Files:**
- Modify: `vite.config.ts`, `index.html`
- Create: `public/icon.svg`, `docs/manual-test-checklist.md`, `README.md`

**Interfaces:**
- Consumes: the whole app
- Produces: an installable, offline-capable build in `dist/`

- [ ] **Step 1: Add the PWA plugin**

Replace `vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Phiếu thanh toán',
        short_name: 'Phiếu TT',
        description: 'Create bilingual payment requests with VietQR',
        start_url: './',
        display: 'standalone',
        background_color: '#f5f6f8',
        theme_color: '#0f6e56',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'] },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
```

Create `public/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f6e56"/>
  <rect x="16" y="12" width="32" height="40" rx="3" fill="#fff"/>
  <rect x="21" y="20" width="22" height="3" fill="#0f6e56"/>
  <rect x="21" y="27" width="22" height="2" fill="#94a3b8"/>
  <rect x="21" y="32" width="22" height="2" fill="#94a3b8"/>
  <rect x="21" y="41" width="10" height="6" fill="#0f6e56"/>
</svg>
```

In `index.html`, add inside `<head>`:

```html
<link rel="icon" href="./icon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#0f6e56" />
```

- [ ] **Step 2: Build and check offline behaviour**

Run: `npm test && npm run build && npm run preview`
Expected: all tests pass; the build writes `dist/sw.js` and `dist/manifest.webmanifest`; the preview serves the app.

In Chrome, open the preview URL. Check that DevTools → Application → Manifest shows no errors and that the install icon appears in the address bar. Install the app. In DevTools → Network, tick **Offline** and reload. The app still opens and your data is still there.

- [ ] **Step 3: Write the manual test checklist**

Create `docs/manual-test-checklist.md`:

```markdown
# Manual test checklist

Run before first real use, and after any change to the bill page, VietQR or backup.

## VietQR with real banking apps
Use your real bank details in Settings. Create a bill for 10.000 ₫ and export the PDF.
Scan the QR (from screen and from a printed/PDF copy) with at least 3 apps, e.g. Vietcombank, MB Bank, Techcombank:
- [ ] Bank and account number are filled in and the account holder name shown by the app is correct
- [ ] Amount is 10.000 ₫ and cannot be mistaken
- [ ] Transfer content shows the reference (e.g. TT20260001)
- [ ] (Optional) Make the 10.000 ₫ transfer and confirm it arrives with that content
Also confirm your bank's BIN in src/domain/banks.ts against https://api.vietqr.io/v2/banks.

## PDF / print (Chrome and Edge)
- [ ] 3-line bill: one A4 page, nothing cut off, Vietnamese accents correct, QR sharp
- [ ] 25-line bill: table continues on page 2 with the header row repeated; words, QR and signatures stay together
- [ ] Suggested file name is <number>_<customer>
- [ ] VAT "Not applicable": no VAT row; 0%: VAT row with 0
- [ ] Logo (if set) appears and is not stretched

## Backup
- [ ] Back up → clear site data → restore → bills, customers, services, settings identical
- [ ] New bill after restore continues numbering
- [ ] Restoring a non-backup file shows an error and changes nothing

## Offline
- [ ] Installed app opens with Wi-Fi off and can create and export a bill
```

- [ ] **Step 4: Write a short README**

Create `README.md`:

```markdown
# Phiếu thanh toán — Payment bill app

Offline browser app for creating bilingual (Vietnamese/English) payment requests with a VietQR code.
This is **not** an official VAT e-invoice; issue those through a licensed e-invoice provider.

## Use
- `npm install`, then `npm run build`. Host the `dist/` folder on any static host (e.g. GitHub Pages) or run `npm run preview`.
- Open it in Chrome or Edge and use "Install app" to add it to your desktop.
- Fill in **Settings** first (business, bank and account for VietQR).
- Your data stays in this browser. Use **Backup / Restore** weekly and keep the file safe.

## Develop
- `npm run dev` for the dev server, `npm test` for the unit tests.
- Design: docs/superpowers/specs/2026-09-25-payment-bill-app-design.md
- Manual checks: docs/manual-test-checklist.md
```

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts index.html public docs/manual-test-checklist.md README.md
git commit -m "feat: installable offline PWA, manual test checklist and README"
```

---

## Self-review notes (spec coverage)

| Spec section | Task |
|---|---|
| §1 scope (payment request, VND, no sending) | Global Constraints, Task 7 title |
| §3.1 Home (boxes, list, filter, search, bill actions) | Tasks 4 (summary), 10 |
| §3.2 3-step editor | Tasks 4 (draft helpers), 9 |
| §3.3 Customers (archive if used) | Tasks 5, 8 |
| §3.4 Services | Task 8 |
| §3.5 Settings (all fields, NAPAS bank list) | Tasks 1 (defaults), 3 (banks), 8 |
| §3.6 Backup / Restore | Tasks 6, 11 |
| §4 life cycle, locking, overdue | Tasks 4, 10 |
| §5 numbering | Task 5 |
| §5 money, VAT, words | Tasks 1, 2 |
| §5 VietQR, reference | Task 3 |
| §5 bill page layout, page breaks | Task 7, manual checklist |
| §6 architecture / PWA / customer snapshot | Tasks 4 (`setCustomer`), 5, 12 |
| §7 blockers, input checks, restore safety, reminder, unsaved changes, storage failure | Tasks 4, 6, 8 (`main.tsx` error screen, router guard), 9, 10, 11 |
| §8 unit tests + manual tests | Tasks 1–7, `docs/manual-test-checklist.md` |
