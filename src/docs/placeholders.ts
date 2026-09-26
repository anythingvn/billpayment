import type { Bill, BillLine, BusinessSnapshot, Contract, CustomerSnapshot, Settings, VatRate } from '../domain/types';
import { computeTotals } from '../domain/money';
import { formatDateVn, formatVnd } from '../domain/format';
import { vndToWordsEn, vndToWordsVi } from '../domain/words';
import { contractValue, instalmentAmounts, periodKeys, periodLabel, planValueBeforeVat, valueBeforeVat } from '../domain/contractPlan';
import { referenceLine } from '../domain/contractFill';
import { billBankAccount, businessSnapshot, defaultFooterText } from '../domain/settings';
import { bankByBin } from '../domain/banks';
import { paymentReference } from '../domain/vietqr';

/** Data handed to a Word template: text values, flags and table rows. Never null or undefined. */
export type DocData = Record<string, string | boolean | Record<string, string>[]>;

const date = (iso: string | null | undefined) => (iso ? formatDateVn(iso) : '');
const dateWords = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `ngày ${d} tháng ${m} năm ${y}`;
};
const vatText = (rate: VatRate) => (rate === 'none' ? 'Không áp dụng' : `${rate}%`);

function benA(b: BusinessSnapshot) {
  return {
    ben_a_ten: b.businessName, ben_a_mst: b.taxId, ben_a_dia_chi: b.address,
    ben_a_dien_thoai: b.phone, ben_a_email: b.email, nguoi_lap: b.preparedBy,
  };
}

function benB(c: CustomerSnapshot) {
  return {
    ben_b_ten: c.name, ben_b_mst: c.taxId, ben_b_dia_chi: c.address,
    ben_b_nguoi_lien_he: c.contactPerson, ben_b_dien_thoai: c.phone, ben_b_email: c.email,
  };
}

function serviceRows(lines: BillLine[], vatRate: VatRate): Record<string, string>[] {
  const t = computeTotals(lines, vatRate);
  return lines.map((l, i) => ({
    stt: String(i + 1), ten: l.nameVi, ten_en: l.nameEn, chi_tiet: (l.details ?? []).filter((x) => x.trim()).join('\n'),
    dvt: l.unitVi, dvt_en: l.unitEn, so_luong: String(l.qty), don_gia: formatVnd(l.unitPrice), thanh_tien: formatVnd(t.lineAmounts[i]),
  }));
}

/** Values, words, method and payment tables of one contract or addendum record. */
function recordValues(c: Contract) {
  const before = planValueBeforeVat(c);
  const total = contractValue(c);
  const plan = c.plan;
  const method = plan.type === 'instalments' ? 'Theo đợt'
    : plan.type === 'periodic' ? (plan.every === 'quarter' ? 'Theo quý' : 'Theo tháng') : 'Theo thực tế sử dụng';
  const dot = plan.type === 'instalments'
    ? (() => {
      const amounts = instalmentAmounts(plan.items, valueBeforeVat(c));
      return plan.items.map((i, n) => ({
        stt: String(n + 1), ten: i.name, ty_le: 'percent' in i.share ? `${i.share.percent}%` : '', so_tien: formatVnd(amounts[n]),
        thoi_han: i.due.on === 'signing' ? 'Khi ký hợp đồng' : i.due.on === 'acceptance' ? 'Khi nghiệm thu' : date(i.due.date),
      }));
    })()
    : [];
  const ky = plan.type === 'periodic'
    ? periodKeys(plan).map((key, n) => {
      return { stt: String(n + 1), ky: periodLabel(key, plan.every).vi, so_tien: formatVnd(plan.amount) };
    })
    : [];
  return {
    values: {
      gia_tri_truoc_thue: formatVnd(before), thue_suat: vatText(c.vatRate), tien_thue: formatVnd(total - before), gia_tri: formatVnd(total),
      gia_tri_bang_chu: vndToWordsVi(total), gia_tri_bang_chu_en: vndToWordsEn(total),
      dieu_khoan_thanh_toan: c.paymentTerms, so_ngay_thanh_toan: String(c.paymentDays), hinh_thuc_thanh_toan: method,
    },
    tables: { dich_vu: serviceRows(c.lines, c.vatRate), dot_thanh_toan: dot, ky_thanh_toan: ky },
    flags: { co_vat: c.vatRate !== 'none', theo_dot: plan.type === 'instalments', theo_ky: plan.type === 'periodic', theo_thuc_te: plan.type === 'perUse' },
  };
}

function contractFields(c: Contract) {
  return {
    so_hop_dong: c.number, ten_hop_dong: c.title, ngay_ky: date(c.signedDate), ngay_ky_chu: dateWords(c.signedDate),
    ngay_bat_dau: date(c.startDate), ngay_ket_thuc: date(c.endDate),
  };
}

export function contractDocData(c: Contract, s: Settings): DocData {
  const r = recordValues(c);
  return {
    ...benA(c.business ?? businessSnapshot(s)), ...benB(c.customer), ...contractFields(c), ...r.values, ...r.tables, ...r.flags,
    co_hop_dong: true, la_phu_luc: false, la_ban_nhap: c.status === 'draft',
  };
}

export function addendumDocData(a: Contract, parent: Contract, s: Settings): DocData {
  const p = recordValues(parent);
  const own = recordValues(a);
  return {
    ...benA(a.business ?? parent.business ?? businessSnapshot(s)), ...benB(parent.customer), ...contractFields(parent), ...p.values,
    so_phu_luc: a.number, ten_phu_luc: a.title, ngay_ky_phu_luc: date(a.signedDate), ngay_ky_phu_luc_chu: dateWords(a.signedDate),
    loai_phu_luc: a.effect === 'changesTerms' ? 'Thay đổi điều khoản' : 'Bổ sung công việc', ngay_hieu_luc: date(a.effectiveDate),
    pl_gia_tri_truoc_thue: own.values.gia_tri_truoc_thue, pl_tien_thue: own.values.tien_thue, pl_gia_tri: own.values.gia_tri,
    pl_gia_tri_bang_chu: own.values.gia_tri_bang_chu, pl_gia_tri_bang_chu_en: own.values.gia_tri_bang_chu_en,
    pl_dieu_khoan_thanh_toan: own.values.dieu_khoan_thanh_toan, pl_so_ngay_thanh_toan: own.values.so_ngay_thanh_toan,
    pl_hinh_thuc_thanh_toan: own.values.hinh_thuc_thanh_toan,
    ...own.tables, ...own.flags,
    co_hop_dong: true, la_phu_luc: true, la_ban_nhap: a.status === 'draft',
  };
}

export function billDocData(bill: Bill, s: Settings): DocData {
  const t = computeTotals(bill.lines, bill.vatRate);
  const acc = billBankAccount(bill, s);
  const bank = acc ? bankByBin(acc.bankBin) : undefined;
  const ref = bill.contractRef ? referenceLine(bill.contractRef) : { vi: '', en: '' };
  const total = Number.isInteger(t.total) && t.total >= 0 ? t.total : 0;
  return {
    ...benA(bill.business ?? businessSnapshot(s)), ...benB(bill.customer),
    so_phieu: bill.number, ngay_phieu: date(bill.billDate), han_thanh_toan: date(bill.dueDate),
    can_cu_hop_dong: ref.vi, can_cu_hop_dong_en: ref.en,
    ngan_hang: bank ? `${bank.shortName} – ${bank.name}` : '', so_tai_khoan: acc?.accountNumber ?? '', chu_tai_khoan: acc?.accountHolder ?? '',
    noi_dung_ck: paymentReference(bill.number), ghi_chu_cuoi: (bill.footerNote ?? defaultFooterText(s)).trim(),
    tong_truoc_thue: formatVnd(t.subtotal), thue_suat: vatText(bill.vatRate), tien_thue: formatVnd(t.vat), tong_cong: formatVnd(t.total),
    tong_bang_chu: vndToWordsVi(total), tong_bang_chu_en: vndToWordsEn(total),
    dich_vu: serviceRows(bill.lines, bill.vatRate), dot_thanh_toan: [], ky_thanh_toan: [],
    co_vat: bill.vatRate !== 'none', co_hop_dong: !!bill.contractRef, la_phu_luc: false, la_ban_nhap: bill.status === 'draft',
    theo_dot: false, theo_ky: false, theo_thuc_te: false,
  };
}
