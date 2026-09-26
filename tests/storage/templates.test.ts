import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { openAppDb, listTemplates, putTemplate, removeTemplate, templateFor, putContract, getContract, listContracts } from '../../src/storage/db';
import type { DocTemplate } from '../../src/domain/types';
import { sampleContract } from '../contractFixtures';

let n = 0;
const name = () => `templates-db-${n++}`;
const bytes = (s = 'PK-template') => new TextEncoder().encode(s).buffer as ArrayBuffer;
const tpl = (over: Partial<DocTemplate>): DocTemplate => ({
  id: 't', kind: 'contract', name: 'T', fileName: 't.docx', data: bytes(), uploadedAt: '2026-01-01T00:00:00.000Z', isDefault: false, ...over,
});

describe('templates store (DB v3)', () => {
  it('upgrade from v2 keeps contracts', async () => {
    const dbName = name();
    const v2 = await openDB(dbName, 2, {
      upgrade(db) {
        db.createObjectStore('customers', { keyPath: 'id' });
        db.createObjectStore('services', { keyPath: 'id' });
        db.createObjectStore('bills', { keyPath: 'id' }).createIndex('byCustomer', 'customerId');
        db.createObjectStore('settings');
        db.createObjectStore('meta');
        const c = db.createObjectStore('contracts', { keyPath: 'id' });
        c.createIndex('byCustomer', 'customerId');
        c.createIndex('byParent', 'parentId');
      },
    });
    await v2.put('contracts', sampleContract());
    v2.close();
    const db = await openAppDb(dbName);
    expect((await listContracts(db)).map((c) => c.id)).toEqual(['k1']);
    expect(await listTemplates(db)).toEqual([]);
  });

  it('one default contract template', async () => {
    const db = await openAppDb(name());
    await putTemplate(db, tpl({ id: 'A', isDefault: true }));
    await putTemplate(db, tpl({ id: 'B', isDefault: true }));
    expect((await listTemplates(db)).filter((t) => t.isDefault).map((t) => t.id)).toEqual(['B']);
  });

  it('removing the default promotes the oldest remaining', async () => {
    const db = await openAppDb(name());
    await putTemplate(db, tpl({ id: 'A', uploadedAt: '2026-01-01T00:00:00.000Z' }));
    await putTemplate(db, tpl({ id: 'B', uploadedAt: '2026-02-01T00:00:00.000Z', isDefault: true }));
    await putTemplate(db, tpl({ id: 'C', uploadedAt: '2026-03-01T00:00:00.000Z' }));
    await putContract(db, sampleContract({ templateId: 'B' }));
    expect(await removeTemplate(db, 'B')).toEqual({ contractsReset: 1 });
    expect((await listTemplates(db)).find((t) => t.isDefault)?.id).toBe('A');
    expect((await getContract(db, 'k1'))!.templateId).toBeNull();
  });

  it('templateFor', async () => {
    const db = await openAppDb(name());
    expect(await templateFor(db, 'contract', null)).toBeNull();
    await putTemplate(db, tpl({ id: 'A', isDefault: true }));
    await putTemplate(db, tpl({ id: 'B' }));
    await putTemplate(db, tpl({ id: 'P', kind: 'addendum' }));
    expect((await templateFor(db, 'contract', 'B'))?.id).toBe('B');
    expect((await templateFor(db, 'contract', null))?.id).toBe('A');
    expect((await templateFor(db, 'contract', 'gone'))?.id).toBe('A');
    expect((await templateFor(db, 'addendum'))?.id).toBe('P');
    expect(await templateFor(db, 'bill')).toBeNull();
  });
});
