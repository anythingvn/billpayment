import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DocTemplate } from '../../../src/domain/types';
import { VersionConflict, stripTracked } from '../sqliteStore';
import { validateWrite } from '../validate';
import { logActivity } from '../activity';
import type { Ctx } from '../context';
import { invalid, requireUser } from './auth';

const KINDS = ['customers', 'services', 'bills', 'contracts'] as const;
type RecordKind = (typeof KINDS)[number];
const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
const COUNTER = /^(contract-)?counter-\d{4}$/;
/** Meta keys the app may write (Drive statuses of reports/statements, last backup time). */
const WRITABLE_META = (k: string) => k.startsWith('report-drive:') || k.startsWith('statement-drive:') || k === 'lastBackupAt';
const READABLE_META = (k: string) => WRITABLE_META(k) || COUNTER.test(k);

const conflict = (reply: FastifyReply) => reply.code(409).send({ error: 'conflict' });

export function recordRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { store } = ctx;
  const signedIn = { preHandler: requireUser(ctx) };
  const actorOf = (u: { id: string; displayName: string }) => ({ id: u.id, displayName: u.displayName });

  for (const kind of KINDS) {
    app.get(`/api/${kind}`, signedIn, async () => {
      if (kind === 'bills') return store.listBills();
      if (kind === 'contracts') return store.listContracts();
      if (kind === 'customers') return store.listCustomers();
      return store.listServices();
    });
    app.put(`/api/${kind}/:id`, signedIn, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as Record<string, unknown> & { id?: string; version?: number };
      if (typeof body !== 'object' || body.id !== id) return invalid(reply, ['The record id does not match the address']);
      const prev = kind === 'bills' ? await store.getBill(id) : kind === 'contracts' ? await store.getContract(id) : undefined;
      const problems = validateWrite(kind, prev, stripTracked(body));
      if (problems.length) return invalid(reply, problems);
      // Drive status belongs to the server (its uploads write it): a save never changes it.
      if (kind === 'bills' || kind === 'contracts') {
        const stored = prev as { drive?: unknown; driveDocx?: unknown } | undefined;
        delete body.drive;
        delete body.driveDocx;
        if (stored?.drive !== undefined) body.drive = stored.drive;
        if (stored?.driveDocx !== undefined) body.driveDocx = stored.driveDocx;
      }
      try {
        return store.putRecord(kind as RecordKind, body, { actor: actorOf(req.user!), expectVersion: body.version ?? 0, now: ctx.now().toISOString() });
      } catch (e) {
        if (e instanceof VersionConflict) return conflict(reply);
        throw e;
      }
    });
  }
  app.get('/api/bills/:id', signedIn, async (req, reply) => (await store.getBill((req.params as { id: string }).id)) ?? reply.code(404).send({ error: 'not-found' }));
  app.get('/api/contracts/:id', signedIn, async (req, reply) => (await store.getContract((req.params as { id: string }).id)) ?? reply.code(404).send({ error: 'not-found' }));

  app.delete('/api/customers/:id', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    const result = await store.deleteOrArchiveCustomer(id);
    logActivity(store, req.user!.id, 'delete', { kind: 'customers', id, result }, ctx.now());
    return { result };
  });
  app.delete('/api/contracts/:id', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    const result = await store.deleteContract(id);
    logActivity(store, req.user!.id, 'delete', { kind: 'contracts', id, result }, ctx.now());
    return { result };
  });

  // Templates travel as JSON with their bytes base64-encoded.
  app.get('/api/templates', signedIn, async () => (await store.listTemplates())
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
    .map(({ data, ...t }) => ({ ...t, dataBase64: Buffer.from(data).toString('base64') })));
  app.put('/api/templates/:id', signedIn, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as Omit<DocTemplate, 'data'> & { dataBase64?: string };
    if (b.id !== id || typeof b.dataBase64 !== 'string') return invalid(reply, ['The template is incomplete']);
    const bytes = Buffer.from(b.dataBase64, 'base64');
    if (bytes.length > MAX_TEMPLATE_BYTES) return invalid(reply, ['The template is larger than 5 MB']);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return invalid(reply, ["This isn't a Word .docx file"]);
    if (!['contract', 'addendum', 'bill', 'statement'].includes(b.kind)) return invalid(reply, ['Unknown template kind']);
    if (typeof b.name !== 'string' || !b.name.trim() || typeof b.fileName !== 'string' || typeof b.uploadedAt !== 'string'
      || Number.isNaN(Date.parse(b.uploadedAt)) || typeof b.isDefault !== 'boolean') return invalid(reply, ['The template is incomplete']);
    // Only the known fields are stored.
    const meta = { id: b.id, kind: b.kind, name: b.name, fileName: b.fileName, uploadedAt: b.uploadedAt, isDefault: b.isDefault };
    try {
      store.putTemplateSync({ ...meta, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer },
        { actor: actorOf(req.user!), expectVersion: b.version ?? 0, now: ctx.now().toISOString() });
    } catch (e) {
      if (e instanceof VersionConflict) return conflict(reply);
      throw e;
    }
    return { ok: true };
  });
  app.delete('/api/templates/:id', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    const r = await store.removeTemplate(id);
    logActivity(store, req.user!.id, 'delete', { kind: 'templates', id }, ctx.now());
    return r;
  });

  app.get('/api/settings', signedIn, async () => store.getSettings());
  app.put('/api/settings', signedIn, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown> & { id?: string; version?: number };
    try {
      store.putRecord('settings', body, { actor: actorOf(req.user!), expectVersion: body.version ?? 0, now: ctx.now().toISOString() });
    } catch (e) {
      if (e instanceof VersionConflict) return conflict(reply);
      throw e;
    }
    return store.getSettings();
  });

  app.get('/api/meta/:key', signedIn, async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!READABLE_META(key)) return reply.code(403).send({ error: 'forbidden' });
    return { value: store.getMetaSync(key) ?? null };
  });
  app.put('/api/meta/:key', signedIn, async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!WRITABLE_META(key)) return reply.code(403).send({ error: 'forbidden' });
    store.setMetaSync(key, ((req.body ?? {}) as { value?: unknown }).value ?? null);
    return { ok: true };
  });

  /** Atomically increments a bill or contract number counter (so two people never get the same number). */
  app.post('/api/counters/:key', signedIn, async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!COUNTER.test(key)) return reply.code(403).send({ error: 'forbidden' });
    return { value: await store.nextCounter(key) };
  });
}
