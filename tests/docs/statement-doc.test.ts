import { readFileSync } from 'node:fs';
import { statementDocData } from '../../src/docs/placeholders';
import { renderDocx } from '../../src/docs/render';
import { inspectTemplate } from '../../src/docs/inspect';
import { buildStatement } from '../../src/domain/statement';
import { DEFAULT_SETTINGS, type Bill, type Customer } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { makeDocx, docxText, docxMedia, PNG_1PX } from './makeDocx';

const customer: Customer = { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '45 Trần Phú', taxId: '0109876543', contactPerson: 'Chị Lan', email: '', phone: '', archived: false };
const s = {
  ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH SAO MAI', taxId: '0312345678', preparedBy: 'Nguyễn Văn An',
  bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: 'SAO MAI' }], defaultBankAccountId: 'a1',
};
const line = { nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details: [] };
let n = 0;
const bill = (billDate: string, paidDate: string | null = null): Bill => {
  n++;
  return sampleBill({ id: `b${n}`, number: `TT-2026-00${10 + n}`, customerId: 'c1', billDate, dueDate: billDate, paidDate, status: paidDate ? 'paid' : 'sent', lines: [line], vatRate: 8 });
};
const bills = [bill('2025-12-10', '2026-01-05'), bill('2025-11-01'), bill('2026-03-01', '2026-03-20'), bill('2026-11-01'), bill('2026-12-20', '2027-01-03')];
const st = buildStatement(bills, customer, '2026-01-01', '2026-12-31', '2027-01-10');

describe('statement Word document', () => {
  it('statement doc data', () => {
    const d = statementDocData(st, s);
    expect(d).toMatchObject({
      so_doi_chieu: 'ĐC-20261231-6543', ngay_lap: '10/01/2027', tu_ngay: '01/01/2026', den_ngay: '31/12/2026',
      so_du_dau_ky: '2.160.000', phat_sinh: '3.240.000', da_thanh_toan: '2.160.000', so_du_cuoi_ky: '3.240.000',
      so_du_cuoi_ky_chu: 'Ba triệu hai trăm bốn mươi nghìn đồng.', noi_dung_ck: 'DC202612316543', han_xac_nhan: '20/01/2027',
      so_tai_khoan: '0071000123456', chu_tai_khoan: 'SAO MAI', con_no: true, ben_a_ten: 'CÔNG TY TNHH SAO MAI', ben_b_ten: 'Công ty CP Hoa Sen Xanh',
    });
    expect((d.chua_thanh_toan as Record<string, string>[]).map((r) => r.so_phieu)).toEqual(st.unpaid.map((r) => r.number));
    expect((d.chi_tiet_cong_no as Record<string, string>[])[0]).toEqual({
      stt: '1', so_phieu: st.details[0].number, ngay: '10/12/2025', hop_dong: '', phat_sinh: '', ngay_thanh_toan: '05/01/2026', thanh_toan: '1.080.000',
    });
    expect(Object.values(d).every((v) => v !== null && v !== undefined)).toBe(true);
  });

  it('statement starter renders', async () => {
    const buf = readFileSync('src/docs/starters/statement.docx');
    const template = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const out = await renderDocx(template, statementDocData(st, s), { qr: PNG_1PX });
    const text = await docxText(out);
    expect(text).not.toContain('{');
    expect(text).toContain('3.240.000');
    for (const r of st.unpaid) expect(text).toContain(r.number);
    expect((await docxMedia(out)).length).toBe(1);
    const r = await inspectTemplate(template, 'statement');
    expect({ unknown: r.unknown, unavailable: r.unavailable, errors: r.errors }).toEqual({ unknown: [], unavailable: [], errors: [] });
  });

  it('checker kind', async () => {
    const r = await inspectTemplate(await makeDocx(['{so_du_cuoi_ky} {so_hop_dong} {ben_b_ten} {IMAGE qr()}']), 'statement');
    expect([r.unknown, r.unavailable, r.errors]).toEqual([[], ['so_hop_dong'], []]);
  });
});
