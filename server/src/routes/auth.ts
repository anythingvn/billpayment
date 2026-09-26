import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { Accounts, BAD_SIGNIN, SESSION_MAX_AGE, USERNAME, passwordErrors, type PublicUser } from '../auth';
import { logActivity } from '../activity';
import type { Ctx } from '../context';

declare module 'fastify' {
  interface FastifyRequest { user?: PublicUser }
}

export const invalid = (reply: FastifyReply, messages: string[]) => reply.code(422).send({ error: 'invalid', messages });

/**
 * preHandler: needs a signed-in user. A user with a temporary password (set by the Admin) may only read /api/me and
 * change the password until they do.
 */
export const requireUser = (ctx: Ctx, opts: { beforePasswordChange?: boolean } = {}) => async (req: FastifyRequest, reply: FastifyReply) => {
  const user = ctx.accounts.sessionUser(req.cookies.sid, ctx.now());
  if (!user) return reply.code(401).send({ error: 'signin' });
  if (user.mustChangePassword && !opts.beforePasswordChange) return reply.code(403).send({ error: 'password-change' });
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

/** Small bodies only on sign-in and account routes (a huge username must not reach the database). */
export const SMALL = { bodyLimit: 64 * 1024 };

export function authRoutes(app: FastifyInstance, ctx: Ctx, setupCode: string): void {
  const { accounts, store } = ctx;
  const codeOk = (given: unknown) => {
    const a = Buffer.from(String(given ?? '').trim().toUpperCase());
    const b = Buffer.from(setupCode.toUpperCase());
    return a.length === b.length && timingSafeEqual(a, b);
  };
  app.get('/api/setup', async () => ({ needed: accounts.count() === 0 }));

  app.post('/api/setup', SMALL, async (req, reply) => {
    if (accounts.count() > 0) return reply.code(409).send({ error: 'conflict', message: 'The server is already set up' });
    const b = (req.body ?? {}) as { username?: string; displayName?: string; password?: string; setupCode?: string };
    // Only whoever can read the server's log (where the code is printed) can create the first Admin.
    if (!codeOk(b.setupCode)) return reply.code(403).send({ error: 'forbidden', message: 'Wrong setup code — it is printed in the server log' });
    const problems = [...userFieldErrors(b.username, b.displayName), ...passwordErrors(b.password)];
    if (problems.length) return invalid(reply, problems);
    const user = await accounts.createFirstAdmin({ username: b.username!, displayName: b.displayName!, password: b.password! }, ctx.now());
    if (!user) return reply.code(409).send({ error: 'conflict', message: 'The server is already set up' });
    logActivity(store, user.id, 'setup', { username: user.username }, ctx.now());
    setSessionCookie(ctx, reply, accounts.startSession(user.id, ctx.now()));
    return { user };
  });

  app.post('/api/signin', SMALL, async (req, reply) => {
    const b = (req.body ?? {}) as { username?: string; password?: string };
    const username = String(b.username ?? '');
    const r = await accounts.signIn(username, String(b.password ?? ''), ctx.now());
    if ('failed' in r) {
      // Only real usernames are logged — never whatever was typed (it might be a password).
      const shown = r.known ? username.trim() : '(unknown)';
      logActivity(store, null, 'signin-failed', { username: shown }, ctx.now());
      if (r.lockedNow) logActivity(store, null, 'locked', { username: shown }, ctx.now());
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

  app.get('/api/me', { preHandler: requireUser(ctx, { beforePasswordChange: true }) }, async (req) => ({ user: req.user }));

  app.post('/api/me/password', { ...SMALL, preHandler: requireUser(ctx, { beforePasswordChange: true }) }, async (req, reply) => {
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
  if (typeof username !== 'string' || !USERNAME.test(username.trim())) out.push('The username must be 2–40 letters, digits, dots, dashes or underscores');
  if (typeof displayName !== 'string' || !displayName.trim()) out.push('Enter a display name');
  return out;
}
export type { Accounts };
