import type { Settings } from '../domain/types';
import type { Statement, StatementRow } from '../domain/statement';
import { defaultBankAccount } from '../domain/settings';
import { bankByBin } from '../domain/banks';
import { buildVietQrPayload } from '../domain/vietqr';
import { formatDateVn, formatVnd } from '../domain/format';
import { vndToWordsEn, vndToWordsVi } from '../domain/words';

/** VietQR for the closing balance, or null when nothing is owed or there is no bank account. */
export function statementQrPayload(st: Statement, s: Settings): string | null {
  const acc = defaultBankAccount(s);
  if (st.closing <= 0 || !acc || !acc.bankBin || !acc.accountNumber.trim()) return null;
  try {
    return buildVietQrPayload({ bankBin: acc.bankBin, accountNumber: acc.accountNumber, amount: st.closing, reference: st.reference });
  } catch {
    return null;
  }
}

const En = ({ children }: { children: string }) => <span class="en">{children}</span>;
const NONE = 'Không có / None';
const money = (n: number | null) => (n === null ? '' : formatVnd(n));
const date = (d: string | null) => (d ? formatDateVn(d) : '');
const sum = (rows: StatementRow[], pick: (r: StatementRow) => number | null) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0);

/** The customer statement as an A4 page, in the bill page's style. Rows and the two blocks carry `stmt-keep` for the PDF. */
export function StatementPage({ statement: st, settings: s, qrDataUrl }: { statement: Statement; settings: Settings; qrDataUrl: string | null }) {
  const c = st.customer;
  const acc = defaultBankAccount(s);
  const bank = acc && bankByBin(acc.bankBin);
  const showPay = st.closing > 0 && !!acc && !!acc.accountNumber.trim();
  return (
    <div class="bill-sheet stmt">
      <div class="stmt-top">
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
            <div>Số <En>/ No.:</En> <b>{st.number}</b></div>
            <div>Ngày lập <En>/ Date:</En> {formatDateVn(st.today)}</div>
          </div>
        </header>
        <h1 class="bill-title">BẢNG ĐỐI CHIẾU CÔNG NỢ</h1>
        <div class="bill-subtitle">STATEMENT OF ACCOUNT</div>
        <div class="stmt-period">Kỳ đối chiếu <En>/ Period:</En> <b>{formatDateVn(st.from)} – {formatDateVn(st.to)}</b></div>
        <section class="bill-to">
          <div>Kính gửi <En>/ To:</En> <b>{c.name}</b></div>
          {c.address && <div>Địa chỉ <En>/ Address:</En> {c.address}</div>}
          {c.taxId && <div>MST <En>/ Tax ID:</En> {c.taxId}</div>}
          {c.contactPerson && <div>Người liên hệ <En>/ Attn:</En> {c.contactPerson}</div>}
        </section>
      </div>

      <div class="stmt-balances stmt-keep">
        <table class="bill-table">
          <colgroup><col /><col class="c-amt" /></colgroup>
          <tbody>
            <tr><td>Số dư đầu kỳ <En>/ Opening balance</En></td><td class="r">{formatVnd(st.opening)}</td></tr>
            <tr><td>Phát sinh trong kỳ <En>/ Billed in period</En></td><td class="r">{formatVnd(st.billed)}</td></tr>
            <tr><td>Đã thanh toán trong kỳ <En>/ Paid in period</En></td><td class="r">{formatVnd(st.paid)}</td></tr>
            <tr class="bill-total"><td>Số dư cuối kỳ <En>/ Closing balance</En></td><td class="r">{formatVnd(st.closing)}</td></tr>
          </tbody>
        </table>
        <p class="bill-words">
          Bằng chữ <En>/ In words:</En> <i>{vndToWordsVi(st.closing)}</i><br /><En>{vndToWordsEn(st.closing)}</En>
        </p>
      </div>

      <h2 class="stmt-h">Chi tiết trong kỳ <En>/ Details</En></h2>
      <table class="bill-table stmt-table">
        <colgroup><col class="c-no" /><col class="c-num" /><col class="c-date" /><col /><col class="c-amt" /><col class="c-date" /><col class="c-amt" /></colgroup>
        <thead>
          <tr>
            <th>STT<br /><En>No.</En></th><th>Số phiếu<br /><En>Bill no.</En></th><th>Ngày lập<br /><En>Date</En></th>
            <th>Hợp đồng<br /><En>Contract</En></th><th class="r">Phát sinh<br /><En>Billed</En></th>
            <th>Ngày TT<br /><En>Paid on</En></th><th class="r">Thanh toán<br /><En>Paid</En></th>
          </tr>
        </thead>
        <tbody>
          {st.details.map((r, i) => (
            <tr key={r.number} class="stmt-keep">
              <td>{i + 1}</td><td>{r.number}</td><td>{date(r.billDate)}</td><td>{r.contract}</td>
              <td class="r">{money(r.billed)}</td><td>{r.paid !== null ? date(r.paidDate) : ''}</td><td class="r">{money(r.paid)}</td>
            </tr>
          ))}
          {st.details.length === 0 && <tr><td /><td colSpan={6}>{NONE}</td></tr>}
          <tr class="bill-total stmt-total">
            <td colSpan={4}>Tổng cộng <En>/ Total</En></td>
            <td class="r">{formatVnd(sum(st.details, (r) => r.billed))}</td><td /><td class="r">{formatVnd(sum(st.details, (r) => r.paid))}</td>
          </tr>
        </tbody>
      </table>

      <h2 class="stmt-h">Chưa thanh toán đến cuối kỳ <En>/ Unpaid at end of period</En></h2>
      <table class="bill-table stmt-table">
        <colgroup><col class="c-no" /><col class="c-num" /><col class="c-date" /><col class="c-date" /><col /><col class="c-amt" /></colgroup>
        <thead>
          <tr>
            <th>STT<br /><En>No.</En></th><th>Số phiếu<br /><En>Bill no.</En></th><th>Ngày lập<br /><En>Date</En></th>
            <th>Hạn TT<br /><En>Due</En></th><th class="r">Số ngày quá hạn<br /><En>Days overdue</En></th><th class="r">Số tiền<br /><En>Amount</En></th>
          </tr>
        </thead>
        <tbody>
          {st.unpaid.map((r, i) => (
            <tr key={r.number} class="stmt-keep">
              <td>{i + 1}</td><td>{r.number}</td><td>{date(r.billDate)}</td><td>{date(r.dueDate)}</td>
              <td class="r">{r.daysOverdue || ''}</td><td class="r">{formatVnd(r.total)}</td>
            </tr>
          ))}
          {st.unpaid.length === 0 && <tr><td /><td colSpan={5}>{NONE}</td></tr>}
          <tr class="bill-total stmt-total">
            <td colSpan={5}>Tổng cộng <En>/ Total</En></td><td class="r">{formatVnd(sum(st.unpaid, (r) => r.total))}</td>
          </tr>
        </tbody>
      </table>

      <div class="stmt-end stmt-keep">
        {showPay && (
          <div class="bill-pay stmt-bank">
            {qrDataUrl && <img class="bill-qr" src={qrDataUrl} alt="VietQR" />}
            <div>
              <div><b>Thông tin chuyển khoản</b> <En>/ Bank transfer</En></div>
              <div>Ngân hàng <En>/ Bank:</En> {bank ? `${bank.shortName} – ${bank.name}` : ''}</div>
              <div>Số tài khoản <En>/ Account:</En> <b>{acc!.accountNumber}</b></div>
              {acc!.accountHolder && <div>Chủ tài khoản <En>/ Holder:</En> {acc!.accountHolder}</div>}
              <div>Số tiền <En>/ Amount:</En> <b>{formatVnd(st.closing)}</b></div>
              <div>Nội dung <En>/ Reference:</En> <b>{st.reference}</b></div>
            </div>
          </div>
        )}
        <p>
          Đề nghị Quý khách kiểm tra, xác nhận số dư trên và phản hồi trước ngày <b>{formatDateVn(st.confirmBy)}</b>.
          <br /><En>{`Please check and confirm the balance above by ${formatDateVn(st.confirmBy)}.`}</En>
        </p>
        <div class="bill-sign">
          <div><b>Bên A / Party A</b><br /><En>(Ký, ghi rõ họ tên / Sign and name)</En><div class="bill-sign-space" /><div>{s.preparedBy}</div></div>
          <div><b>Bên B / Customer</b><br /><En>(Ký, ghi rõ họ tên / Sign and name)</En><div class="bill-sign-space" /></div>
        </div>
      </div>
    </div>
  );
}
