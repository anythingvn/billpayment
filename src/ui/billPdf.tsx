import { render } from 'preact';
import type { Bill, Settings } from '../domain/types';
import { draftFromBill } from '../domain/draft';
import { BillPage, billQrPayload } from './BillPage';
import { qrToDataUrl } from './useQrDataUrl';
import { pageCuts } from './pdfPaging';

const MARGIN_TOP_MM = 14;
const PRINTABLE_HEIGHT_MM = 297 - 2 * MARGIN_TOP_MM;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Builds an A4 PDF of the bill as it looks on screen: renders the bill off-screen, snapshots it at 2x
 * and slices the snapshot into pages without cutting through service rows or the totals/QR/signature block.
 */
export async function makeBillPdf(bill: Bill, settings: Settings): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const draft = draftFromBill(bill);
  const payload = billQrPayload(draft, settings);
  const qr = payload ? await qrToDataUrl(payload) : null;

  const container = document.createElement('div');
  container.className = 'pdf-render';
  document.body.appendChild(container);
  try {
    render(<BillPage bill={draft} settings={settings} qrDataUrl={qr} />, container);
    await nextFrame();
    await nextFrame();

    const scale = 2;
    const pxPerMm = container.offsetWidth / 210;
    const contentTop = container.getBoundingClientRect().top + MARGIN_TOP_MM * pxPerMm;
    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - contentTop, bottom: r.bottom - contentTop };
    };
    const rows = [...container.querySelectorAll('.bill-table:not(.bill-sum) > tbody > tr')];
    const end = container.querySelector('.bill-end');
    const blocks = [
      // Header, title, customer, table head and the first row stay together on page 1.
      { top: 0, bottom: rows[0] ? rel(rows[0]).bottom : 0 },
      ...rows.slice(1).map(rel),
      ...(end ? [rel(end)] : []),
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
