import { renderDocx, DocTemplateError } from '../../src/docs/render';
import { inspectTemplate } from '../../src/docs/inspect';
import { contractDocxName, billDocxName, contractDrivePath } from '../../src/docs/fileNames';
import { billDocData, contractDocData } from '../../src/docs/placeholders';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';
import { makeDocx, docxText, docxXml, docxMedia, PNG_1PX, JPEG_1PX } from './makeDocx';

const line = (nameVi: string, details: string[] = []) => ({ nameVi, nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details });
const bill2 = () => sampleBill({ lines: [line('Thiết kế logo'), line('Website cơ bản')] });
// Row loops: the FOR marker in its own row above, the END-FOR marker in its own row below (both rows vanish).
const rowTable = [['{FOR d IN dich_vu}', '', '', ''], ['{$d.stt}', '{$d.ten}', '{$d.chi_tiet}', '{$d.thanh_tien}'], ['{END-FOR d}', '', '', '']];

describe('renderDocx', () => {
  it('fills values and repeats table rows', async () => {
    const out = await renderDocx(await makeDocx(['Số: {so_phieu}'], rowTable), billDocData(bill2(), DEFAULT_SETTINGS), {});
    const text = await docxText(out);
    expect(text).toContain('Số: TT-2026-0012');
    expect(text).toContain('Thiết kế logo');
    expect(text).toContain('Website cơ bản');
    const xml = await docxXml(out);
    expect(xml.match(/<w:tr[ >]/g)).toHaveLength(2); // one row per service line; the marker rows are gone
    expect(xml.match(/<w:tc>/g)).toHaveLength(8);
  });
  it('fills a placeholder split across runs', async () => {
    const out = await renderDocx(await makeDocx([['{so_', 'hop_dong}']]), contractDocData(sampleContract(), DEFAULT_SETTINGS), {});
    expect(await docxText(out)).toContain('12/2026/HĐDV-SM');
  });
  it('escapes special characters', async () => {
    const b = sampleBill({ customer: { ...sampleBill().customer, name: 'Công ty A & B <VN>' } });
    const out = await renderDocx(await makeDocx(['{ben_b_ten}']), billDocData(b, DEFAULT_SETTINGS), {});
    expect(await docxText(out)).toContain('Công ty A & B <VN>');
    expect(await docxXml(out)).toContain('A &amp; B &lt;VN&gt;');
  });
  it('turns new lines into Word line breaks', async () => {
    const b = sampleBill({ lines: [line('Website', ['Trang chủ', 'Tên miền'])] });
    const out = await renderDocx(await makeDocx([], rowTable), billDocData(b, DEFAULT_SETTINGS), {});
    expect(await docxText(out)).toContain('Trang chủ\nTên miền');
    const xml = await docxXml(out);
    expect(xml).toContain('<w:br/>');
    expect(xml).not.toMatch(/<w:t(?:\s[^>]*)?>[^<]*<w:br\/>/); // a break must not sit inside a text element
  });
  it('embeds the QR and a JPEG logo; no logo, no image', async () => {
    const tpl = await makeDocx(['{IMAGE qr()}', '{IMAGE logo()}']);
    const data = billDocData(sampleBill(), DEFAULT_SETTINGS);
    const both = await renderDocx(tpl, data, { qr: PNG_1PX, logo: { bytes: JPEG_1PX, extension: '.jpg' } });
    const media = await docxMedia(both);
    expect(media.some((m) => m.endsWith('.png'))).toBe(true);
    expect(media.some((m) => m.endsWith('.jpg'))).toBe(true);
    const qrOnly = await renderDocx(tpl, data, { qr: PNG_1PX, logo: null });
    expect(await docxMedia(qrOnly)).toHaveLength(1);
    expect(await docxMedia(await renderDocx(tpl, data, {}))).toHaveLength(0);
  });
  it('unknown placeholder', async () => {
    const e = await renderDocx(await makeDocx(['{so_hop_dongg}']), contractDocData(sampleContract(), DEFAULT_SETTINGS), {}).catch((x) => x);
    expect(e).toBeInstanceOf(DocTemplateError);
    expect(e.kind).toBe('unknown');
    expect(e.message).toBe('Unknown placeholder: so_hop_dongg (did you mean so_hop_dong?)');
  });
  it('unterminated loop', async () => {
    const e = await renderDocx(await makeDocx(['{FOR d IN dich_vu}{$d.ten}']), billDocData(sampleBill(), DEFAULT_SETTINGS), {}).catch((x) => x);
    expect(e).toBeInstanceOf(DocTemplateError);
    expect(e.kind).toBe('loop');
  });
});

describe('renderDocx safety', () => {
  it('a placeholder of another kind prints empty', async () => {
    const blob = await renderDocx(await makeDocx(['HĐ {so_hop_dong}.']), billDocData(sampleBill({ status: 'sent' }), DEFAULT_SETTINGS), {});
    expect(await docxText(blob)).toContain('HĐ .');
  });
  it('refuses code in a template and never runs it', async () => {
    const t = await makeDocx(['{ben_b_ten + (globalThis.pwned = 1, "")}']);
    await expect(renderDocx(t, billDocData(sampleBill(), DEFAULT_SETTINGS), {})).rejects.toBeInstanceOf(DocTemplateError);
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
  });
});

describe('inspectTemplate', () => {
  it('lists used and unknown names', async () => {
    const r = await inspectTemplate(await makeDocx(['{so_phieu} {IMAGE qr()} {so_phieuu}'], rowTable));
    expect(r.used).toEqual(expect.arrayContaining(['so_phieu', 'dich_vu', 'qr']));
    expect(r.unknown).toEqual([{ name: 'so_phieuu', suggestion: 'so_phieu' }]);
    expect(r.errors).toEqual([]);
  });
  it('lists placeholders another kind of document fills', async () => {
    const r = await inspectTemplate(await makeDocx(['{so_phieu} {so_hop_dong} {qr}']), 'bill');
    expect([r.unknown, r.unavailable]).toEqual([[], ['so_hop_dong']]);
    expect((await inspectTemplate(await makeDocx(['{so_phieu} {IMAGE qr()}']), 'contract')).unavailable).toEqual(['so_phieu', 'qr']);
  });
  it('accepts only simple commands', async () => {
    const ok = await inspectTemplate(await makeDocx(['{so_phieu} {IMAGE logo()} {IF !co_vat}x{END-IF} {IF $d.ten}y{END-IF}']));
    expect(ok.errors).toEqual([]);
    for (const code of ['ben_b_ten + (globalThis.pwned = 1, "")', 'EXEC globalThis.pwned = 1', 'IMAGE fetch()', 'so_phieu.constructor']) {
      const r = await inspectTemplate(await makeDocx([`{${code}}`]));
      expect(r.errors[0]).toMatch(/^Only simple placeholders are allowed/);
    }
  });
  it('reports an unterminated loop', async () => {
    const r = await inspectTemplate(await makeDocx(['{FOR d IN dich_vu}{$d.ten}']));
    expect(r.errors).toEqual(['FOR d IN dich_vu has no matching END-FOR']);
  });
});

describe('file names and Drive paths', () => {
  it('names', () => {
    expect(contractDocxName(sampleContract())).toBe('HĐ 12-2026-HĐDV-SM – Công ty CP Hoa Sen Xanh.docx');
    expect(contractDocxName(sampleAddendum(), sampleContract())).toBe('PL01 – HĐ 12-2026-HĐDV-SM.docx');
    expect(billDocxName(sampleBill({ status: 'draft' }))).toBe('TT-2026-0012_Công ty CP Hoa Sen Xanh_DRAFT.docx');
    expect(billDocxName(sampleBill({ status: 'sent' }))).toBe('TT-2026-0012_Công ty CP Hoa Sen Xanh.docx');
  });
  it('drive paths', () => {
    expect(contractDrivePath(sampleAddendum({ signedDate: '2027-01-05' }), sampleContract(), 'Phiếu thanh toán')).toEqual({
      folders: ['Phiếu thanh toán', 'Hợp đồng', '2026', 'Công ty CP Hoa Sen Xanh'], fileName: 'PL01 – HĐ 12-2026-HĐDV-SM.docx',
    });
  });
});
