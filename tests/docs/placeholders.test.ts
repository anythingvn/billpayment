import { contractDocData, addendumDocData, billDocData } from '../../src/docs/placeholders';
import { PLACEHOLDERS, suggestPlaceholder } from '../../src/docs/catalog';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';

const settings: Settings = {
  ...DEFAULT_SETTINGS, businessName: 'CÔNG TY TNHH THIẾT KẾ SAO MAI', taxId: '0312345678', address: '12 Lê Lợi', preparedBy: 'Nguyễn Văn An',
  bankAccounts: [{ id: 'a', bankBin: '970436', accountNumber: '0071000123456', accountHolder: 'SAO MAI' }], defaultBankAccountId: 'a',
};

describe('contract data', () => {
  it('values, words, instalments', () => {
    const d = contractDocData(sampleContract(), settings);
    expect(d).toMatchObject({
      so_hop_dong: '12/2026/HĐDV-SM', ngay_ky: '15/09/2026', ngay_ky_chu: 'ngày 15 tháng 09 năm 2026', ngay_ket_thuc: '14/09/2027',
      gia_tri_truoc_thue: '20.000.000', thue_suat: '8%', tien_thue: '1.600.000', gia_tri: '21.600.000',
      gia_tri_bang_chu: 'Hai mươi mốt triệu sáu trăm nghìn đồng.', hinh_thuc_thanh_toan: 'Theo đợt',
      theo_dot: true, theo_ky: false, la_phu_luc: false, la_ban_nhap: false, ben_b_ten: 'Công ty CP Hoa Sen Xanh',
    });
    expect(d.dot_thanh_toan).toEqual([
      { stt: '1', ten: 'Đợt 1 – Tạm ứng', ty_le: '50%', so_tien: '10.000.000', thoi_han: 'Khi ký hợp đồng' },
      { stt: '2', ten: 'Đợt 2 – Nghiệm thu', ty_le: '50%', so_tien: '10.000.000', thoi_han: 'Khi nghiệm thu' },
    ]);
    expect(d.ky_thanh_toan).toEqual([]);
  });
  it('periodic contract', () => {
    const d = contractDocData(sampleContract({ plan: { type: 'periodic', every: 'month', amount: 800000, first: '2026-10', last: '2027-09' } }), settings);
    expect([d.gia_tri_truoc_thue, d.hinh_thuc_thanh_toan, d.theo_ky]).toEqual(['9.600.000', 'Theo tháng', true]);
    expect((d.ky_thanh_toan as unknown[]).length).toBe(12);
    expect((d.ky_thanh_toan as Record<string, string>[])[0]).toEqual({ stt: '1', ky: 'Tháng 10/2026', so_tien: '800.000' });
  });
  it('Bên A uses the saved copy when present', () => {
    const saved = { businessName: 'OLD', taxId: '', address: '', phone: '', email: '', logoDataUrl: null, preparedBy: '' };
    expect(contractDocData(sampleContract({ business: saved }), settings).ben_a_ten).toBe('OLD');
    expect(contractDocData(sampleContract(), settings).ben_a_ten).toBe('CÔNG TY TNHH THIẾT KẾ SAO MAI');
  });
});

describe('addendum data', () => {
  it('parent values plus the addendum own values', () => {
    const d = addendumDocData(sampleAddendum(), sampleContract(), settings);
    expect(d).toMatchObject({
      so_hop_dong: '12/2026/HĐDV-SM', so_phu_luc: 'PL01', loai_phu_luc: 'Bổ sung công việc', ngay_hieu_luc: '',
      pl_gia_tri: '5.400.000', gia_tri: '21.600.000', la_phu_luc: true,
    });
    expect((d.dich_vu as Record<string, string>[]).map((r) => r.ten)).toEqual(['Ứng dụng di động']);
  });
});

describe('bill data', () => {
  it('bill fields, bank, reference line, VAT flag, draft', () => {
    const d = billDocData(sampleBill({ status: 'sent' }), settings);
    expect(d).toMatchObject({ so_phieu: 'TT-2026-0012', ngay_phieu: '25/09/2026', tong_cong: '5.400.000', noi_dung_ck: 'TT20260012', can_cu_hop_dong: '', co_hop_dong: false, co_vat: true });
    expect(String(d.ngan_hang)).toContain('Vietcombank');
    expect(d.tong_bang_chu).toBe('Năm triệu bốn trăm nghìn đồng.');
    const ref = { contractId: 'k1', itemKey: null, number: '12/2026/HĐDV-SM', signedDate: '2026-09-15', parentNumber: null, parentSignedDate: null };
    const linked = billDocData(sampleBill({ contractRef: ref }), settings);
    expect([linked.can_cu_hop_dong, linked.can_cu_hop_dong_en, linked.co_hop_dong]).toEqual([
      'Căn cứ Hợp đồng số 12/2026/HĐDV-SM ký ngày 15/09/2026', 'Under Contract No. 12/2026/HĐDV-SM dated 15/09/2026', true]);
    const noVat = billDocData(sampleBill({ vatRate: 'none' }), settings);
    expect([noVat.co_vat, noVat.thue_suat]).toEqual([false, 'Không áp dụng']);
    expect(billDocData(sampleBill({ status: 'draft' }), settings).la_ban_nhap).toBe(true);
  });
  it('dich_vu rows join detail lines with new lines', () => {
    const line = { nameVi: 'Website', nameEn: 'Web', unitVi: 'gói', unitEn: 'pkg', qty: 2, unitPrice: 1500000, details: ['Trang chủ', 'Tên miền'] };
    const [row] = billDocData(sampleBill({ lines: [line] }), settings).dich_vu as Record<string, string>[];
    expect(row).toEqual({ stt: '1', ten: 'Website', ten_en: 'Web', chi_tiet: 'Trang chủ\nTên miền', dvt: 'gói', dvt_en: 'pkg', so_luong: '2', don_gia: '1.500.000', thanh_tien: '3.000.000' });
  });
});

describe('never null and catalogue', () => {
  const all = () => [
    contractDocData(sampleContract({ endDate: null }), DEFAULT_SETTINGS),
    addendumDocData(sampleAddendum(), sampleContract(), DEFAULT_SETTINGS),
    billDocData(sampleBill(), DEFAULT_SETTINGS),
  ];
  it('never null', () => {
    const walk = (v: unknown): void => {
      expect(v === null || v === undefined).toBe(false);
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object') Object.values(v as object).forEach(walk);
      else expect(['string', 'boolean']).toContain(typeof v);
    };
    all().forEach(walk);
  });
  it('catalogue lists every key and suggests', () => {
    const keys = new Set(PLACEHOLDERS.map((p) => p.key));
    for (const d of all()) {
      for (const [k, v] of Object.entries(d)) {
        expect(keys.has(k), k).toBe(true);
        if (Array.isArray(v) && v[0]) for (const f of Object.keys(v[0])) expect(keys.has(`${k}.${f}`), `${k}.${f}`).toBe(true);
      }
    }
    expect(keys.has('qr') && keys.has('logo')).toBe(true);
    expect(suggestPlaceholder('so_hop_dongg')).toBe('so_hop_dong');
    expect(suggestPlaceholder('xyz')).toBeNull();
  });
});
