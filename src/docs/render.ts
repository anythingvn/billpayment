import type { DocData } from './placeholders';
import { DELIMITERS, GRAMMAR_ERROR, inspectTemplate } from './inspect';
import { PLACEHOLDERS } from './catalog';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocTemplateErrorKind = 'unknown' | 'syntax' | 'loop' | 'if' | 'image' | 'other';

export class DocTemplateError extends Error {
  constructor(public kind: DocTemplateErrorKind, message: string, public command?: string) {
    super(message);
    this.name = 'DocTemplateError';
  }
}

export interface DocImages {
  qr?: Uint8Array | null;
  logo?: { bytes: Uint8Array; extension: '.png' | '.jpg' } | null;
}

/** Pixel size from a PNG (IHDR) or JPEG (SOF) header, for keeping the aspect ratio. */
export function imageSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff || bytes[i + 1] === 0xff) { i++; continue; } // not a marker yet, or a fill byte
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      // Start-of-frame markers are C0–CF except C4 (DHT), C8 (JPG) and CC (DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

/** Every placeholder, empty: one that this kind of document doesn't fill prints empty instead of failing. */
const EMPTY_DATA: DocData = Object.fromEntries(PLACEHOLDERS
  .filter((p) => !p.key.includes('.') && p.group !== 'images')
  .map((p) => [p.key, p.group === 'tables' ? [] : p.group === 'flags' ? false : '']));

/** Fills a .docx template ({placeholders}) with the data; unknown placeholders and template errors throw DocTemplateError. */
export async function renderDocx(template: ArrayBuffer, data: DocData, images: DocImages): Promise<Blob> {
  const report = await inspectTemplate(template);
  const unknown = report.unknown[0];
  if (unknown) {
    throw new DocTemplateError('unknown', `Unknown placeholder: ${unknown.name}${unknown.suggestion ? ` (did you mean ${unknown.suggestion}?)` : ''}`, unknown.name);
  }
  const refused = report.errors.find((e) => e.startsWith(GRAMMAR_ERROR));
  if (refused) throw new DocTemplateError('syntax', refused);
  const lib = await import('docx-templates/lib/browser.js');
  const qr = () => (images.qr ? { width: 3, height: 3, data: images.qr, extension: '.png' } : null);
  const logo = () => {
    if (!images.logo) return null;
    const size = imageSize(images.logo.bytes);
    const width = 4;
    const height = size && size.w > 0 ? Math.round((width * size.h / size.w) * 100) / 100 : 2;
    return { width, height, data: images.logo.bytes, extension: images.logo.extension };
  };
  try {
    const out = await lib.createReport({
      template: new Uint8Array(template),
      data: { ...EMPTY_DATA, ...data },
      cmdDelimiter: DELIMITERS,
      additionalJsContext: { qr, logo },
      rejectNullish: false,
      failFast: true,
      // Multi-line values (chi_tiet) become real Word line breaks: <w:t>a</w:t><w:br/><w:t>b</w:t>.
      processLineBreaksAsNewText: true,
      // Browsers have no Node `vm`. Safe because inspectTemplate only lets through plain placeholders (no code).
      noSandbox: true,
    });
    return new Blob([out as BlobPart], { type: DOCX_MIME });
  } catch (e) {
    const errs = Array.isArray(e) ? e : [e];
    const first = errs[0] as Error;
    const msg = first instanceof Error ? first.message : String(first);
    // The library's error classes don't always survive bundling, so recognise them by message too.
    if (first instanceof lib.UnterminatedForLoopError || /Unterminated FOR-loop/i.test(msg)) {
      throw new DocTemplateError('loop', `The template has a FOR without END-FOR: ${msg}`);
    }
    if (first instanceof lib.IncompleteConditionalStatementError || /IF statement|END-IF/i.test(msg)) {
      throw new DocTemplateError('if', `The template has an IF without END-IF: ${msg}`);
    }
    if (first instanceof lib.ImageError) throw new DocTemplateError('image', `An image could not be added: ${msg}`);
    if (first instanceof lib.CommandSyntaxError || first instanceof lib.InvalidCommandError || first instanceof lib.TemplateParseError
      || first instanceof lib.CommandExecutionError) {
      throw new DocTemplateError('syntax', `The template has an error near: ${msg}`);
    }
    throw new DocTemplateError('other', `The Word document could not be created: ${msg}`);
  }
}
