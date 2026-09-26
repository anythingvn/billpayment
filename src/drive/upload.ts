import type { Bill, DriveStatus } from '../domain/types';
import type { DriveApi } from './api';
import { ensureFolderPath } from './folders';
import { billDrivePath } from './paths';

/** Creates the bill's PDF in Drive, or replaces (and if needed moves) the file it was saved to before. */
export async function uploadBillPdf(
  api: DriveApi,
  bill: Bill,
  pdf: Blob,
  mainFolder: string,
  cache: Record<string, string>,
  nowIso: string,
): Promise<{ status: DriveStatus; cache: Record<string, string> }> {
  const { folders, fileName } = billDrivePath(bill, mainFolder);
  const { folderId, cache: nextCache } = await ensureFolderPath(api, folders, cache);
  const existing = bill.drive?.fileId ? await api.getFile(bill.drive.fileId) : null;
  const file = existing
    ? await api.updateFile(existing.id, fileName, pdf,
      existing.parents?.[0] && existing.parents[0] !== folderId ? { from: existing.parents[0], to: folderId } : undefined)
    : await api.createFile(fileName, folderId, pdf);
  return {
    status: { fileId: file.id, link: file.webViewLink ?? null, savedAt: nowIso, error: null },
    cache: nextCache,
  };
}
