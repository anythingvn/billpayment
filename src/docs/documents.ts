import type { Bill, Contract, Settings } from '../domain/types';
import type { AppDb } from '../storage/db';
import { getBill, getContract, templateFor } from '../storage/db';
import { businessSnapshot } from '../domain/settings';
import { draftFromBill } from '../domain/draft';
import { billQrPayload } from '../ui/BillPage';
import { qrToDataUrl } from '../ui/useQrDataUrl';
import { addendumDocData, billDocData, contractDocData, statementDocData } from './placeholders';
import type { Statement } from '../domain/statement';
import { statementFileBase } from '../domain/statement';
import { statementQrPayload } from '../ui/StatementPage';
import { safeName } from '../drive/paths';
import { renderDocx, type DocImages } from './render';
import { billDocxName, contractDrivePath } from './fileNames';
import { billDrivePath } from '../drive/paths';

export type DocxTarget = { type: 'bill'; id: string } | { type: 'contract'; id: string };

export interface BuiltDoc {
  blob: Blob;
  fileName: string;
  /** Drive folder path for this document. */
  folders: string[];
}

const dataUrlBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));

/** The logo image for a document, from a data URL (PNG or JPEG). */
export function logoImage(dataUrl: string | null | undefined): DocImages['logo'] {
  if (!dataUrl) return null;
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? '';
  if (mime !== 'image/png' && mime !== 'image/jpeg') return null;
  return { bytes: dataUrlBytes(dataUrl), extension: mime === 'image/png' ? '.png' : '.jpg' };
}

/** The bill's Word document, or null when there is no bill template. Drafts get no QR code. */
export async function buildBillDocx(db: AppDb, bill: Bill, s: Settings): Promise<BuiltDoc | null> {
  const template = await templateFor(db, 'bill');
  if (!template) return null;
  const payload = bill.status === 'draft' ? null : billQrPayload(draftFromBill(bill), s);
  const qr = payload ? dataUrlBytes(await qrToDataUrl(payload)) : null;
  const logo = logoImage((bill.business ?? businessSnapshot(s)).logoDataUrl);
  const blob = await renderDocx(template.data, billDocData(bill, s), { qr, logo });
  return { blob, fileName: billDocxName(bill), folders: billDrivePath(bill, s.driveFolderName).folders };
}

/** A contract's or addendum's Word document, or null when there is no template of that kind. */
export async function buildContractDocx(db: AppDb, c: Contract, s: Settings): Promise<BuiltDoc | null> {
  const parent = c.parentId ? (await getContract(db, c.parentId)) ?? null : null;
  const template = c.kind === 'addendum' ? await templateFor(db, 'addendum') : await templateFor(db, 'contract', c.templateId);
  if (!template) return null;
  const data = c.kind === 'addendum' && parent ? addendumDocData(c, parent, s) : contractDocData(c, s);
  const logo = logoImage((c.business ?? parent?.business ?? businessSnapshot(s)).logoDataUrl);
  const blob = await renderDocx(template.data, data, { logo });
  const { folders, fileName } = contractDrivePath(c, parent, s.driveFolderName);
  return { blob, fileName, folders };
}

/** Builds the document for a stored bill or contract; null when the record or template is missing. */
export async function buildDocx(db: AppDb, target: DocxTarget, s: Settings): Promise<BuiltDoc | null> {
  if (target.type === 'bill') {
    const bill = await getBill(db, target.id);
    return bill ? buildBillDocx(db, bill, s) : null;
  }
  const c = await getContract(db, target.id);
  return c ? buildContractDocx(db, c, s) : null;
}

/** A customer statement's Word document, or null when there is no Statement template. QR only when something is owed. */
export async function buildStatementDocx(db: AppDb, st: Statement, s: Settings): Promise<BuiltDoc | null> {
  const template = await templateFor(db, 'statement');
  if (!template) return null;
  const payload = statementQrPayload(st, s);
  const qr = payload ? dataUrlBytes(await qrToDataUrl(payload)) : null;
  const blob = await renderDocx(template.data, statementDocData(st, s), { qr, logo: logoImage(s.logoDataUrl) });
  return {
    blob,
    fileName: `${statementFileBase(st.customer.name, st.from, st.to)}.docx`,
    folders: [safeName(s.driveFolderName), 'Đối chiếu', st.to.slice(0, 4), safeName(st.customer.name)],
  };
}
