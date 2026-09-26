import type { FastifyInstance } from 'fastify';
import type { Env } from './env';

/** Security headers on every response, and the CSRF check on every state-changing request. */
export function addSecurity(app: FastifyInstance, env: Env): void {
  const origin = new URL(env.publicUrl).origin;
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const header = req.headers['x-requested-with'];
    const from = req.headers.origin;
    if (header !== 'billpayment' || (from !== undefined && from !== origin)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "frame-ancestors 'none'");
    return payload;
  });
}
