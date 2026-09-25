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
  const totalOk = Number.isInteger(t.total) && t.total >= 0;
  const money = (n: number) => (Number.isFinite(n) ? formatVnd(n) : '—');
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
        <colgroup><col class="c-no" /><col /><col class="c-unit" /><col class="c-qty" /><col class="c-price" /><col class="c-amt" /></colgroup>
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
              <td class="r">{money(l.unitPrice)}</td>
              <td class="r">{money(t.lineAmounts[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div class="bill-end">
        {/* Totals live in their own table inside .bill-end so they never split from the words, QR and signatures. */}
        <table class="bill-table bill-sum">
          <colgroup><col /><col class="c-amt" /></colgroup>
          <tbody>
            <tr><td class="r">Cộng <En>/ Subtotal</En></td><td class="r">{money(t.subtotal)}</td></tr>
            {t.vatApplies && (
              <tr><td class="r">Thuế GTGT {bill.vatRate}% <En>{`/ VAT ${bill.vatRate}%`}</En></td><td class="r">{money(t.vat)}</td></tr>
            )}
            <tr class="bill-total"><td class="r">Tổng cộng <En>/ Total (VND)</En></td><td class="r">{money(t.total)}</td></tr>
          </tbody>
        </table>
        <p class="bill-words">
          Bằng chữ <En>/ In words:</En> <i>{totalOk ? vndToWordsVi(t.total) : '—'}</i>
          <br />
          <En>{totalOk ? vndToWordsEn(t.total) : '—'}</En>
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
