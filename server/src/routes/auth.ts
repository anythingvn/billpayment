import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Accounts, BAD_SIGNIN, SESSION_MAX_AGE, passwordErrors, type PublicUser } from '../auth';
import { logActivity } from '../activity';
import type { Ctx } from '../context';

declare module 'fastify' {
  interface FastifyRequest { user?: PublicUser }
}

export const invalid = (reply: FastifyReply, messages: string[]) => reply.code(422).send({ error: 'invalid', messages });

/** preHandler: needs a signed-in user. */
export const requireUser = (ctx: Ctx) => async (req: FastifyRequest, reply: FastifyReply) => {
  const user = ctx.accounts.sessionUser(req.cookies.sid, ctx.now());
  if (!user) return reply.code(401).send({ error: 'signin' });
  req.user = user;
};
/** preHandler: needs a signed-in Admin. */
export const requireAdmin = (ctx: Ctx) => async (req: FastifyRequest, reply: FastifyReply) => {
  await requireUser(ctx)(req, reply);
  if (reply.sent) return;
  if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
};

export function setSessionCookie(ctx: Ctx, reply: FastifyReply, sid: string): void {
  reply.setCookie('sid', sid, { httpOnly: true, sameSite: 'strict', path: '/', secure: ctx.env.secureCookies, maxAge: SESSION_MAX_AGE });
}

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { accounts, store } = ctx;
  app.get('/api/setup', async () => ({ needed: accounts.count() === 0 }));

  app.post('/api/setup', async (req, reply) => {
    if (accounts.count() > 0) return reply.code(409).send({ error: 'conflict', message: 'The server is already set up' });
    const b = (req.body ?? {}) as { username?: string; displayName?: string; password?: string };
    const problems = [...userFieldErrors(b.username, b.displayName), ...passwordErrors(b.password)];
    if (problems.length) return invalid(reply, problems);
    const user = await accounts.create({ username: b.username!, displayName: b.displayName!, role: 'admin', password: b.password!, mustChange: false }, ctx.now());
    logActivity(store, user.id, 'setup', { username: user.username }, ctx.now());
    setSessionCookie(ctx, reply, accounts.startSession(user.id, ctx.now()));
    return { user };
  });

  app.post('/api/signin', async (req, reply) => {
    const b = (req.body ?? {}) as { username?: string; password?: string };
    const username = String(b.username ?? '');
    const r = await accounts.signIn(username, String(b.password ?? ''), ctx.now());
    if ('failed' in r) {
      logActivity(store, null, 'signin-failed', { username }, ctx.now());
      if (r.lockedNow) logActivity(store, null, 'locked', { username }, ctx.now());
      return reply.code(401).send({ error: 'signin', message: BAD_SIGNIN });
    }
    logActivity(store, r.user.id, 'signin', {}, ctx.now());
    setSessionCookie(ctx, reply, accounts.startSession(r.user.id, ctx.now()));
    return { user: r.user };
  });

  app.post('/api/signout', async (req, reply) => {
    const user = accounts.sessionUser(req.cookies.sid, ctx.now());
    if (req.cookies.sid) accounts.endSession(req.cookies.sid);
    if (user) logActivity(store, user.id, 'signout', {}, ctx.now());
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser(ctx) }, async (req) => ({ user: req.user }));

  app.post('/api/me/password', { preHandler: requireUser(ctx) }, async (req, reply) => {
    const b = (req.body ?? {}) as { current?: string; next?: string };
    if (!(await accounts.checkPassword(req.user!.id, String(b.current ?? '')))) return invalid(reply, ['The current password is wrong']);
    const problems = passwordErrors(b.next);
    if (problems.length) return invalid(reply, problems);
    await accounts.setPassword(req.user!.id, b.next!, false);
    logActivity(store, req.user!.id, 'password-changed', {}, ctx.now());
    return { user: accounts.get(req.user!.id) };
  });
}

/** Username: 2–40 letters, digits, dot, dash or underscore; display name required. */
export function userFieldErrors(username: unknown, displayName: unknown): string[] {
  const out: string[] = [];
  if (typeof username !== 'string' || !/^[A-Za-z0-9._-]{2,40}$/.test(username.trim())) out.push('The username must be 2–40 letters, digits, dots, dashes or underscores');
  if (typeof displayName !== 'string' || !displayName.trim()) out.push('Enter a display name');
  return out;
}
export type { Accounts };
