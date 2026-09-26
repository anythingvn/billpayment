import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { SqliteStore } from './sqliteStore';

const KEEP = 14;
const FILE = /^billpayment-\d{4}-\d{2}-\d{2}\.db$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** Copies the database to DATA_DIR/backups/billpayment-YYYY-MM-DD.db (server's local date) and keeps the newest 14. */
export function runBackupNow(store: SqliteStore, dataDir: string, now: Date): string {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `billpayment-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.db`);
  if (existsSync(file)) unlinkSync(file);
  store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter((f) => FILE.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) unlinkSync(join(dir, f));
  return file;
}

/** Runs the backup every night at 02:00 server time. Failures are logged and retried the next night. */
export function startNightlyBackup(store: SqliteStore, dataDir: string, log: (msg: string) => void = console.error): void {
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => {
      try {
        runBackupNow(store, dataDir, new Date());
      } catch (e) {
        log(`Nightly backup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      schedule();
    }, next.getTime() - now.getTime()).unref();
  };
  schedule();
}
