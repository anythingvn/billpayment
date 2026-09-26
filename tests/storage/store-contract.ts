import type { Store } from '../../src/storage/store';
import type { DocTemplate } from '../../src/domain/types';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleBill } from '../fixtures';
import { sampleContract, sampleAddendum } from '../contractFixtures';

const tpl = (over: Partial<DocTemplate>): DocTemplate => ({
  id: 't', kind: 'contract', name: 'T', fileName: 't.docx', data: new Uint8Array([0x50, 0x4b, 1, 2]).buffer as ArrayBuffer,
  uploadedAt: '2026-01-01T00:00:00.000Z', isDefault: false, ...over,
});
const customer = { id: 'c1', name: 'Công ty CP Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };
const plain = <T,>(x: T) => JSON.parse(JSON.stringify(x, (_k, v) => (v instanceof ArrayBuffer ? [...new Uint8Array(v)] : v)));
/** Strips fields a server adds (version, authorship) so stores compare on the business data. */
const bare = <T extends object>(x: T) => {
  const { version: _v, createdBy: _c, updatedBy: _u, ...rest } = x as T & { version?: number; createdBy?: string; updatedBy?: string };
  return rest;
};

/** Behaviour every Store must have (browser IndexedDB, SQLite server, …). */
export function storeContract(name: string, make: () => Promise<Store>) {
  describe(`${name} store contract`, () => {
    it('customers and services', async () => {
      const db = await make();
      await db.putCustomer(customer);
      await db.putService({ id: 's1', nameVi: 'Thiết kế', nameEn: 'Design', unitVi: 'gói', unitEn: 'package', unitPrice: 1000, archived: false } as never);
      expect((await db.listCustomers()).map(bare)).toEqual([customer]);
      expect((await db.listServices()).map((s) => s.id)).toEqual(['s1']);
    });
    it('bills: put, get, list newest first', async () => {
      const db = await make();
      await db.putBill(sampleBill({ id: 'a', number: 'TT-2026-0001', billDate: '2026-01-01' }));
      await db.putBill(sampleBill({ id: 'b', number: 'TT-2026-0002', billDate: '2026-02-01' }));
      expect((await db.listBills()).map((b) => b.id)).toEqual(['b', 'a']);
      expect(bare((await db.getBill('a'))!)).toEqual(sampleBill({ id: 'a', number: 'TT-2026-0001', billDate: '2026-01-01' }));
      expect(await db.getBill('zzz')).toBeUndefined();
    });
    it('delete or archive a customer', async () => {
      const db = await make();
      await db.putCustomer(customer);
      await db.putCustomer({ ...customer, id: 'c2' });
      await db.putBill(sampleBill({ customerId: 'c1' }));
      expect(await db.deleteOrArchiveCustomer('c1')).toBe('archived');
      expect(await db.deleteOrArchiveCustomer('c2')).toBe('deleted');
      expect((await db.listCustomers()).map((c) => [c.id, c.archived])).toEqual([['c1', true]]);
    });
    it('contracts and delete rules', async () => {
      const db = await make();
      await db.putContract(sampleContract());
      await db.putContract(sampleAddendum());
      expect(await db.deleteContract('k1')).toBe('refused');
      expect(await db.deleteContract('a1')).toBe('deleted');
      expect(await db.deleteContract('k1')).toBe('deleted');
      expect(await db.listContracts()).toEqual([]);
    });
    it('templates: one default, removal promotes the oldest, templateFor', async () => {
      const db = await make();
      await db.putTemplate(tpl({ id: 'A', isDefault: true, uploadedAt: '2026-01-01T00:00:00.000Z' }));
      await db.putTemplate(tpl({ id: 'B', uploadedAt: '2026-02-01T00:00:00.000Z' }));
      await db.putTemplate(tpl({ id: 'C', isDefault: true, uploadedAt: '2026-03-01T00:00:00.000Z' }));
      expect((await db.listTemplates()).filter((t) => t.isDefault).map((t) => t.id)).toEqual(['C']);
      await db.putContract(sampleContract({ templateId: 'C' }));
      expect(await db.removeTemplate('C')).toEqual({ contractsReset: 1 });
      expect((await db.templateFor('contract', null))?.id).toBe('A');
      expect((await db.getContract('k1'))!.templateId).toBeNull();
      expect([...new Uint8Array((await db.templateFor('contract', 'B'))!.data)]).toEqual([0x50, 0x4b, 1, 2]);
      expect(await db.templateFor('bill')).toBeNull();
    });
    it('settings and meta', async () => {
      const db = await make();
      expect((await db.getSettings()).businessName).toBe(DEFAULT_SETTINGS.businessName);
      await db.putSettings({ ...DEFAULT_SETTINGS, businessName: 'Sao Mai' });
      expect((await db.getSettings()).businessName).toBe('Sao Mai');
      await db.setMeta('report-drive:x.xlsx', { a: 1 });
      expect(await db.getMeta('report-drive:x.xlsx')).toEqual({ a: 1 });
      expect(await db.getMeta('nothing')).toBeUndefined();
    });
    it('nextCounter counts per key', async () => {
      const db = await make();
      expect([await db.nextCounter('counter-2026'), await db.nextCounter('counter-2026'), await db.nextCounter('counter-2027')]).toEqual([1, 2, 1]);
    });
    it('updateDriveStatus merges on the record', async () => {
      const db = await make();
      await db.putBill(sampleBill({ status: 'sent' }));
      const saved = { fileId: 'f', link: 'l', savedAt: 's', error: null };
      await db.updateDriveStatus({ type: 'bill', id: 'b1' }, 'drive', () => saved);
      const next = await db.updateDriveStatus({ type: 'bill', id: 'b1' }, 'drive', (prev) => ({ ...prev!, error: 'Offline' }));
      expect(next).toEqual({ ...saved, error: 'Offline' });
      expect((await db.getBill('b1'))!.drive).toEqual(next);
    });
    it('export and restore round trip', async () => {
      const src = await make();
      await src.putCustomer(customer);
      await src.putBill(sampleBill());
      await src.putContract(sampleContract());
      await src.putTemplate(tpl({ id: 'A', isDefault: true }));
      await src.nextCounter('counter-2026');
      await src.setMeta('statement-drive:c1/x.pdf', { fileId: 'f', link: null, savedAt: null, error: null });
      const data = await src.exportAll('2026-09-26T00:00:00.000Z');
      expect(data.counters).toEqual({ 'counter-2026': 1 });
      const dst = await make();
      await dst.restoreAll(data);
      const again = await dst.exportAll('2026-09-26T00:00:00.000Z');
      expect(plain({ ...again, bills: again.bills.map(bare), customers: again.customers.map(bare), contracts: again.contracts.map(bare), templates: again.templates.map(bare), settings: bare(again.settings) }))
        .toEqual(plain({ ...data, bills: data.bills.map(bare), customers: data.customers.map(bare), contracts: data.contracts.map(bare), templates: data.templates.map(bare), settings: bare(data.settings) }));
    });
  });
}
