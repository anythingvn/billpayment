// @vitest-environment node
import { withAdmin, addUser, client } from './helpers';
import { sampleBill } from '../../tests/fixtures';
import { sampleContract, sampleAddendum } from '../../tests/contractFixtures';
import { DEFAULT_SETTINGS } from '../../src/domain/types';

const customer = { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };

describe('records API', () => {
  it('create and update with versions', async () => {
    const s = await withAdmin();
    const created = (await s.admin.put('/api/customers/c1', customer)).json();
    expect(created).toMatchObject({ ...customer, version: 1, createdBy: 'Chủ Doanh Nghiệp', updatedBy: 'Chủ Doanh Nghiệp' });
    const updated = await s.admin.put('/api/customers/c1', { ...created, name: 'Hoa Sen Xanh' });
    expect(updated.json()).toMatchObject({ name: 'Hoa Sen Xanh', version: 2 });
    expect((await s.admin.get('/api/customers')).json().map((c: { name: string }) => c.name)).toEqual(['Hoa Sen Xanh']);
  });

  it('stale version gets 409 and changes nothing', async () => {
    const s = await withAdmin();
    const v1 = (await s.admin.put('/api/customers/c1', customer)).json();
    const a = await s.admin.put('/api/customers/c1', { ...v1, name: 'First' });
    const b = await s.admin.put('/api/customers/c1', { ...v1, name: 'Second' });
    expect([a.statusCode, b.statusCode, b.json()]).toEqual([200, 409, { error: 'conflict' }]);
    expect((await s.admin.get('/api/customers')).json()[0]).toMatchObject({ name: 'First', version: 2 });
    const create = await s.admin.put('/api/customers/c1', { ...customer, name: 'Pretends to be new' });
    expect(create.statusCode).toBe(409);
  });

  it('authorship', async () => {
    const s = await withAdmin();
    const lan = await addUser(s, 'lan', 'manager', 'Chị Lan');
    const v1 = (await s.admin.put('/api/customers/c1', customer)).json();
    const v2 = (await lan.client.put('/api/customers/c1', { ...v1, phone: '0901' })).json();
    expect([v2.createdBy, v2.updatedBy]).toEqual(['Chủ Doanh Nghiệp', 'Chị Lan']);
  });

  it('20 simultaneous allocations', async () => {
    const s = await withAdmin();
    const results = await Promise.all(Array.from({ length: 20 }, () => s.admin.post('/api/counters/counter-2026')));
    const values = results.map((r) => r.json().value).sort((a: number, b: number) => a - b);
    expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await s.admin.post('/api/counters/anything-else')).statusCode).toBe(403);
    expect((await s.admin.get('/api/meta/counter-2026')).json()).toEqual({ value: 20 });
  });

  it('server refuses an invalid or changed locked bill', async () => {
    const s = await withAdmin();
    const bad = await s.admin.put('/api/bills/b1', sampleBill({ lines: [{ nameVi: 'x', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1.5, details: [] }] }));
    expect([bad.statusCode, bad.json().messages]).toEqual([422, ['Line 1: Unit price must be a whole number of at least 0']]);
    const sent = (await s.admin.put('/api/bills/b1', sampleBill({ status: 'sent' }))).json();
    const edited = await s.admin.put('/api/bills/b1', { ...sent, lines: [{ ...sent.lines[0], unitPrice: 999 }] });
    expect([edited.statusCode, edited.json().messages]).toEqual([422, ['This bill is locked — duplicate it to make changes']]);
    const paid = await s.admin.put('/api/bills/b1', { ...sent, status: 'paid', paidDate: '2026-09-30' });
    expect(paid.json()).toMatchObject({ status: 'paid', version: 2 });
    const back = await s.admin.put('/api/bills/b1', { ...(paid.json() as object), status: 'draft' });
    expect(back.statusCode).toBe(422);
    const contract = await s.admin.put('/api/contracts/k1', sampleContract({ number: '' }));
    expect(contract.statusCode).toBe(422);
  });

  it('delete rules, logged', async () => {
    const s = await withAdmin();
    await s.admin.put('/api/customers/c1', customer);
    await s.admin.put('/api/customers/c2', { ...customer, id: 'c2' });
    await s.admin.put('/api/bills/b1', sampleBill({ customerId: 'c1' }));
    expect((await s.admin.del('/api/customers/c1')).json()).toEqual({ result: 'archived' });
    expect((await s.admin.del('/api/customers/c2')).json()).toEqual({ result: 'deleted' });
    await s.admin.put('/api/contracts/k1', sampleContract());
    await s.admin.put('/api/contracts/a1', sampleAddendum());
    expect((await s.admin.del('/api/contracts/k1')).json()).toEqual({ result: 'refused' });
    const deletes = (await s.admin.get('/api/activity')).json().items.filter((i: { action: string }) => i.action === 'delete');
    expect(deletes.map((d: { detail: object }) => d.detail)).toEqual(expect.arrayContaining([
      { kind: 'customers', id: 'c2', result: 'deleted' }, { kind: 'customers', id: 'c1', result: 'archived' }, { kind: 'contracts', id: 'k1', result: 'refused' },
    ]));
  });

  it('templates round-trip their bytes; one default', async () => {
    const s = await withAdmin();
    const t = { id: 'A', kind: 'contract', name: 'A', fileName: 'a.docx', uploadedAt: '2026-01-01T00:00:00.000Z', isDefault: true, dataBase64: Buffer.from([0x50, 0x4b, 3, 4]).toString('base64') };
    expect((await s.admin.put('/api/templates/A', t)).statusCode).toBe(200);
    await s.admin.put('/api/templates/B', { ...t, id: 'B', uploadedAt: '2026-02-01T00:00:00.000Z' });
    const list = (await s.admin.get('/api/templates')).json();
    expect(list.map((x: { id: string; isDefault: boolean; dataBase64: string }) => [x.id, x.isDefault, x.dataBase64])).toEqual([['A', false, t.dataBase64], ['B', true, t.dataBase64]]);
    await s.admin.put('/api/contracts/k1', sampleContract({ templateId: 'B' }));
    expect((await s.admin.del('/api/templates/B')).json()).toEqual({ contractsReset: 1 });
    const big = await s.admin.put('/api/templates/C', { ...t, id: 'C', dataBase64: Buffer.alloc(6 * 1024 * 1024, 0x50).toString('base64') });
    expect(big.statusCode).toBe(422);
  });

  it('settings with version', async () => {
    const s = await withAdmin();
    const first = (await s.admin.get('/api/settings')).json();
    const saved = (await s.admin.put('/api/settings', { ...first, businessName: 'Sao Mai' })).json();
    expect(saved).toMatchObject({ businessName: 'Sao Mai', version: 1 });
    expect((await s.admin.put('/api/settings', { ...first, businessName: 'Stale' })).statusCode).toBe(409);
    void DEFAULT_SETTINGS;
  });

  it('meta keys', async () => {
    const s = await withAdmin();
    expect((await s.admin.put('/api/meta/counter-2026', { value: 99 })).statusCode).toBe(403);
    expect((await s.admin.put('/api/meta/report-drive:Báo cáo 2026-09.xlsx', { value: { fileId: 'f' } })).statusCode).toBe(200);
    expect((await s.admin.get('/api/meta/report-drive:Báo cáo 2026-09.xlsx')).json()).toEqual({ value: { fileId: 'f' } });
    expect((await s.admin.get('/api/meta/drive-token')).statusCode).toBe(403);
  });

  it('signed out', async () => {
    const s = await withAdmin();
    const anon = client(s.app);
    for (const url of ['/api/bills', '/api/customers', '/api/settings', '/api/templates']) expect((await anon.get(url)).statusCode).toBe(401);
    expect((await anon.put('/api/customers/c1', customer)).statusCode).toBe(401);
  });
});
