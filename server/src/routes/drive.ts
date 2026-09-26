import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { logActivity } from '../activity';
import type { Ctx } from '../context';
import { NOT_CONNECTED, type GoogleOAuth, type ServerDrive, type UploadTarget } from '../drive';
import { invalid, requireAdmin, requireUser } from './auth';

const STATE_MINUTES = 10;

export function driveRoutes(app: FastifyInstance, ctx: Ctx, drive: ServerDrive, oauth: GoogleOAuth): void {
  // One-time codes binding Google's redirect back to the Admin who started it (the session cookie isn't sent on that
  // cross-site redirect).
  const states = new Map<string, { userId: string; until: number }>();

  app.get('/api/drive/status', { preHandler: requireUser(ctx) }, async () => drive.status());

  app.get('/api/drive/connect', { preHandler: requireAdmin(ctx) }, async (req, reply) => {
    if (!ctx.env.googleClientId || !ctx.env.googleClientSecret) return invalid(reply, ['Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server settings first']);
    const state = randomBytes(24).toString('base64url');
    states.set(state, { userId: req.user!.id, until: ctx.now().getTime() + STATE_MINUTES * 60000 });
    return reply.redirect(oauth.authUrl(state), 302);
  });

  app.get('/api/drive/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const s = state ? states.get(state) : undefined;
    if (state) states.delete(state);
    if (!s || s.until < ctx.now().getTime() || !code) return reply.code(400).send('This Google sign-in link has expired. Go back to Settings and connect again.');
    try {
      const { refreshToken, email } = await oauth.exchange(code);
      drive.save(refreshToken, email);
      logActivity(ctx.store, s.userId, 'drive-connect', { email }, ctx.now());
    } catch {
      return reply.code(400).send('Google did not accept the sign-in. Go back to Settings and try again.');
    }
    return reply.redirect('/#/settings', 302);
  });

  app.post('/api/drive/disconnect', { preHandler: requireAdmin(ctx) }, async (req) => {
    await drive.disconnect();
    logActivity(ctx.store, req.user!.id, 'drive-disconnect', {}, ctx.now());
    return drive.status();
  });

  app.post('/api/drive/upload', { preHandler: requireUser(ctx) }, async (req, reply) => {
    const b = (req.body ?? {}) as { target?: UploadTarget; field?: string; fileName?: string; folders?: unknown; mimeType?: string; dataBase64?: string };
    const okTarget = b.target && ['bill', 'contract', 'report', 'statement'].includes(b.target.type) && typeof b.target.id === 'string' && b.target.id;
    if (!okTarget || typeof b.fileName !== 'string' || !Array.isArray(b.folders) || !b.folders.every((f) => typeof f === 'string' && f)
      || typeof b.mimeType !== 'string' || typeof b.dataBase64 !== 'string') return invalid(reply, ['The upload is incomplete']);
    if (!drive.status().connected) return reply.code(409).send({ error: 'conflict', message: NOT_CONNECTED });
    return drive.upload({
      target: b.target!, field: b.field === 'driveDocx' ? 'driveDocx' : 'drive', fileName: b.fileName, folders: b.folders as string[],
      mimeType: b.mimeType, data: Buffer.from(b.dataBase64, 'base64'),
    });
  });
}
