import type { BillLine, Service, VatRate } from '../domain/types';
import { computeTotals } from '../domain/money';
import { formatVnd } from '../domain/format';
import { lineErrors } from '../domain/validate';
import { splitDetails } from '../domain/draft';

const blank = (): BillLine => ({ nameVi: '', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 0, details: [] });
const fromService = (s: Service): BillLine =>
  ({ nameVi: s.nameVi, nameEn: s.nameEn, unitVi: s.unitVi, unitEn: s.unitEn, qty: 1, unitPrice: s.unitPrice, details: [] });
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

/** Service lines table used by bills and contracts: VI/EN names, detail notes, unit, quantity, price, totals. */
export function LinesEditor({ lines, vatRate, services, onChange }: {
  lines: BillLine[]; vatRate: VatRate; services: Service[]; onChange(lines: BillLine[]): void;
}) {
  const t = computeTotals(lines, vatRate);
  const set = (i: number, patch: Partial<BillLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <>
      <table class="list">
        <thead><tr><th>Service (VI / EN)</th><th>Unit (VI / EN)</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const errs = lineErrors(l);
            return (
              <tr key={i}>
                <td>
                  <input value={l.nameVi} placeholder="Tên dịch vụ" onInput={(e) => set(i, { nameVi: e.currentTarget.value })} />
                  <input value={l.nameEn} placeholder="Service name" onInput={(e) => set(i, { nameEn: e.currentTarget.value })} />
                  <textarea rows={2} class="details-box" value={(l.details ?? []).join('\n')} placeholder="Details, one per line (optional) / Chi tiết, mỗi dòng một ý"
                    onInput={(e) => set(i, { details: splitDetails(e.currentTarget.value) })} />
                  {errs.map((er) => <div key={er} style="color:var(--danger);font-size:12px">{er}</div>)}
                </td>
                <td>
                  <input size={8} value={l.unitVi} placeholder="tháng" onInput={(e) => set(i, { unitVi: e.currentTarget.value })} />
                  <input size={8} value={l.unitEn} placeholder="month" onInput={(e) => set(i, { unitEn: e.currentTarget.value })} />
                </td>
                <td class="r"><input type="number" aria-label="Quantity" min={1} step={1} style="width:70px" value={l.qty} onInput={(e) => set(i, { qty: num(e.currentTarget.value) })} /></td>
                <td class="r"><input type="number" aria-label="Unit price" min={0} step={1000} style="width:130px" value={l.unitPrice} onInput={(e) => set(i, { unitPrice: num(e.currentTarget.value) })} /></td>
                <td class="r">{errs.length ? '—' : formatVnd(t.lineAmounts[i])}</td>
                <td><button class="btn ghost" title="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style="display:flex;gap:8px;flex-wrap:wrap">
        <select value="" onChange={(e) => {
          const s = services.find((x) => x.id === e.currentTarget.value);
          if (s) onChange([...lines, fromService(s)]);
          e.currentTarget.value = '';
        }}>
          <option value="">+ From saved services…</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.nameVi} — {formatVnd(s.unitPrice)}</option>)}
        </select>
        <button class="btn ghost" onClick={() => onChange([...lines, blank()])}>+ Custom line</button>
      </p>
      <p class="r">
        Subtotal <b>{formatVnd(t.subtotal)}</b>
        {t.vatApplies && <> · VAT {vatRate}% <b>{formatVnd(t.vat)}</b></>}
        {' '}· Total <b style="font-size:18px">{formatVnd(t.total)} ₫</b>
      </p>
    </>
  );
}
