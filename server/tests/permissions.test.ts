// @vitest-environment node
import { withAdmin, addUser } from './helpers';
import { sampleBill } from '../../tests/fixtures';
import { sampleContract } from '../../tests/contractFixtures';
import { DEFAULT_SETTINGS } from '../../src/domain/types';

const customer = { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };
const business = { businessName: 'Sao Mai', taxId: '', address: '', phone: '', email: '', logo: null };

/** Admin + one user of each role, with a customer, a draft bill b1, a sent bill b2 and a draft contract k1. */
async function world() {
  const s = await withAdmin();
  const manager = (await addUser(s, 'minh', 'manager')).client;
  const creator = (await addUser(s, 'lan', 'creator')).client;
  const accountant = (await addUser(s, 'hoa', 'accountant')).client;
  await s.admin.put('/api/customers/c1', customer);
  await s.admin.put('/api/bills/b1', sampleBill({ id: 'b1', number: 'TT-2026-0001' }));
  await s.admin.put('/api/bills/b2', sampleBill({ id: 'b2', number: 'TT-2026-0002', status: 'sent', business: business as never }));
  await s.admin.put('/api/contracts/k1', sampleContract({ status: 'draft' }));
  const get = async (url: string) => (await s.admin.get(url)).json();
  return { ...s, manager, creator, accountant, get };
}

describe('role permissions on the server', () => {
  it('creator can save a draft, finalize a new sent bill, and take a number', async () => {
    const w = await world();
    const b1 = await w.get('/api/bills/b1');
    expect((await w.creator.put('/api/bills/b1', { ...b1, footerNote: 'Cảm ơn' })).statusCode).toBe(200);
    const fresh = sampleBill({ id: 'b3', number: 'TT-2026-0003', status: 'sent', business: business as never });
    expect((await w.creator.put('/api/bills/b3', fresh)).statusCode).toBe(200);
    expect((await w.creator.post('/api/counters/counter-2026')).statusCode).toBe(200);
  });

  it('creator is refused cancel, deletes, archive, terminate, settings and templates; nothing changes', async () => {
    const w = await world();
    const b2 = await w.get('/api/bills/b2');
    const k1 = await w.get('/api/contracts/k1');
    const c1 = (await w.get('/api/customers'))[0];
    const tries = [
      await w.creator.put('/api/bills/b2', { ...b2, status: 'cancelled' }),
      await w.creator.del('/api/customers/c1'),
      await w.creator.put('/api/customers/c1', { ...c1, archived: true }),
      await w.creator.del('/api/contracts/k1'),
      await w.creator.put('/api/contracts/k1', { ...k1, status: 'terminated' }),
      await w.creator.put('/api/settings', { ...DEFAULT_SETTINGS, businessName: 'Hacked' }),
      await w.creator.put('/api/templates/t1', { id: 't1', kind: 'bill', name: 'X', fileName: 'x.docx', uploadedAt: '2026-09-27T00:00:00.000Z', isDefault: true, dataBase64: 'UEsDBA==' }),
    ];
    expect(tries.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(tries[0].json()).toEqual({ error: 'forbidden' });
    expect((await w.get('/api/bills/b2')).status).toBe('sent');
    expect(await w.get('/api/customers')).toEqual([c1]);
    expect((await w.get('/api/contracts/k1')).status).toBe('draft');
    expect((await w.get('/api/settings')).businessName).not.toBe('Hacked');
    expect(await w.get('/api/templates')).toEqual([]);
  });

  it('accountant marks a sent bill paid and back to sent', async () => {
    const w = await world();
    const b2 = await w.get('/api/bills/b2');
    const paid = await w.accountant.put('/api/bills/b2', { ...b2, status: 'paid', paidDate: '2026-09-27' });
    expect(paid.statusCode).toBe(200);
    const back = await w.accountant.put('/api/bills/b2', { ...(paid.json() as object), status: 'sent', paidDate: null });
    expect(back.statusCode).toBe(200);
  });

  it('accountant marking paid while changing a line gets 403 and the bill is unchanged', async () => {
    const w = await world();
    const b2 = await w.get('/api/bills/b2');
    const r = await w.accountant.put('/api/bills/b2', { ...b2, status: 'paid', paidDate: '2026-09-27', lines: [{ ...b2.lines[0], qty: 9 }] });
    expect(r.statusCode).toBe(403);
    expect(await w.get('/api/bills/b2')).toEqual(b2);
  });

  it('accountant is refused a new draft bill, a counter and a customer edit', async () => {
    const w = await world();
    const c1 = (await w.get('/api/customers'))[0];
    const tries = [
      await w.accountant.put('/api/bills/b9', sampleBill({ id: 'b9', number: 'TT-2026-0009' })),
      await w.accountant.post('/api/counters/counter-2026'),
      await w.accountant.put('/api/customers/c1', { ...c1, phone: '0901' }),
    ];
    expect(tries.map((r) => r.statusCode)).toEqual([403, 403, 403]);
  });

  it('manager cancels, deletes and archives, but not settings or templates', async () => {
    const w = await world();
    const b2 = await w.get('/api/bills/b2');
    const c1 = (await w.get('/api/customers'))[0];
    const ok = [
      await w.manager.put('/api/bills/b2', { ...b2, status: 'cancelled' }),
      await w.manager.del('/api/contracts/k1'),
      await w.manager.put('/api/customers/c1', { ...c1, archived: true }),
    ];
    expect(ok.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const no = [
      await w.manager.put('/api/settings', { ...DEFAULT_SETTINGS, businessName: 'X' }),
      await w.manager.put('/api/templates/t1', { id: 't1', kind: 'bill', name: 'X', fileName: 'x.docx', uploadedAt: '2026-09-27T00:00:00.000Z', isDefault: true, dataBase64: 'UEsDBA==' }),
      await w.manager.del('/api/templates/t1'),
    ];
    expect(no.map((r) => r.statusCode)).toEqual([403, 403, 403]);
  });

  it('a forbidden save that is also invalid answers 403, not 422', async () => {
    const w = await world();
    const b2 = await w.get('/api/bills/b2');
    const r = await w.creator.put('/api/bills/b2', { ...b2, status: 'cancelled', lines: [] });
    expect(r.statusCode).toBe(403);
  });

  it('meta: reports and statements for reports.use; lastBackupAt for admin', async () => {
    const w = await world();
    const v = { value: { state: 'saved' } };
    expect((await w.accountant.put('/api/meta/report-drive:x', v)).statusCode).toBe(200);
    expect((await w.accountant.put('/api/meta/statement-drive:x', v)).statusCode).toBe(200);
    expect((await w.creator.put('/api/meta/report-drive:x', v)).statusCode).toBe(403);
    expect((await w.creator.put('/api/meta/statement-drive:x', v)).statusCode).toBe(403);
    expect((await w.manager.put('/api/meta/lastBackupAt', { value: 'x' })).statusCode).toBe(403);
    expect((await w.admin.put('/api/meta/lastBackupAt', { value: 'x' })).statusCode).toBe(200);
  });

  it('drive upload: by target kind', async () => {
    const w = await world();
    const up = (type: string) => ({ target: { type, id: 'x' }, fileName: 'a.pdf', folders: ['Phiếu thanh toán'], mimeType: 'application/pdf', dataBase64: 'JVBE' });
    const report = await w.accountant.post('/api/drive/upload', up('report'));
    expect(report.statusCode).not.toBe(403);
    expect((await w.accountant.post('/api/drive/upload', up('bill'))).statusCode).toBe(403);
    expect((await w.creator.post('/api/drive/upload', up('statement'))).statusCode).toBe(403);
    expect((await w.creator.post('/api/drive/upload', up('bill'))).statusCode).not.toBe(403);
  });

  it('each refusal is logged', async () => {
    const w = await world();
    const b2 = await w.get('/api/bills/b2');
    await w.creator.put('/api/bills/b2', { ...b2, status: 'cancelled' });
    await w.manager.put('/api/settings', { ...DEFAULT_SETTINGS });
    const items = (await w.get('/api/activity')).items as { action: string; user: string; detail: Record<string, unknown> }[];
    const refused = items.filter((i) => i.action === 'forbidden');
    expect(refused).toEqual([
      expect.objectContaining({ user: 'minh', detail: { action: 'settings.edit' } }),
      expect.objectContaining({ user: 'lan', detail: { action: 'bill.cancel', kind: 'bills', id: 'b2' } }),
    ]);
  });
});
