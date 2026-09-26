import type { BillLine, Contract, ContractRef } from './types';
import type { DraftBill } from './draft';
import type { PlanItem } from './contractTerms';
import { addDays, formatDateVn } from './format';
import { valueBeforeVat } from './contractPlan';

/** The bill's link to a contract or addendum, with numbers and dates copied for printing. */
export function contractRefFor(record: Contract, parent: Contract | null, itemKey: string | null): ContractRef {
  return {
    contractId: record.id,
    itemKey,
    number: record.number,
    signedDate: record.signedDate,
    parentNumber: parent?.number ?? null,
    parentSignedDate: parent?.signedDate ?? null,
  };
}

const blankLine = (nameVi: string, unitPrice: number, details: string[]): BillLine =>
  ({ nameVi, nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice, details });
const lineName = (l: BillLine) => (l.nameEn ? `${l.nameVi} / ${l.nameEn}` : l.nameVi);

function linesFor(terms: Contract, item: PlanItem | null): BillLine[] {
  const plan = terms.plan;
  if (item && plan.type === 'instalments') {
    const inst = plan.items.find((i) => i.id === item.key);
    const name = inst && 'percent' in inst.share ? `${item.label.vi} – ${inst.share.percent}% giá trị hợp đồng` : item.label.vi;
    return [blankLine(name, item.amount, terms.lines.map(lineName))];
  }
  if (item && plan.type === 'periodic') {
    const period = `${item.label.vi} / ${item.label.en}`;
    if (item.amount !== valueBeforeVat(terms)) return [blankLine(terms.title, item.amount, [period])];
    return terms.lines.map((l) => ({ ...l, details: [...l.details, period] }));
  }
  return terms.lines.map((l) => ({ ...l, details: [...l.details], qty: 1 }));
}

/**
 * Fills a bill from a contract or addendum. `terms` is the record whose lines, VAT and payment days apply;
 * `ctx.record` is what the bill links to (its parent, for an addendum), `ctx.item` the plan item billed, if any.
 */
export function fillFromContract(
  d: DraftBill,
  terms: Contract,
  ctx: { record: Contract; parent: Contract | null; item: PlanItem | null },
): DraftBill {
  const owner = ctx.parent ?? ctx.record;
  return {
    ...d,
    customerId: owner.customerId,
    customer: { ...owner.customer },
    vatRate: terms.vatRate,
    dueDate: addDays(d.billDate, terms.paymentDays),
    lines: linesFor(terms, ctx.item),
    contractRef: contractRefFor(ctx.record, ctx.parent, ctx.item?.key ?? null),
  };
}

const addendumNo = (number: string) => /^PL\s*(\d+)$/i.exec(number.trim())?.[1] ?? number;

/** "Căn cứ Hợp đồng số … ký ngày …" line printed on bills, from the copies in the bill's ContractRef. */
export function referenceLine(ref: ContractRef): { vi: string; en: string } {
  const [cNo, cDate] = ref.parentNumber ? [ref.parentNumber, ref.parentSignedDate ?? ''] : [ref.number, ref.signedDate];
  let vi = `Căn cứ Hợp đồng số ${cNo} ký ngày ${formatDateVn(cDate)}`;
  let en = `Under Contract No. ${cNo} dated ${formatDateVn(cDate)}`;
  if (ref.parentNumber) {
    vi += ` và Phụ lục số ${addendumNo(ref.number)} ký ngày ${formatDateVn(ref.signedDate)}`;
    en += ` and Addendum No. ${addendumNo(ref.number)} dated ${formatDateVn(ref.signedDate)}`;
  }
  return { vi, en };
}
