import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { safeName } from '../../src/drive/paths';
import type { ServerDrive } from './drive';
import type { SqliteStore } from './sqliteStore';

/** Meta key: the last copy to Drive and the files kept there (kept by a restore, see KEEP_META). */
export const BACKUP_DRIVE = 'backup-drive';
const KEEP_DAYS = 14;
export const BACKUP_FOLDER = 'Sao lưu';
/** The database holds password hashes and the encrypted Google key: its own folder, never to be shared. */
export const SERVER_FOLDER = 'Máy chủ – không chia sẻ';

export interface DriveBackupDay { date: string; json: string; db: string }
export interface DriveBackupState { at: string | null; error: string | null; days: DriveBackupDay[] }

export const driveBackupState = (store: SqliteStore): DriveBackupState =>
  store.getMetaSync<DriveBackupState>(BACKUP_DRIVE) ?? { at: null, error: null, days: [] };

/**
 * Copies tonight's backup to the company Drive: the app's backup file (no secrets) to <main>/Sao lưu and the database
 * file to <main>/Sao lưu/Máy chủ – không chia sẻ. The same day's files are replaced; the newest 14 days are kept and
 * older ones moved to the Drive trash. Errors are recorded (shown to the Admin), never thrown.
 */
export async function backupToDrive(store: SqliteStore, drive: ServerDrive, dbFile: string, backup: object, now: Date): Promise<DriveBackupState> {
  const prev = driveBackupState(store);
  const save = (s: DriveBackupState) => { store.setMetaSync(BACKUP_DRIVE, s); return s; };
  if (!drive.status().connected) return save({ ...prev, at: now.toISOString(), error: "Google Drive isn't connected" });
  const date = basename(dbFile).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? now.toISOString().slice(0, 10);
  const main = safeName((await store.getSettings()).driveFolderName);
  const today = prev.days.find((d) => d.date === date);
  try {
    const json = await drive.putFile({
      folders: [main, BACKUP_FOLDER], fileName: `billpayment-${date}.json`, mimeType: 'application/json',
      data: Buffer.from(JSON.stringify(backup)), existingFileId: today?.json ?? null,
    });
    const db = await drive.putFile({
      folders: [main, BACKUP_FOLDER, SERVER_FOLDER], fileName: `billpayment-${date}.db`, mimeType: 'application/x-sqlite3',
      data: readFileSync(dbFile), existingFileId: today?.db ?? null,
    });
    const days = [...prev.days.filter((d) => d.date !== date), { date, json, db }].sort((a, b) => a.date.localeCompare(b.date));
    const kept = days.slice(-KEEP_DAYS);
    // Old copies to the trash; one that can't be moved stays listed and is tried again next time.
    for (const d of days.slice(0, -KEEP_DAYS)) {
      try {
        await drive.trash(d.json);
        await drive.trash(d.db);
      } catch {
        kept.unshift(d);
      }
    }
    return save({ at: now.toISOString(), error: null, days: kept });
  } catch (e) {
    return save({ ...prev, at: now.toISOString(), error: e instanceof Error ? e.message : String(e) });
  }
}
