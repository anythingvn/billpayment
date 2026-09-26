import { readFileSync } from 'node:fs';
import { inspectTemplate } from '../../src/docs/inspect';
import { renderDocx } from '../../src/docs/render';
import { addendumDocData, billDocData, contractDocData } from '../../src/docs/placeholders';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';
import { docxText, docxXml, PNG_1PX } from './makeDocx';

const load = (kind: string) => { const b = readFileSync(`src/docs/starters/${kind}.docx`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const ref = { contractId: 'k1', itemKey: null, number: '12/2026/HĐDV-SM', signedDate: '2026-09-15', parentNumber: null, parentSignedDate: null };

describe('starter templates', () => {
  it.each(['contract', 'addendum', 'bill'])('%s uses only known placeholders', async (kind) => {
    const r = await inspectTemplate(load(kind));
    expect(r.unknown).toEqual([]);
    expect(r.errors).toEqual([]);
  });
  it('contract starter fills in', async () => {
    const text = await docxText(await renderDocx(load('contract'), contractDocData(sampleContract(), DEFAULT_SETTINGS), {}));
    expect(text).toContain('12/2026/HĐDV-SM');
    expect(text).toContain('Đợt 1 – Tạm ứng');
    expect(text).toContain('Hai mươi mốt triệu sáu trăm nghìn đồng.');
  });
  it('addendum starter fills in', async () => {
    const text = await docxText(await renderDocx(load('addendum'), addendumDocData(sampleAddendum(), sampleContract(), DEFAULT_SETTINGS), {}));
    expect(text).toContain('PL01');
    expect(text).toContain('12/2026/HĐDV-SM');
  });
  it('bill starter fills in, with the reference line and draft label only when relevant', async () => {
    const linked = await docxText(await renderDocx(load('bill'), billDocData(sampleBill({ status: 'sent', contractRef: ref }), DEFAULT_SETTINGS), { qr: PNG_1PX }));
    expect(linked).toContain('TT-2026-0012');
    expect(linked).toContain('Căn cứ Hợp đồng số 12/2026/HĐDV-SM');
    expect(linked).not.toContain('BẢN NHÁP');
    const xml = await docxXml(await renderDocx(load('bill'), billDocData(sampleBill({ lines: [sampleBill().lines[0], sampleBill().lines[0]] }), DEFAULT_SETTINGS), {}));
    // services table: header row + 2 service rows (no marker rows, no side-by-side cells)
    const services = xml.split('<w:tbl>').find((t) => t.includes('Thiết kế logo'))!;
    expect(services.match(/<w:tr[ >]/g)).toHaveLength(3);
    const draft = await docxText(await renderDocx(load('bill'), billDocData(sampleBill({ status: 'draft' }), DEFAULT_SETTINGS), {}));
    expect(draft).toContain('BẢN NHÁP');
    expect(draft).not.toContain('Căn cứ Hợp đồng');
  });
});
