import type { Bill, BillLine, Contract, VatRate } from './types';
import { computeTotals } from './money';
import { addDays } from './format';
import { contractValue, instalmentAmounts, periodKeys, periodLabel, valueBeforeVat } from './contractPlan';

/** One billable item of a contract or addendum plan. */
export interface PlanItem {
  /** Instalment id, or period key YYYY-MM. */
  key: string;
  /** The contract or addendum the item belongs to. */
  sourceId: string;
  label: { vi: string; en: string };
  /** Before VAT. */
  amount: number;
  /** null: an acceptance instalment not marked ready yet. */
  dueDate: string | null;
}

export type ItemState = 'waiting' | 'notDue' | 'due' | 'billed' | 'paid' | 'superseded';

export interface ItemRow extends PlanItem {
  state: ItemState;
  billId: string | null;
  billNumber: string | null;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

export function planItems(c: Contract): PlanItem[] {
  const plan = c.plan;
  if (plan.type === 'instalments') {
    const amounts = instalmentAmounts(plan.items, valueBeforeVat(c));
    return plan.items.map((i, n) => ({
      key: i.id,
      sourceId: c.id,
      label: { vi: i.name, en: '' },
      amount: amounts[n],
      dueDate: i.due.on === 'signing' ? c.signedDate
        : i.due.on === 'date' ? i.due.date
          : i.ready ? (i.readyOn ?? c.signedDate) : null,
    }));
  }
  if (plan.type === 'periodic') {
    return periodKeys(plan).map((key) => ({
      key,
      sourceId: c.id,
      label: periodLabel(key, plan.every),
      amount: plan.amount,
      dueDate: maxDate(`${key}-01`, c.startDate),
    }));
  }
  return [];
}

const isChange = (a: Contract) => a.kind === 'addendum' && a.effect === 'changesTerms' && a.status === 'active' && !!a.effectiveDate;
const isAddWork = (a: Contract) => a.kind === 'addendum' && a.effect === 'addsWork' && a.status === 'active';

/** The record whose lines, VAT, plan and payment terms apply on `date`: the latest effective change, else the contract. */
export function applicableTerms(contract: Contract, addenda: Contract[], date: string): Contract {
  const changes = addenda.filter((a) => a.parentId === contract.id && isChange(a) && a.effectiveDate! <= date);
  changes.sort((a, b) => a.effectiveDate!.localeCompare(b.effectiveDate!));
  return changes.at(-1) ?? contract;
}

const live = (b: Bill) => b.status !== 'cancelled';

function billOf(item: PlanItem, bills: Bill[]): Bill | undefined {
  const mine = bills.filter((b) => live(b) && b.contractRef?.contractId === item.sourceId && b.contractRef?.itemKey === item.key);
  return mine.find((b) => b.status === 'paid') ?? mine[0];
}

/** All items of a contract and its active addenda, with their state on `today`. */
export function contractItems(contract: Contract, addenda: Contract[], bills: Bill[], today: string): ItemRow[] {
  const mine = addenda.filter((a) => a.parentId === contract.id);
  const changes = mine.filter(isChange);
  const firstChange = changes.map((a) => a.effectiveDate!).sort()[0] ?? null;
  const row = (item: PlanItem, supersedable: boolean): ItemRow => {
    const bill = billOf(item, bills);
    let state: ItemState;
    if (bill) state = bill.status === 'paid' ? 'paid' : 'billed';
    else if (supersedable && firstChange && item.dueDate !== null && item.dueDate >= firstChange) state = 'superseded';
    else if (item.dueDate === null) state = 'waiting';
    else state = item.dueDate <= today ? 'due' : 'notDue';
    return { ...item, state, billId: bill?.id ?? null, billNumber: bill?.number ?? null };
  };
  const rows = planItems(contract).map((i) => row(i, true));
  for (const a of mine.filter(isAddWork)) rows.push(...planItems(a).map((i) => row(i, false)));
  for (const a of changes) {
    rows.push(...planItems(a).filter((i) => i.dueDate === null || i.dueDate >= a.effectiveDate!).map((i) => row(i, false)));
  }
  return rows;
}

/** Items due now across active contracts (including their addenda), oldest first. */
export function dueItems(contracts: Contract[], bills: Bill[], today: string): (ItemRow & { contract: Contract })[] {
  const addenda = contracts.filter((c) => c.kind === 'addendum');
  return contracts
    .filter((c) => c.kind === 'contract' && c.status === 'active')
    .flatMap((c) => contractItems(c, addenda, bills, today).filter((r) => r.state === 'due').map((r) => ({ ...r, contract: c })))
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
}

/** True when some item has been due for more than 3 days. */
export function needsBillingReminder(due: { dueDate: string | null }[], today: string): boolean {
  const limit = addDays(today, -3);
  return due.some((d) => d.dueDate !== null && d.dueDate < limit);
}

export function linkedBills(contract: Contract, addenda: Contract[], bills: Bill[]): Bill[] {
  const ids = new Set([contract.id, ...addenda.filter((a) => a.parentId === contract.id).map((a) => a.id)]);
  return bills.filter((b) => b.contractRef && ids.has(b.contractRef.contractId));
}

const withVat = (amount: number, rate: VatRate): number => {
  const line: BillLine = { nameVi: '', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: amount, details: [] };
  return computeTotals([line], rate).total;
};

export function contractSummary(contract: Contract, addenda: Contract[], bills: Bill[]) {
  const mine = addenda.filter((a) => a.parentId === contract.id);
  const value = contractValue(contract);
  let totalValue = value + mine.filter(isAddWork).reduce((s, a) => s + contractValue(a), 0);
  const changes = mine.filter(isChange);
  if (changes.length) {
    // Replace the superseded part of the contract's plan with the addenda's own items.
    const rows = contractItems(contract, mine, bills, '9999-12-31');
    const superseded = rows.filter((r) => r.sourceId === contract.id && r.state === 'superseded');
    totalValue -= superseded.reduce((s, r) => s + withVat(r.amount, contract.vatRate), 0);
    for (const a of changes) {
      totalValue += rows.filter((r) => r.sourceId === a.id).reduce((s, r) => s + withVat(r.amount, a.vatRate), 0);
    }
  }
  const linked = linkedBills(contract, addenda, bills).filter(live);
  const total = (b: Bill) => computeTotals(b.lines, b.vatRate).total;
  const billed = linked.reduce((s, b) => s + total(b), 0);
  const paid = linked.filter((b) => b.status === 'paid').reduce((s, b) => s + total(b), 0);
  return { value, totalValue, billed, paid, left: Math.max(0, totalValue - paid) };
}

