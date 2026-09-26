import type { Bill, DriveStatus } from '../domain/types';
import type { DriveApi } from './api';
import { ensureFolderPath } from './folders';
import { billDrivePath } from './paths';

export interface UploadInput {
  folders: string[];
  fileName: string;
  mimeType: string;
  blob: Blob;
  /** The Drive file this document was saved to before, if any (replaced, and moved if its folder changed). */
  existingFileId: string | null;
}

/** Creates a file in the folder path, or replaces (and if needed moves) the file it was saved to before. */
export async function uploadFile(
  api: DriveApi,
  input: UploadInput,
  cache: Record<string, string>,
  nowIso: string,
): Promise<{ status: DriveStatus; cache: Record<string, string> }> {
  const { folderId, cache: nextCache } = await ensureFolderPath(api, input.folders, cache);
  const existing = input.existingFileId ? await api.getFile(input.existingFileId) : null;
  const file = existing
    ? await api.updateFile(existing.id, input.fileName, input.blob, input.mimeType,
      existing.parents?.[0] && existing.parents[0] !== folderId ? { from: existing.parents[0], to: folderId } : undefined)
    : await api.createFile(input.fileName, folderId, input.blob, input.mimeType);
  return {
    status: { fileId: file.id, link: file.webViewLink ?? null, savedAt: nowIso, error: null },
    cache: nextCache,
  };
}

/** The bill's PDF: main folder / year / customer / <bill number>.pdf. */
export function uploadBillPdf(
  api: DriveApi,
  bill: Bill,
  pdf: Blob,
  mainFolder: string,
  cache: Record<string, string>,
  nowIso: string,
): Promise<{ status: DriveStatus; cache: Record<string, string> }> {
  const { folders, fileName } = billDrivePath(bill, mainFolder);
  return uploadFile(api, { folders, fileName, mimeType: 'application/pdf', blob: pdf, existingFileId: bill.drive?.fileId ?? null }, cache, nowIso);
}
