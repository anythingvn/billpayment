// @vitest-environment node
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withAdmin, addUser, client, PASSWORD } from './helpers';
import { runBackupNow } from '../src/nightly';
import { parseBackup } from '../../src/storage/backup';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../../tests/fixtures';

const backupFile = (over: Record<string, unknown> = {}) => ({
  app: 'payment-bills', schemaVersion: 1, exportedAt: '2026-09-25T00:00:00.000Z',
  customers: [{ id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false }],
  services: [], bills: [sampleBill({ id: 'b1', number: 'TT-2026-0012', status: 'sent' })], contracts: [],
  templates: [{ id: 't1', kind: 'bill', name: 'Bill', fileName: 'bill.docx', uploadedAt: '2026-09-01T00:00:00.000Z', isDefault: false, dataBase64: Buffer.from([0x50, 0x4b, 3, 4]).toString('base64') }],
  settings: { ...DEFAULT_SETTINGS, businessName: 'Sao Mai' },
  counters: { 'counter-2026': 12, 'contract-counter-2026': 3 },
  reportDrive: { 'Báo cáo 2026-08.xlsx': { fileId: 'r1', link: 'l', savedAt: 's', error: null } },
  statementDrive: { 'c1/Đối chiếu X 2026.pdf': { fileId: 's1', link: 'l', savedAt: 's', error: null } },
  ...over,
});

describe('import, backup and restore', () => {
  it('import continues numbering and keeps templates and Drive statuses', async () => {
    const s = await withAdmin();
    const r = await s.admin.post('/api/import', backupFile());
    expect([r.statusCode, r.json().summary]).toEqual([200, '1 bills, 1 customers, 0 services, 0 contracts, 1 templates']);
    expect((await s.admin.post('/api/counters/counter-2026')).json()).toEqual({ value: 13 });
    expect((await s.admin.get('/api/templates')).json().map((t: { id: string }) => t.id)).toEqual(['t1']);
    expect((await s.admin.get('/api/meta/report-drive:Báo cáo 2026-08.xlsx')).json().value.fileId).toBe('r1');
    expect((await s.admin.get('/api/meta/statement-drive:c1%2F%C4%90%E1%BB%91i%20chi%E1%BA%BFu%20X%202026.pdf')).json().value.fileId).toBe('s1');
    expect((await s.admin.get('/api/settings')).json().businessName).toBe('Sao Mai');
    const acts = (await s.admin.get('/api/activity')).json().items.map((i: { action: string }) => i.action);
    expect(acts).toContain('import');
  });

  it('import refused once there are bills, or for non-admins, or when damaged', async () => {
    const s = await withAdmin();
    const lan = await addUser(s, 'lan', 'manager');
    expect((await lan.client.post('/api/import', backupFile())).statusCode).toBe(403);
    expect((await s.admin.post('/api/import', { app: 'nope' })).statusCode).toBe(422);
    await s.admin.post('/api/import', backupFile());
    const again = await s.admin.post('/api/import', backupFile());
    expect([again.statusCode, again.json().message]).toEqual([409, 'Import is only for a new server — use Restore']);
  });

  it('backup JSON has no secrets', async () => {
    const s = await withAdmin();
    await s.admin.post('/api/import', backupFile());
    s.store.setMetaSync('drive-token', { refresh: 'SECRET-REFRESH-TOKEN', email: 'x@y' });
    const r = await s.admin.get('/api/backup');
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-disposition'])).toContain('payment-bills-backup-2026-09-26.json');
    for (const secret of ['"hash"', '"salt"', '"sid"', 'id_hash', 'SECRET-REFRESH-TOKEN', 'drive-token']) expect(r.body).not.toContain(secret);
    const parsed = parseBackup(r.body);
    expect(parsed.ok).toBe(true);
    expect(r.json().users).toEqual([{ username: 'admin', displayName: 'Chủ Doanh Nghiệp', role: 'admin', disabled: false }]);
    expect(Array.isArray(r.json().activity)).toBe(true);
    const lan = await addUser(s, 'lan', 'manager');
    expect((await lan.client.get('/api/backup')).statusCode).toBe(403);
  });

  it('restore keeps users and needs RESTORE', async () => {
    const s = await withAdmin();
    await s.admin.post('/api/import', backupFile());
    s.store.setMetaSync('drive-token', { refresh: 'x' });
    const data = backupFile({ bills: [], customers: [], counters: { 'counter-2026': 40 } });
    expect((await s.admin.post('/api/restore', { confirm: 'restore', data })).statusCode).toBe(422);
    const r = await s.admin.post('/api/restore', { confirm: 'RESTORE', data });
    expect(r.statusCode).toBe(200);
    expect((await s.admin.get('/api/bills')).json()).toEqual([]);
    expect((await s.admin.post('/api/counters/counter-2026')).json()).toEqual({ value: 41 });
    expect(s.store.getMetaSync('drive-token')).toEqual({ refresh: 'x' });
    expect((await client(s.app).post('/api/signin', { username: 'admin', password: PASSWORD })).statusCode).toBe(200);
    expect((await s.admin.get('/api/activity')).json().items.map((i: { action: string }) => i.action)).toContain('restore');
  });

  it('nightly backup keeps 14', async () => {
    const s = await withAdmin();
    const dir = join(s.env.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    for (let d = 1; d <= 16; d++) writeFileSync(join(dir, `billpayment-2026-08-${String(d).padStart(2, '0')}.db`), 'old');
    writeFileSync(join(dir, 'unrelated.txt'), 'keep me');
    const file = runBackupNow(s.store, s.env.dataDir, new Date('2026-09-26T02:00:00'));
    expect(existsSync(file)).toBe(true);
    const files = readdirSync(dir).filter((f) => f.startsWith('billpayment-')).sort();
    expect(files).toHaveLength(14);
    expect(files.at(-1)).toBe('billpayment-2026-09-26.db');
    expect(readdirSync(dir)).toContain('unrelated.txt');
  });
});
