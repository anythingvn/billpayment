import { render, type VNode } from 'preact';
import type { Bill, Settings } from '../domain/types';
import type { Statement } from '../domain/statement';
import { StatementPage, statementQrPayload } from './StatementPage';
import { draftFromBill } from '../domain/draft';
import { BillPage, billQrPayload } from './BillPage';
import { qrToDataUrl } from './useQrDataUrl';
import { pageCuts } from './pdfPaging';

const MARGIN_TOP_MM = 14;
const PRINTABLE_HEIGHT_MM = 297 - 2 * MARGIN_TOP_MM;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** A4 PDF of the bill as it looks on screen; service rows and the totals/QR/signature block are never cut. */
export async function makeBillPdf(bill: Bill, settings: Settings): Promise<Blob> {
  const draft = draftFromBill(bill);
  const payload = billQrPayload(draft, settings);
  const qr = payload ? await qrToDataUrl(payload) : null;
  return makePagePdf(<BillPage bill={draft} settings={settings} qrDataUrl={qr} />, '.bill-table:not(.bill-sum) > tbody > tr, .bill-end');
}

/** A4 PDF of a customer statement; the header, headings, every table row and the two end blocks are never cut. */
export async function makeStatementPdf(st: Statement, settings: Settings): Promise<Blob> {
  const payload = statementQrPayload(st, settings);
  const qr = payload ? await qrToDataUrl(payload) : null;
  return makePagePdf(<StatementPage statement={st} settings={settings} qrDataUrl={qr} />, '.stmt-top, .stmt-h, .stmt tr, .stmt-keep');
}

/**
 * Builds an A4 PDF of a page component as it looks on screen: renders it off-screen, snapshots it at 2x and slices
 * the snapshot into pages without cutting through the elements matching `keepSelector`. Everything above the first
 * of them (and it) stays together on page 1.
 */
export async function makePagePdf(page: VNode, keepSelector: string): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const container = document.createElement('div');
  container.className = 'pdf-render';
  document.body.appendChild(container);
  try {
    render(page, container);
    await nextFrame();
    await nextFrame();

    const scale = 2;
    const pxPerMm = container.offsetWidth / 210;
    const contentTop = container.getBoundingClientRect().top + MARGIN_TOP_MM * pxPerMm;
    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - contentTop, bottom: r.bottom - contentTop };
    };
    const keep = [...container.querySelectorAll(keepSelector)];
    const blocks = [
      // Everything down to the first kept element (e.g. header, title, customer, table head, first row) stays on page 1.
      { top: 0, bottom: keep[0] ? rel(keep[0]).bottom : 0 },
      ...keep.slice(1).map(rel),
    ];
    const contentHeight = container.offsetHeight - 2 * MARGIN_TOP_MM * pxPerMm;

    const canvas = await html2canvas(container, { scale, backgroundColor: '#ffffff', logging: false });
    const mmPx = scale * pxPerMm;
    const cuts = pageCuts(
      blocks.map((b) => ({ top: b.top * scale, bottom: b.bottom * scale })),
      contentHeight * scale,
      PRINTABLE_HEIGHT_MM * mmPx,
    );

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    cuts.forEach((cut, i) => {
      const endPx = i + 1 < cuts.length ? cuts[i + 1] : contentHeight * scale;
      const h = Math.max(1, Math.round(endPx - cut));
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      const ctx = slice.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, h);
      ctx.drawImage(canvas, 0, Math.round(MARGIN_TOP_MM * mmPx + cut), canvas.width, h, 0, 0, canvas.width, h);
      if (i > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, MARGIN_TOP_MM, 210, h / mmPx);
    });
    return pdf.output('blob');
  } finally {
    render(null, container);
    container.remove();
  }
}
