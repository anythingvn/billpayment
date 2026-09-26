import type { FastifyInstance } from 'fastify';
import { ROLES, passwordErrors, type Role } from '../auth';
import { listActivity, logActivity } from '../activity';
import type { Ctx } from '../context';
import { SMALL, invalid, requireAdmin, userFieldErrors } from './auth';

const LAST_ADMIN = 'There must be at least one active Admin';

export function userRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { accounts, store } = ctx;
  const admin = { ...SMALL, preHandler: requireAdmin(ctx) };

  app.get('/api/users', admin, async () => ({ users: accounts.list() }));

  app.post('/api/users', admin, async (req, reply) => {
    const b = (req.body ?? {}) as { username?: string; displayName?: string; role?: string; password?: string };
    const problems = [...userFieldErrors(b.username, b.displayName), ...passwordErrors(b.password)];
    if (!ROLES.includes(b.role as Role)) problems.push('Choose a role');
    if (typeof b.username === 'string' && accounts.byUsername(b.username)) problems.push('That username is taken');
    if (problems.length) return invalid(reply, problems);
    const user = await accounts.create({ username: b.username!, displayName: b.displayName!, role: b.role as Role, password: b.password!, mustChange: true }, ctx.now());
    logActivity(store, req.user!.id, 'user-created', { username: user.username, role: user.role }, ctx.now());
    return { user };
  });

  app.patch('/api/users/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = accounts.get(id);
    if (!target) return reply.code(404).send({ error: 'not-found' });
    const b = (req.body ?? {}) as { displayName?: string; role?: string; disabled?: boolean };
    if (b.role !== undefined && !ROLES.includes(b.role as Role)) return invalid(reply, ['Choose a role']);
    if (b.displayName !== undefined && !String(b.displayName).trim()) return invalid(reply, ['Enter a display name']);
    const losesAdmin = target.role === 'admin' && !target.disabled && ((b.role !== undefined && b.role !== 'admin') || b.disabled === true);
    if (losesAdmin && accounts.activeAdmins(id) === 0) return invalid(reply, [LAST_ADMIN]);
    const user = accounts.update(id, { displayName: b.displayName, role: b.role as Role | undefined, disabled: b.disabled });
    logActivity(store, req.user!.id, b.disabled === true ? 'user-disabled' : 'user-changed', { username: user.username, change: b }, ctx.now());
    return { user };
  });

  app.post('/api/users/:id/password', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = accounts.get(id);
    if (!target) return reply.code(404).send({ error: 'not-found' });
    const b = (req.body ?? {}) as { password?: string };
    const problems = passwordErrors(b.password);
    if (problems.length) return invalid(reply, problems);
    await accounts.setPassword(id, b.password!, true);
    accounts.endSessions(id);
    logActivity(store, req.user!.id, 'password-reset', { username: target.username }, ctx.now());
    return { user: accounts.get(id) };
  });

  app.get('/api/activity', admin, async (req) => ({ items: listActivity(store, (req.query as { before?: string }).before) }));
}
