import type { Bill, Settings } from '../domain/types';

/** Builds the A4 PDF of a bill for Google Drive. Implemented in the next task. */
export async function makeBillPdf(_bill: Bill, _settings: Settings): Promise<Blob> {
  throw new Error('PDF generation is not built yet');
}
