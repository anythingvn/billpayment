import type { DocKind } from '../domain/types';
import contractUrl from './starters/contract.docx?url';
import addendumUrl from './starters/addendum.docx?url';
import billUrl from './starters/bill.docx?url';
import statementUrl from './starters/statement.docx?url';

const URLS: Record<DocKind, string> = { contract: contractUrl, addendum: addendumUrl, bill: billUrl, statement: statementUrl };

/** The bundled starter template of a kind (cached by the service worker, so it works offline). */
export async function loadStarter(kind: DocKind): Promise<ArrayBuffer> {
  const res = await fetch(URLS[kind]);
  if (!res.ok) throw new Error('The starter template could not be loaded');
  return res.arrayBuffer();
}
