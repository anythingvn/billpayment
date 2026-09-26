/**
 * Generates the starter Word templates in src/docs/starters/ (run: npm run make-starters).
 * They are plain .docx files with {placeholders}; owners edit them in Word (letterhead, clauses) and upload them.
 */
import { writeFileSync } from 'node:fs';
import {
  AlignmentType, BorderStyle, Document, Header, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';

const FONT = 'Arial';
/** Usable A4 width in twips (11906 minus 1100 + 1000 margins). */
const PAGE_W = 9806;
const t = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 22, bold: o.bold, italics: o.italics, color: o.color });
const p = (runs: (string | TextRun)[], o: { center?: boolean; right?: boolean; after?: number } = {}) => new Paragraph({
  children: runs.map((r) => (typeof r === 'string' ? t(r) : r)),
  alignment: o.center ? AlignmentType.CENTER : o.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
  spacing: { after: o.after ?? 80 },
});
const en = (text: string) => t(text, { italics: true, color: '666666' });
const heading = (vi: string, e: string) => p([t(vi, { bold: true }), ' ', en(`/ ${e}`)], { after: 120 });
const border = { style: BorderStyle.SINGLE, size: 4, color: '333333' };
const borders = { top: border, bottom: border, left: border, right: border };
const cell = (children: Paragraph[]) => new TableCell({ children, borders });
const headCell = (vi: string, e: string) => cell([p([t(vi, { bold: true })], { after: 0 }), p([en(e)], { after: 0 })]);
/** A fixed-layout table; `percents` gives each column's share of the page width (Word needs the column grid). */
const table = (percents: number[], rows: TableRow[]) => {
  const columnWidths = percents.map((x) => Math.round((PAGE_W * x) / 100));
  const sized = rows.map((r) => new TableRow({
    children: (r as unknown as { options: { children: TableCell[] } }).options.children.map((c, i) => new TableCell({
      ...(c as unknown as { options: object }).options, width: { size: columnWidths[i], type: WidthType.DXA },
    } as never)),
  }));
  return new Table({ rows: sized, columnWidths, layout: TableLayoutType.FIXED, width: { size: PAGE_W, type: WidthType.DXA } });
};
const row = (cells: TableCell[]) => new TableRow({ children: cells });
/** Row loop: a FOR marker row, the repeated row, an END-FOR marker row (both marker rows vanish when filled). */
const loopRows = (open: string, close: string, body: TableCell[]) => {
  const marker = (text: string) => row(body.map((_, i) => cell([p([i === 0 ? text : ''], { after: 0 })])));
  return [marker(open), row(body), marker(close)];
};
const logoHeader = () => new Header({ children: [p(['{IMAGE logo()}'])] });

/** Services table: header row + one row repeated per service line. */
const servicesTable = () => table([7, 41, 10, 8, 16, 18], [
  row([headCell('STT', 'No.'), headCell('Nội dung dịch vụ', 'Service'), headCell('ĐVT', 'Unit'), headCell('SL', 'Qty'),
    headCell('Đơn giá', 'Unit price'), headCell('Thành tiền', 'Amount')]),
  ...loopRows('{FOR d IN dich_vu}', '{END-FOR d}', [
    cell([p(['{$d.stt}'], { after: 0 })]),
    cell([p(['{$d.ten}'], { after: 0 }), p([en('{$d.ten_en}')], { after: 0 }), p([t('{$d.chi_tiet}', { size: 18 })], { after: 0 })]),
    cell([p(['{$d.dvt}'], { after: 0 }), p([en('{$d.dvt_en}')], { after: 0 })]),
    cell([p(['{$d.so_luong}'], { right: true, after: 0 })]),
    cell([p(['{$d.don_gia}'], { right: true, after: 0 })]),
    cell([p(['{$d.thanh_tien}'], { right: true, after: 0 })]),
  ]),
]);

const partyA = () => [
  heading('BÊN A (Bên cung cấp dịch vụ)', 'PARTY A (Service provider)'),
  p(['Tên / Name: ', t('{ben_a_ten}', { bold: true })]), p(['Mã số thuế / Tax ID: {ben_a_mst}']),
  p(['Địa chỉ / Address: {ben_a_dia_chi}']), p(['Điện thoại / Phone: {ben_a_dien_thoai} · Email: {ben_a_email}'], { after: 160 }),
];
const partyB = () => [
  heading('BÊN B (Khách hàng)', 'PARTY B (Customer)'),
  p(['Tên / Name: ', t('{ben_b_ten}', { bold: true })]), p(['Mã số thuế / Tax ID: {ben_b_mst}']),
  p(['Địa chỉ / Address: {ben_b_dia_chi}']), p(['Người liên hệ / Contact: {ben_b_nguoi_lien_he} · {ben_b_dien_thoai} · {ben_b_email}'], { after: 160 }),
];
const signatures = (left: string, leftEn: string, right: string, rightEn: string, leftName = '') => table([50, 50], [
  row([
    new TableCell({ children: [p([t(left, { bold: true })], { center: true }), p([en(leftEn)], { center: true }), p([''], { after: 900 }), p([leftName], { center: true })] }),
    new TableCell({ children: [p([t(right, { bold: true })], { center: true }), p([en(rightEn)], { center: true })] }),
  ]),
]);
const doc = (children: (Paragraph | Table)[]) => new Document({
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{ headers: { default: logoHeader() }, properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1000 } } }, children }],
});

const contract = doc([
  p([t('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true })], { center: true, after: 0 }),
  p([t('Độc lập – Tự do – Hạnh phúc', { bold: true })], { center: true, after: 240 }),
  p([t('HỢP ĐỒNG DỊCH VỤ', { bold: true, size: 32 })], { center: true, after: 0 }),
  p([en('SERVICE CONTRACT')], { center: true, after: 0 }),
  p(['Số / No.: ', t('{so_hop_dong}', { bold: true }), ' · {ten_hop_dong}'], { center: true, after: 240 }),
  p(['Hôm nay, {ngay_ky_chu}, chúng tôi gồm: ', en('Today, the parties are:')], { after: 160 }),
  ...partyA(), ...partyB(),
  heading('Điều 1 – Nội dung công việc', 'Article 1 – Scope of work'), servicesTable(), p([''], { after: 160 }),
  heading('Điều 2 – Giá trị hợp đồng', 'Article 2 – Contract value'),
  p(['Giá trị trước thuế / Value before VAT: {gia_tri_truoc_thue} ₫']),
  p(['Thuế GTGT / VAT ({thue_suat}): {tien_thue} ₫']),
  p([t('Tổng giá trị / Total value: {gia_tri} ₫', { bold: true })]),
  p(['Bằng chữ / In words: ', t('{gia_tri_bang_chu}', { italics: true }), ' ', en('({gia_tri_bang_chu_en})')], { after: 160 }),
  heading('Điều 3 – Thanh toán', 'Article 3 – Payment'),
  p(['Hình thức / Method: {hinh_thuc_thanh_toan}']),
  p(['{IF theo_dot}']),
  table([10, 40, 12, 20, 18], [
    row([headCell('Đợt', 'No.'), headCell('Nội dung', 'Instalment'), headCell('Tỷ lệ', 'Share'), headCell('Số tiền (trước thuế)', 'Amount before VAT'), headCell('Thời hạn', 'When')]),
    ...loopRows('{FOR i IN dot_thanh_toan}', '{END-FOR i}', [cell([p(['{$i.stt}'], { after: 0 })]), cell([p(['{$i.ten}'], { after: 0 })]),
      cell([p(['{$i.ty_le}'], { after: 0 })]), cell([p(['{$i.so_tien}'], { right: true, after: 0 })]), cell([p(['{$i.thoi_han}'], { after: 0 })])]),
  ]),
  p(['{END-IF}']),
  p(['{IF theo_ky}']),
  table([10, 50, 40], [
    row([headCell('STT', 'No.'), headCell('Kỳ', 'Period'), headCell('Số tiền (trước thuế)', 'Amount before VAT')]),
    ...loopRows('{FOR k IN ky_thanh_toan}', '{END-FOR k}', [cell([p(['{$k.stt}'], { after: 0 })]), cell([p(['{$k.ky}'], { after: 0 })]),
      cell([p(['{$k.so_tien}'], { right: true, after: 0 })])]),
  ]),
  p(['{END-IF}']),
  p(['{dieu_khoan_thanh_toan}']), p(['Thời hạn thanh toán / Payment due: {so_ngay_thanh_toan} ngày / days.'], { after: 160 }),
  heading('Điều 4 – Điều khoản khác', 'Article 4 – Other terms'),
  p(['[Nhập điều khoản của bạn / Enter your clauses]'], { after: 240 }),
  signatures('ĐẠI DIỆN BÊN A', 'FOR PARTY A', 'ĐẠI DIỆN BÊN B', 'FOR PARTY B'),
]);

const addendum = doc([
  p([t('PHỤ LỤC HỢP ĐỒNG SỐ {so_phu_luc}', { bold: true, size: 30 })], { center: true, after: 0 }),
  p([en('CONTRACT ADDENDUM No. {so_phu_luc}')], { center: true, after: 0 }),
  p(['Kèm theo Hợp đồng số {so_hop_dong} ký {ngay_ky_chu} ', en('(Attached to Contract No. {so_hop_dong} dated {ngay_ky})')], { center: true, after: 240 }),
  p(['Hôm nay, {ngay_ky_phu_luc_chu}, hai bên thống nhất: ', en('Today, the parties agree:')], { after: 160 }),
  ...partyA(), ...partyB(),
  heading('Nội dung phụ lục', 'Addendum content'),
  p(['Loại / Type: {loai_phu_luc}{IF ngay_hieu_luc} · Hiệu lực từ / Effective from: {ngay_hieu_luc}{END-IF}'], { after: 120 }),
  servicesTable(), p([''], { after: 120 }),
  p(['Giá trị trước thuế / Value before VAT: {pl_gia_tri_truoc_thue} ₫ · Thuế / VAT: {pl_tien_thue} ₫']),
  p([t('Giá trị phụ lục / Addendum value: {pl_gia_tri} ₫', { bold: true })]),
  p(['Bằng chữ / In words: ', t('{pl_gia_tri_bang_chu}', { italics: true })]),
  p(['Thanh toán / Payment: {pl_hinh_thuc_thanh_toan} · {pl_dieu_khoan_thanh_toan}'], { after: 160 }),
  p(['Các điều khoản khác của Hợp đồng giữ nguyên hiệu lực. ', en('All other terms of the Contract remain in force.')], { after: 240 }),
  signatures('ĐẠI DIỆN BÊN A', 'FOR PARTY A', 'ĐẠI DIỆN BÊN B', 'FOR PARTY B'),
]);

const bill = doc([
  table([60, 40], [row([
    new TableCell({ children: [p([t('{ben_a_ten}', { bold: true })], { after: 0 }), p(['MST / Tax ID: {ben_a_mst}'], { after: 0 }), p(['{ben_a_dia_chi}'], { after: 0 }), p(['{ben_a_dien_thoai}'], { after: 0 })] }),
    new TableCell({ children: [p(['Số / No.: ', t('{so_phieu}', { bold: true })], { right: true, after: 0 }), p(['Ngày / Date: {ngay_phieu}'], { right: true, after: 0 })] }),
  ])]),
  p([''], { after: 120 }),
  p([t('{IF la_ban_nhap}BẢN NHÁP / DRAFT{END-IF}', { bold: true, color: 'B91C1C' })], { center: true, after: 0 }),
  p([t('PHIẾU THANH TOÁN', { bold: true, size: 32 })], { center: true, after: 0 }),
  p([en('PAYMENT REQUEST')], { center: true, after: 200 }),
  p(['Kính gửi / To: ', t('{ben_b_ten}', { bold: true })], { after: 0 }),
  p(['Địa chỉ / Address: {ben_b_dia_chi}'], { after: 0 }),
  p(['MST / Tax ID: {ben_b_mst}'], { after: 0 }),
  p(['{IF co_hop_dong}{can_cu_hop_dong} / ', en('{can_cu_hop_dong_en}'), '{END-IF}'], { after: 160 }),
  servicesTable(),
  p(['Cộng / Subtotal: {tong_truoc_thue}'], { right: true, after: 0 }),
  p(['{IF co_vat}Thuế GTGT {thue_suat} / VAT: {tien_thue}{END-IF}'], { right: true, after: 0 }),
  p([t('Tổng cộng / Total (VND): {tong_cong}', { bold: true })], { right: true, after: 160 }),
  p(['Bằng chữ / In words: ', t('{tong_bang_chu}', { italics: true })], { after: 0 }),
  p([en('{tong_bang_chu_en}')], { after: 120 }),
  p(['Hạn thanh toán / Due date: ', t('{han_thanh_toan}', { bold: true })], { after: 120 }),
  table([25, 75], [row([
    new TableCell({ children: [p(['{IMAGE qr()}'])] }),
    new TableCell({ children: [
      p([t('Thông tin chuyển khoản', { bold: true }), ' ', en('/ Bank transfer')], { after: 0 }),
      p(['Ngân hàng / Bank: {ngan_hang}'], { after: 0 }), p(['Số tài khoản / Account: ', t('{so_tai_khoan}', { bold: true })], { after: 0 }),
      p(['Chủ tài khoản / Holder: {chu_tai_khoan}'], { after: 0 }), p(['Nội dung / Reference: ', t('{noi_dung_ck}', { bold: true })], { after: 0 }),
    ] }),
  ])]),
  p([''], { after: 160 }),
  signatures('Người lập phiếu', 'Prepared by', 'Khách hàng', 'Customer', '{nguoi_lap}'),
  p([t('{ghi_chu_cuoi}', { size: 18, color: '555555' })], { center: true }),
]);

const statement = doc([
  table([60, 40], [row([
    new TableCell({ children: [p([t('{ben_a_ten}', { bold: true })], { after: 0 }), p(['MST / Tax ID: {ben_a_mst}'], { after: 0 }), p(['{ben_a_dia_chi}'], { after: 0 }), p(['{ben_a_dien_thoai}'], { after: 0 })] }),
    new TableCell({ children: [p(['Số / No.: ', t('{so_doi_chieu}', { bold: true })], { right: true, after: 0 }), p(['Ngày lập / Date: {ngay_lap}'], { right: true, after: 0 })] }),
  ])]),
  p([''], { after: 120 }),
  p([t('BẢNG ĐỐI CHIẾU CÔNG NỢ', { bold: true, size: 32 })], { center: true, after: 0 }),
  p([en('STATEMENT OF ACCOUNT')], { center: true, after: 80 }),
  p(['Kỳ đối chiếu / Period: ', t('{tu_ngay} – {den_ngay}', { bold: true })], { center: true, after: 200 }),
  p(['Kính gửi / To: ', t('{ben_b_ten}', { bold: true })], { after: 0 }),
  p(['Địa chỉ / Address: {ben_b_dia_chi}'], { after: 0 }),
  p(['MST / Tax ID: {ben_b_mst}'], { after: 160 }),
  table([70, 30], [
    row([cell([p(['Số dư đầu kỳ / ', en('Opening balance')], { after: 0 })]), cell([p(['{so_du_dau_ky}'], { right: true, after: 0 })])]),
    row([cell([p(['Phát sinh trong kỳ / ', en('Billed in period')], { after: 0 })]), cell([p(['{phat_sinh}'], { right: true, after: 0 })])]),
    row([cell([p(['Đã thanh toán trong kỳ / ', en('Paid in period')], { after: 0 })]), cell([p(['{da_thanh_toan}'], { right: true, after: 0 })])]),
    row([cell([p([t('Số dư cuối kỳ / Closing balance', { bold: true })], { after: 0 })]), cell([p([t('{so_du_cuoi_ky}', { bold: true })], { right: true, after: 0 })])]),
  ]),
  p(['Bằng chữ / In words: ', t('{so_du_cuoi_ky_chu}', { italics: true })], { after: 0 }),
  p([en('{so_du_cuoi_ky_chu_en}')], { after: 160 }),
  heading('Chi tiết trong kỳ', 'Details'),
  table([7, 18, 13, 20, 14, 13, 15], [
    row([headCell('STT', 'No.'), headCell('Số phiếu', 'Bill no.'), headCell('Ngày lập', 'Date'), headCell('Hợp đồng', 'Contract'),
      headCell('Phát sinh', 'Billed'), headCell('Ngày TT', 'Paid on'), headCell('Thanh toán', 'Paid')]),
    ...loopRows('{FOR r IN chi_tiet_cong_no}', '{END-FOR r}', [
      cell([p(['{$r.stt}'], { after: 0 })]), cell([p(['{$r.so_phieu}'], { after: 0 })]), cell([p(['{$r.ngay}'], { after: 0 })]),
      cell([p(['{$r.hop_dong}'], { after: 0 })]), cell([p(['{$r.phat_sinh}'], { right: true, after: 0 })]),
      cell([p(['{$r.ngay_thanh_toan}'], { after: 0 })]), cell([p(['{$r.thanh_toan}'], { right: true, after: 0 })]),
    ]),
  ]),
  p([''], { after: 120 }),
  heading('Chưa thanh toán đến cuối kỳ', 'Unpaid at end of period'),
  table([7, 22, 16, 16, 17, 22], [
    row([headCell('STT', 'No.'), headCell('Số phiếu', 'Bill no.'), headCell('Ngày lập', 'Date'), headCell('Hạn TT', 'Due'),
      headCell('Quá hạn (ngày)', 'Days overdue'), headCell('Số tiền', 'Amount')]),
    ...loopRows('{FOR u IN chua_thanh_toan}', '{END-FOR u}', [
      cell([p(['{$u.stt}'], { after: 0 })]), cell([p(['{$u.so_phieu}'], { after: 0 })]), cell([p(['{$u.ngay}'], { after: 0 })]),
      cell([p(['{$u.han}'], { after: 0 })]), cell([p(['{$u.so_ngay_qua_han}'], { right: true, after: 0 })]),
      cell([p(['{$u.so_tien}'], { right: true, after: 0 })]),
    ]),
  ]),
  p([''], { after: 120 }),
  table([25, 75], [row([
    new TableCell({ children: [p(['{IMAGE qr()}'])] }),
    new TableCell({ children: [
      p(['{IF con_no}', t('Thông tin chuyển khoản', { bold: true }), ' ', en('/ Bank transfer'), '{END-IF}'], { after: 0 }),
      p(['{IF con_no}Ngân hàng / Bank: {ngan_hang}{END-IF}'], { after: 0 }),
      p(['{IF con_no}Số tài khoản / Account: {so_tai_khoan}{END-IF}'], { after: 0 }),
      p(['{IF con_no}Chủ tài khoản / Holder: {chu_tai_khoan}{END-IF}'], { after: 0 }),
      p(['{IF con_no}Nội dung / Reference: {noi_dung_ck}{END-IF}'], { after: 0 }),
    ] }),
  ])]),
  p(['Đề nghị Quý khách kiểm tra, xác nhận số dư trên và phản hồi trước ngày {han_xac_nhan}.'], { after: 0 }),
  p([en('Please check and confirm the balance above by {han_xac_nhan}.')], { after: 200 }),
  signatures('Bên A / Party A', 'Sign and name', 'Bên B / Customer', 'Sign and name', '{nguoi_lap}'),
]);

for (const [name, d] of [['contract', contract], ['addendum', addendum], ['bill', bill], ['statement', statement]] as const) {
  writeFileSync(`src/docs/starters/${name}.docx`, await Packer.toBuffer(d));
  console.log(`wrote src/docs/starters/${name}.docx`);
}
