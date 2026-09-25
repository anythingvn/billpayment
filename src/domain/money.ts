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
