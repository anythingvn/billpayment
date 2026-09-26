import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { Env } from './env';
import fastifyCookie from '@fastify/cookie';
import type { SqliteStore } from './sqliteStore';
import { Accounts } from './auth';
import { addSecurity } from './security';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { recordRoutes } from './routes/records';
import { backupRoutes } from './routes/backup';
import { driveRoutes } from './routes/drive';
import { ServerDrive, googleOAuth, type GoogleOAuth } from './drive';
import type { DriveApi } from '../../src/drive/api';
import type { Ctx } from './context';

export interface AppOptions {
  store: SqliteStore;
  env: Env;
  /** The built app (default: ./dist). Not served when missing. */
  distDir?: string;
  /** Clock, for tests. */
  now?: () => Date;
  logger?: boolean;
  /** Google's OAuth endpoints and the Drive API (fakes in tests). */
  googleOAuth?: GoogleOAuth;
  driveApi?: (getToken: () => Promise<string>) => DriveApi;
}

/** The server: the built app at / and the JSON API under /api. */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  const ctx: Ctx = { store: opts.store, accounts: new Accounts(opts.store), env: opts.env, now: opts.now ?? (() => new Date()) };
  await app.register(fastifyCookie);
  addSecurity(app, opts.env);
  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(app, ctx);
  userRoutes(app, ctx);
  recordRoutes(app, ctx);
  backupRoutes(app, ctx);
  const oauth = opts.googleOAuth ?? googleOAuth(opts.env);
  driveRoutes(app, ctx, new ServerDrive(opts.store, opts.env, oauth, opts.driveApi, ctx.now), oauth);

  const dist = opts.distDir ?? 'dist';
  if (existsSync(dist)) await app.register(fastifyStatic, { root: dist.startsWith('/') ? dist : `${process.cwd()}/${dist}`, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not-found' });
    return reply.code(404).send('Not found');
  });
  return app;
}
