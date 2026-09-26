import { buildStatement, statementCode, statementPresets, statementFileBase } from '../../src/domain/statement';
import type { Bill, BillStatus, Customer, VatRate } from '../../src/domain/types';
import { computeTotals } from '../../src/domain/money';
import { sampleBill } from '../fixtures';

const customer: Customer = {
  id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: 'Chị Lan', email: '', phone: '', archived: false,
};
const line = (unitPrice = 1000000) => ({ nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice, details: [] });
let n = 0;
const bill = (billDate: string, paidDate: string | null = null, over: Partial<Bill> = {}): Bill => {
  n++;
  return sampleBill({
    id: `b${n}`, number: `TT-2026-${String(n).padStart(4, '0')}`, customerId: 'c1', billDate, dueDate: billDate,
    paidDate, status: paidDate ? 'paid' : 'sent', lines: [line()], vatRate: 8, ...over,
  });
};
const T = 1080000;

describe('buildStatement', () => {
  const A = bill('2025-12-10', '2026-01-05');
  const B = bill('2025-11-01');
  const C = bill('2026-03-01', '2026-03-20');
  const D = bill('2026-11-01');
  const E = bill('2026-12-20', '2027-01-03');
  const st = buildStatement([A, B, C, D, E], customer, '2026-01-01', '2026-12-31', '2027-01-10');

  it('four balances', () => {
    expect([st.opening, st.billed, st.paid, st.closing]).toEqual([2 * T, 3 * T, 2 * T, 3 * T]);
    expect(st.unpaid.map((r) => r.number).sort()).toEqual([B.number, D.number, E.number].sort());
  });

  it('other customers, drafts and cancelled are ignored', () => {
    const r = buildStatement([
      bill('2026-02-01', null, { customerId: 'c2' }),
      bill('2026-02-01', null, { status: 'draft' }),
      bill('2026-02-01', null, { status: 'cancelled' }),
    ], customer, '2026-01-01', '2026-12-31', '2027-01-10');
    expect([r.opening, r.billed, r.paid, r.closing, r.details.length, r.unpaid.length]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('edges are inclusive', () => {
    const first = bill('2026-01-01');
    const paidLast = bill('2025-06-01', '2026-12-31');
    const paidAfter = bill('2026-06-01', '2027-01-01');
    const r = buildStatement([first, paidLast, paidAfter], customer, '2026-01-01', '2026-12-31', '2027-01-10');
    expect(r.billed).toBe(2 * T);
    expect(r.paid).toBe(T);
    expect(r.unpaid.map((x) => x.number)).toEqual(expect.arrayContaining([first.number, paidAfter.number]));
    expect(r.unpaid.map((x) => x.number)).not.toContain(paidLast.number);
  });

  it('details rows', () => {
    const a = st.details.find((r) => r.number === A.number)!;
    const c = st.details.find((r) => r.number === C.number)!;
    expect([a.billed, a.paid, a.date]).toEqual([null, T, '2026-01-05']);
    expect([c.billed, c.paid, c.date]).toEqual([T, T, '2026-03-01']);
    expect(st.details.map((r) => r.number)).toEqual([A.number, C.number, D.number, E.number]);
    expect(st.details.find((r) => r.number === B.number)).toBeUndefined();
  });

  it('days overdue stop at today', () => {
    const late = bill('2026-09-15', null, { dueDate: '2026-09-25' });
    const r = buildStatement([late], customer, '2026-01-01', '2026-12-31', '2026-10-05');
    expect(r.unpaid[0].daysOverdue).toBe(10);
    expect(buildStatement([late], customer, '2026-01-01', '2026-09-30', '2026-12-01').unpaid[0].daysOverdue).toBe(5);
  });

  it('number, reference and confirm-by', () => {
    expect([st.number, st.reference, st.confirmBy]).toEqual(['ĐC-20261231-6543', 'DC202612316543', '2027-01-20']);
    expect([st.from, st.to, st.today, st.customer.id]).toEqual(['2026-01-01', '2026-12-31', '2027-01-10', 'c1']);
  });

  it('unpaid sorted by due date, then number', () => {
    expect(st.unpaid.map((r) => r.number)).toEqual([B.number, D.number, E.number]);
  });
});

describe('statementCode', () => {
  it('code falls back to the name', () => {
    expect(statementCode({ name: 'x', taxId: '0109876543' })).toBe('6543');
    expect(statementCode({ name: 'Công ty CP Hoa Sen Xanh', taxId: '' })).toBe('CTCH');
    expect(statementCode({ name: 'Đức Anh', taxId: '' })).toBe('DA');
    expect(statementCode({ name: '---', taxId: '' })).toBe('KH');
    expect(statementCode({ name: 'x', taxId: '01-0987 6543-001' })).toBe('3001');
    for (const c of [customer, { ...customer, taxId: '' }, { ...customer, taxId: '', name: 'Ông Nguyễn Văn Ấn Độ Lê' }]) {
      const ref = buildStatement([], c, '2026-01-01', '2026-12-31', '2027-01-10').reference;
      expect(ref).toMatch(/^[A-Z0-9]{1,25}$/);
    }
  });
});

describe('balances always reconcile', () => {
  it('for 50 random bill sets', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let x = seed;
      const rnd = (k: number) => { x = (x * 1103515245 + 12345) % 2147483648; return x % k; };
      const date = () => `${2025 + rnd(3)}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
      const statuses: BillStatus[] = ['sent', 'paid', 'draft', 'cancelled'];
      const rates: VatRate[] = ['none', 0, 5, 8, 10];
      const bills: Bill[] = [];
      for (let i = rnd(13); i > 0; i--) {
        const status = statuses[rnd(4)];
        const billDate = date();
        const paid = status === 'paid' ? date() : null;
        bills.push(bill(billDate, paid, {
          status, paidDate: paid, customerId: rnd(5) === 0 ? 'c2' : 'c1', vatRate: rates[rnd(5)], lines: [line(1000 * (1 + rnd(9000)))],
        }));
      }
      const r = buildStatement(bills, customer, '2026-01-01', '2026-12-31', '2027-02-01');
      const unpaidSum = r.unpaid.reduce((a, u) => a + u.total, 0);
      expect(r.opening + r.billed - r.paid).toBe(r.closing);
      expect(unpaidSum).toBe(r.closing);
      const own = bills.filter((b) => b.customerId === 'c1' && (b.status === 'sent' || b.status === 'paid'));
      expect(r.unpaid.every((u) => u.total === computeTotals(own.find((b) => b.number === u.number)!.lines, own.find((b) => b.number === u.number)!.vatRate).total)).toBe(true);
    }
  });
});

describe('statementPresets', () => {
  it('presets', () => {
    const bills = [bill('2025-03-02'), bill('2026-02-01'), bill('2024-01-01', null, { customerId: 'c2' })];
    const range = Object.fromEntries(statementPresets('2026-05-10', bills.filter((b) => b.customerId === 'c1')).map((p) => [p.key, [p.from, p.to]]));
    expect(range).toEqual({
      thisYear: ['2026-01-01', '2026-05-10'], lastYear: ['2025-01-01', '2025-12-31'],
      thisQuarter: ['2026-04-01', '2026-05-10'], lastQuarter: ['2026-01-01', '2026-03-31'], allTime: ['2025-03-02', '2026-05-10'],
    });
    expect(statementPresets('2026-05-10', []).find((p) => p.key === 'allTime')).toMatchObject({ from: '2026-05-10', to: '2026-05-10' });
    expect(statementPresets('2026-05-10', []).map((p) => p.label)).toEqual(['This year', 'Last year', 'This quarter', 'Last quarter', 'All time']);
    expect(statementPresets('2026-01-15', []).find((p) => p.key === 'lastQuarter')).toMatchObject({ from: '2025-10-01', to: '2025-12-31' });
  });
});

describe('statementFileBase', () => {
  it('file base', () => {
    expect(statementFileBase('Công ty CP Hoa Sen Xanh', '2026-01-01', '2026-12-31')).toBe('Đối chiếu Công ty CP Hoa Sen Xanh 2026');
    expect(statementFileBase('A/B', '2026-01-01', '2026-09-26')).toBe('Đối chiếu A B 2026-01-01 – 2026-09-26');
  });
});
