import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import JSZip from 'jszip';

/**
 * Builds a small .docx template. A string paragraph is one run; a string[] paragraph is several runs
 * (like Word splitting a placeholder after an edit). `table` rows become one table.
 */
export async function makeDocx(paragraphs: (string | string[])[], table?: string[][]): Promise<ArrayBuffer> {
  const children: (Paragraph | Table)[] = paragraphs.map((p) => new Paragraph({
    children: (Array.isArray(p) ? p : [p]).map((t, i) => new TextRun({ text: t, bold: Array.isArray(p) && i % 2 === 1 })),
  }));
  if (table) {
    children.push(new Table({
      rows: table.map((cells) => new TableRow({ children: cells.map((c) => new TableCell({ children: [new Paragraph(c)] })) })),
    }));
  }
  const blob = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return new Uint8Array(blob).buffer as ArrayBuffer;
}

async function unzip(doc: Blob | ArrayBuffer) {
  return JSZip.loadAsync(doc instanceof Blob ? await doc.arrayBuffer() : doc);
}

/** Text of word/document.xml: only <w:t> text, with <w:br/> and paragraph ends as new lines. */
export async function docxText(doc: Blob | ArrayBuffer): Promise<string> {
  const xml = await (await unzip(doc)).file('word/document.xml')!.async('string');
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<\/w:p>/g)) out += m[1] !== undefined ? m[1] : '\n';
  return out.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export async function docxXml(doc: Blob | ArrayBuffer): Promise<string> {
  return (await unzip(doc)).file('word/document.xml')!.async('string');
}

export async function docxMedia(doc: Blob | ArrayBuffer): Promise<string[]> {
  return Object.keys((await unzip(doc)).files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/'));
}

/** 1×1 images for embedding tests. */
export const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
export const JPEG_1PX = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
), (c) => c.charCodeAt(0));
