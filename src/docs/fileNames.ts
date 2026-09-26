import type { Bill, Contract } from '../domain/types';
import { pdfFileName } from '../domain/format';
import { safeName } from '../drive/paths';

const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
const numberPart = (n: string) => n.replace(/\//g, '-');

/** Contract: "HĐ 12-2026-HĐDV-SM – Customer.docx"; addendum: "PL01 – HĐ 12-2026-HĐDV-SM.docx". */
export function contractDocxName(c: Contract, parent?: Contract | null): string {
  if (c.kind === 'addendum' && parent) return `${clean(c.number)} – HĐ ${clean(numberPart(parent.number))}.docx`;
  const customer = clean(c.customer.name);
  // Capped like Drive folder names (safeName), keeping the extension.
  return `${`HĐ ${clean(numberPart(c.number))}${customer ? ` – ${customer}` : ''}`.slice(0, 100).trim()}.docx`;
}

export const billDocxName = (b: Bill): string => `${pdfFileName(b.number, b.customer.name, b.status === 'draft')}.docx`;

/** Drive folders for a contract or addendum document: main / Hợp đồng / year of signing / customer. */
export function contractDrivePath(c: Contract, parent: Contract | null, mainFolder: string): { folders: string[]; fileName: string } {
  const top = parent ?? c;
  return {
    folders: [safeName(mainFolder), 'Hợp đồng', top.signedDate.slice(0, 4), safeName(top.customer.name)],
    fileName: contractDocxName(c, parent),
  };
}
