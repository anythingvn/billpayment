import type { DocKind } from '../domain/types';

export interface PlaceholderInfo {
  key: string;
  group: 'benA' | 'benB' | 'contract' | 'addendum' | 'bill' | 'tables' | 'flags' | 'images';
  vi: string;
  en: string;
  example: string;
  kinds: DocKind[];
}

const ALL: DocKind[] = ['contract', 'addendum', 'bill'];
const CA: DocKind[] = ['contract', 'addendum'];
const A: DocKind[] = ['addendum'];
const B: DocKind[] = ['bill'];

const p = (group: PlaceholderInfo['group'], kinds: DocKind[], rows: [string, string, string, string][]): PlaceholderInfo[] =>
  rows.map(([key, vi, en, example]) => ({ key, group, vi, en, example, kinds }));

/** Every placeholder a template can use (spec §4), for the help list, the checker and suggestions. */
export const PLACEHOLDERS: PlaceholderInfo[] = [
  ...p('benA', ALL, [
    ['ben_a_ten', 'Tên bên A (doanh nghiệp của bạn)', 'Party A name (your business)', 'CÔNG TY TNHH THIẾT KẾ SAO MAI'],
    ['ben_a_mst', 'Mã số thuế bên A', 'Party A tax ID', '0312345678'],
    ['ben_a_dia_chi', 'Địa chỉ bên A', 'Party A address', '12 Lê Lợi, Q.1, TP.HCM'],
    ['ben_a_dien_thoai', 'Điện thoại bên A', 'Party A phone', '0901 234 567'],
    ['ben_a_email', 'Email bên A', 'Party A email', 'hello@saomai.vn'],
    ['nguoi_lap', 'Người lập', 'Prepared by', 'Nguyễn Văn An'],
  ]),
  ...p('benB', ALL, [
    ['ben_b_ten', 'Tên bên B (khách hàng)', 'Party B name (customer)', 'Công ty CP Hoa Sen Xanh'],
    ['ben_b_mst', 'Mã số thuế bên B', 'Party B tax ID', '0109876543'],
    ['ben_b_dia_chi', 'Địa chỉ bên B', 'Party B address', '45 Trần Phú, Hà Nội'],
    ['ben_b_nguoi_lien_he', 'Người liên hệ bên B', 'Party B contact person', 'Chị Lan'],
    ['ben_b_dien_thoai', 'Điện thoại bên B', 'Party B phone', '0987 654 321'],
    ['ben_b_email', 'Email bên B', 'Party B email', 'lan@hoasen.vn'],
  ]),
  ...p('contract', CA, [
    ['so_hop_dong', 'Số hợp đồng', 'Contract number', '12/2026/HĐDV-SM'],
    ['ten_hop_dong', 'Tên hợp đồng', 'Contract title', 'Hợp đồng thiết kế website'],
    ['ngay_ky', 'Ngày ký', 'Signing date', '15/09/2026'],
    ['ngay_ky_chu', 'Ngày ký bằng chữ', 'Signing date in words', 'ngày 15 tháng 09 năm 2026'],
    ['ngay_bat_dau', 'Ngày bắt đầu', 'Start date', '15/09/2026'],
    ['ngay_ket_thuc', 'Ngày kết thúc', 'End date', '14/09/2027'],
    ['gia_tri_truoc_thue', 'Giá trị trước thuế', 'Value before VAT', '20.000.000'],
    ['thue_suat', 'Thuế suất GTGT', 'VAT rate', '8%'],
    ['tien_thue', 'Tiền thuế GTGT', 'VAT amount', '1.600.000'],
    ['gia_tri', 'Giá trị hợp đồng (gồm thuế)', 'Contract value incl. VAT', '21.600.000'],
    ['gia_tri_bang_chu', 'Giá trị bằng chữ', 'Value in words (VI)', 'Hai mươi mốt triệu sáu trăm nghìn đồng.'],
    ['gia_tri_bang_chu_en', 'Giá trị bằng chữ (tiếng Anh)', 'Value in words (EN)', 'Twenty-one million six hundred thousand dong.'],
    ['dieu_khoan_thanh_toan', 'Điều khoản thanh toán', 'Payment terms', 'Thanh toán trong 10 ngày'],
    ['so_ngay_thanh_toan', 'Số ngày thanh toán', 'Payment days', '10'],
    ['hinh_thuc_thanh_toan', 'Hình thức thanh toán', 'Billing method', 'Theo đợt'],
  ]),
  ...p('addendum', A, [
    ['so_phu_luc', 'Số phụ lục', 'Addendum number', 'PL01'],
    ['ten_phu_luc', 'Tên phụ lục', 'Addendum title', 'Phụ lục 01'],
    ['ngay_ky_phu_luc', 'Ngày ký phụ lục', 'Addendum signing date', '01/10/2026'],
    ['ngay_ky_phu_luc_chu', 'Ngày ký phụ lục bằng chữ', 'Addendum date in words', 'ngày 01 tháng 10 năm 2026'],
    ['loai_phu_luc', 'Loại phụ lục', 'Addendum type', 'Bổ sung công việc'],
    ['ngay_hieu_luc', 'Ngày hiệu lực', 'Effective date', '01/01/2027'],
    ['pl_gia_tri_truoc_thue', 'Giá trị phụ lục trước thuế', 'Addendum value before VAT', '5.000.000'],
    ['pl_tien_thue', 'Tiền thuế của phụ lục', 'Addendum VAT', '400.000'],
    ['pl_gia_tri', 'Giá trị phụ lục', 'Addendum value', '5.400.000'],
    ['pl_gia_tri_bang_chu', 'Giá trị phụ lục bằng chữ', 'Addendum value in words (VI)', 'Năm triệu bốn trăm nghìn đồng.'],
    ['pl_gia_tri_bang_chu_en', 'Giá trị phụ lục bằng chữ (tiếng Anh)', 'Addendum value in words (EN)', 'Five million four hundred thousand dong.'],
    ['pl_dieu_khoan_thanh_toan', 'Điều khoản thanh toán của phụ lục', 'Addendum payment terms', ''],
    ['pl_so_ngay_thanh_toan', 'Số ngày thanh toán của phụ lục', 'Addendum payment days', '10'],
    ['pl_hinh_thuc_thanh_toan', 'Hình thức thanh toán của phụ lục', 'Addendum billing method', 'Theo thực tế sử dụng'],
  ]),
  ...p('bill', B, [
    ['so_phieu', 'Số phiếu', 'Bill number', 'TT-2026-0012'],
    ['ngay_phieu', 'Ngày phiếu', 'Bill date', '26/09/2026'],
    ['han_thanh_toan', 'Hạn thanh toán', 'Due date', '06/10/2026'],
    ['can_cu_hop_dong', 'Căn cứ hợp đồng', 'Contract reference (VI)', 'Căn cứ Hợp đồng số 12/2026/HĐDV-SM ký ngày 15/09/2026'],
    ['can_cu_hop_dong_en', 'Căn cứ hợp đồng (tiếng Anh)', 'Contract reference (EN)', 'Under Contract No. 12/2026/HĐDV-SM dated 15/09/2026'],
    ['ngan_hang', 'Ngân hàng', 'Bank', 'Vietcombank – Ngân hàng TMCP Ngoại thương Việt Nam'],
    ['so_tai_khoan', 'Số tài khoản', 'Account number', '0071000123456'],
    ['chu_tai_khoan', 'Chủ tài khoản', 'Account holder', 'CONG TY TNHH THIET KE SAO MAI'],
    ['noi_dung_ck', 'Nội dung chuyển khoản', 'Payment reference', 'TT20260012'],
    ['ghi_chu_cuoi', 'Ghi chú cuối phiếu', 'Footer note', 'Hóa đơn GTGT điện tử sẽ được xuất sau khi thanh toán.'],
    ['tong_truoc_thue', 'Cộng trước thuế', 'Subtotal', '19.400.000'],
    ['tong_cong', 'Tổng cộng', 'Total', '20.952.000'],
    ['tong_bang_chu', 'Tổng cộng bằng chữ', 'Total in words (VI)', 'Hai mươi triệu chín trăm năm mươi hai nghìn đồng.'],
    ['tong_bang_chu_en', 'Tổng cộng bằng chữ (tiếng Anh)', 'Total in words (EN)', 'Twenty million nine hundred fifty-two thousand dong.'],
  ]),
  ...p('tables', ALL, [
    ['dich_vu', 'Bảng dịch vụ (lặp mỗi dòng)', 'Services table (repeats per line)', 'Row above: {FOR d IN dich_vu} · row: {$d.ten} … · row below: {END-FOR d}'],
    ['dich_vu.stt', 'STT', 'No.', '1'], ['dich_vu.ten', 'Tên dịch vụ', 'Service name', 'Thiết kế logo'],
    ['dich_vu.ten_en', 'Tên dịch vụ (tiếng Anh)', 'Service name (EN)', 'Logo design'],
    ['dich_vu.chi_tiet', 'Chi tiết (nhiều dòng)', 'Detail lines', '3 phương án'],
    ['dich_vu.dvt', 'Đơn vị tính', 'Unit', 'bộ'], ['dich_vu.dvt_en', 'Đơn vị (tiếng Anh)', 'Unit (EN)', 'set'],
    ['dich_vu.so_luong', 'Số lượng', 'Quantity', '1'], ['dich_vu.don_gia', 'Đơn giá', 'Unit price', '5.000.000'],
    ['dich_vu.thanh_tien', 'Thành tiền', 'Amount', '5.000.000'],
  ]),
  ...p('tables', CA, [
    ['dot_thanh_toan', 'Bảng đợt thanh toán', 'Instalments table', 'Row above: {FOR t IN dot_thanh_toan} · row: {$t.ten} … · row below: {END-FOR t}'],
    ['dot_thanh_toan.stt', 'STT', 'No.', '1'], ['dot_thanh_toan.ten', 'Tên đợt', 'Instalment name', 'Đợt 1 – Tạm ứng'],
    ['dot_thanh_toan.ty_le', 'Tỷ lệ', 'Share', '50%'], ['dot_thanh_toan.so_tien', 'Số tiền (trước thuế)', 'Amount before VAT', '10.000.000'],
    ['dot_thanh_toan.thoi_han', 'Thời hạn', 'When', 'Khi ký hợp đồng'],
    ['ky_thanh_toan', 'Bảng kỳ thanh toán', 'Periods table', 'Row above: {FOR k IN ky_thanh_toan} · row: {$k.ky} … · row below: {END-FOR k}'],
    ['ky_thanh_toan.stt', 'STT', 'No.', '1'], ['ky_thanh_toan.ky', 'Kỳ', 'Period', 'Tháng 10/2026'],
    ['ky_thanh_toan.so_tien', 'Số tiền (trước thuế)', 'Amount before VAT', '800.000'],
  ]),
  ...p('flags', ALL, [
    ['co_vat', 'Có thuế GTGT', 'VAT applies', '{IF co_vat} … {END-IF}'],
    ['co_hop_dong', 'Có hợp đồng', 'Linked to a contract', '{IF co_hop_dong} … {END-IF}'],
    ['la_phu_luc', 'Là phụ lục', 'Is an addendum', '{IF la_phu_luc} … {END-IF}'],
    ['la_ban_nhap', 'Là bản nháp', 'Is a draft', '{IF la_ban_nhap}BẢN NHÁP{END-IF}'],
    ['theo_dot', 'Thanh toán theo đợt', 'Paid in instalments', '{IF theo_dot} … {END-IF}'],
    ['theo_ky', 'Thanh toán theo kỳ', 'Paid per period', '{IF theo_ky} … {END-IF}'],
    ['theo_thuc_te', 'Theo thực tế sử dụng', 'Pay per use', '{IF theo_thuc_te} … {END-IF}'],
  ]),
  ...p('images', B, [['qr', 'Mã VietQR (3 × 3 cm)', 'VietQR code (3 × 3 cm)', '{IMAGE qr()}']]),
  ...p('images', ALL, [['logo', 'Logo (rộng tối đa 4 cm)', 'Logo (max 4 cm wide)', '{IMAGE logo()}']]),
];

const KEYS = new Set(PLACEHOLDERS.map((x) => x.key));
export const isKnownPlaceholder = (name: string) => KEYS.has(name);

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** The closest known placeholder (edit distance ≤ 2), for "did you mean …?". */
export function suggestPlaceholder(name: string): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const k of KEYS) {
    if (k.includes('.')) continue;
    const d = distance(name, k);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
}
