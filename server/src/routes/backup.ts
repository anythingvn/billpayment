import type { FastifyInstance } from 'fastify';
import { backupFileName, parseBackup } from '../../../src/storage/backup';
import { logActivity } from '../activity';
import type { Ctx } from '../context';
import type { ServerDrive } from '../drive';
import { backupToDrive, driveBackupState } from '../driveBackup';
import { runBackupNow } from '../nightly';
import { invalid, requireAdmin } from './auth';

/** Everything the app's backup has, plus users (no password hashes) and the activity log. Never secrets. */
export async function backupJson(ctx: Ctx): Promise<object> {
  const { store, accounts } = ctx;
  const data = await store.exportAll(ctx.now().toISOString());
  const users = accounts.list().map((u) => ({ username: u.username, displayName: u.displayName, role: u.role, disabled: u.disabled }));
  const activity = (store.db.prepare(`SELECT a.at, a.action, a.detail, u.display_name AS user FROM activity a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.at DESC, a.id DESC`).all() as { at: string; action: string; detail: string; user: string | null }[])
    .map((a) => ({ at: a.at, action: a.action, user: a.user, detail: JSON.parse(a.detail) }));
  return { ...data, users, activity };
}

/** The nightly copy to the company Drive, for the backup file just written to `dbFile`. */
export const driveBackupFor = (ctx: Ctx, drive: ServerDrive) => async (dbFile: string) =>
  backupToDrive(ctx.store, drive, dbFile, await backupJson(ctx), ctx.now());

export function backupRoutes(app: FastifyInstance, ctx: Ctx, drive: ServerDrive): void {
  const { store } = ctx;
  const admin = { preHandler: requireAdmin(ctx), bodyLimit: 20 * 1024 * 1024 };
  const actor = (u: { id: string; displayName: string }) => ({ id: u.id, displayName: u.displayName });

  /** One-time import of the single-user app's backup into a new server. */
  app.post('/api/import', admin, async (req, reply) => {
    if ((await store.listBills()).length > 0) return reply.code(409).send({ error: 'conflict', message: 'Import is only for a new server — use Restore' });
    const parsed = parseBackup(JSON.stringify(req.body ?? null));
    if (!parsed.ok) return invalid(reply, [parsed.error]);
    await store.restoreAll(parsed.data, { actor: actor(req.user!), now: ctx.now().toISOString() });
    logActivity(store, req.user!.id, 'import', { summary: parsed.summary }, ctx.now());
    return { summary: parsed.summary };
  });

  app.get('/api/backup', admin, async (req, reply) => {
    const now = ctx.now();
    const body = await backupJson(ctx);
    logActivity(store, req.user!.id, 'backup-download', {}, now);
    reply.header('Content-Disposition', `attachment; filename="${backupFileName(now.toISOString())}"`);
    return body;
  });

  /** The copies on the company Google Drive: last run and the days kept. */
  app.get('/api/backup/drive', admin, async () => driveBackupState(store));
  /** Backs up now: the local copy, then the copy to Google Drive (replacing today's files there). */
  app.post('/api/backup/drive', admin, async () => driveBackupFor(ctx, drive)(runBackupNow(store, ctx.env.dataDir, ctx.now())));

  /** Replaces all business data; users, sessions and the Drive connection stay. */
  app.post('/api/restore', admin, async (req, reply) => {
    const b = (req.body ?? {}) as { confirm?: string; data?: unknown };
    if (b.confirm !== 'RESTORE') return invalid(reply, ['Type RESTORE to confirm']);
    const parsed = parseBackup(JSON.stringify(b.data ?? null));
    if (!parsed.ok) return invalid(reply, [parsed.error]);
    await store.restoreAll(parsed.data, { actor: actor(req.user!), now: ctx.now().toISOString() });
    logActivity(store, req.user!.id, 'restore', { summary: parsed.summary }, ctx.now());
    return { summary: parsed.summary };
  });
}
