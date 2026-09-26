import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { Env } from './env';
import type { SqliteStore } from './sqliteStore';

export interface AppOptions {
  store: SqliteStore;
  env: Env;
  /** The built app (default: ./dist). Not served when missing. */
  distDir?: string;
  /** Clock, for tests. */
  now?: () => Date;
  logger?: boolean;
}

/** The server: the built app at / and the JSON API under /api. */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  app.get('/api/health', async () => ({ ok: true }));

  const dist = opts.distDir ?? 'dist';
  if (existsSync(dist)) await app.register(fastifyStatic, { root: dist.startsWith('/') ? dist : `${process.cwd()}/${dist}`, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not-found' });
    return reply.code(404).send('Not found');
  });
  return app;
}
