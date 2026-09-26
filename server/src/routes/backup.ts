import type { FastifyInstance } from 'fastify';
import { backupFileName, parseBackup } from '../../../src/storage/backup';
import { logActivity } from '../activity';
import type { Ctx } from '../context';
import { invalid, requireAdmin } from './auth';

export function backupRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { store, accounts } = ctx;
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

  /** Everything the app's backup has, plus users (no password hashes) and the activity log. Never secrets. */
  app.get('/api/backup', admin, async (req, reply) => {
    const now = ctx.now();
    const data = await store.exportAll(now.toISOString());
    const users = accounts.list().map((u) => ({ username: u.username, displayName: u.displayName, role: u.role, disabled: u.disabled }));
    const activity = (store.db.prepare(`SELECT a.at, a.action, a.detail, u.display_name AS user FROM activity a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.at DESC, a.id DESC`).all() as { at: string; action: string; detail: string; user: string | null }[])
      .map((a) => ({ at: a.at, action: a.action, user: a.user, detail: JSON.parse(a.detail) }));
    logActivity(store, req.user!.id, 'backup-download', {}, now);
    reply.header('Content-Disposition', `attachment; filename="${backupFileName(now.toISOString())}"`);
    return { ...data, users, activity };
  });

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
