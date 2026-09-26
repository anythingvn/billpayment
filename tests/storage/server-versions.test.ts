import { realServerStore } from './realServer';
import { saveDraftBill } from '../../src/screens/Editor';
import { draftFromBill, newDraft } from '../../src/domain/draft';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { sampleContract } from '../contractFixtures';
import { sampleBill } from '../fixtures';

const s = { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', bankAccounts: [{ id: 'a1', bankBin: '970436', accountNumber: '0071000123456', accountHolder: '' }], defaultBankAccountId: 'a1' };
const line = { nameVi: 'Dịch vụ', nameEn: '', unitVi: '', unitEn: '', qty: 1, unitPrice: 1000000, details: [] };
const customer = { name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '' };

describe('versions through the real server', () => {
  it('C1: a saved draft can be saved again and then sent', async () => {
    const { store } = await realServerStore();
    const d = { ...newDraft(s, '2026-09-26'), customerId: 'c1', customer, lines: [line] };
    const first = await saveDraftBill(store, d, s, 'draft');
    expect(first.version).toBe(1);
    const again = await saveDraftBill(store, { ...draftFromBill(first), lines: [{ ...line, qty: 2 }] }, s, 'draft');
    expect(again.version).toBe(2);
    const sent = await saveDraftBill(store, draftFromBill(again), s, 'sent');
    expect([sent.status, sent.version, sent.number]).toEqual(['sent', 3, first.number]);
  });

  it('Drive status recorded by the server is not an edit: an older copy can still be saved and keeps it', async () => {
    const { store, server } = await realServerStore();
    const saved = await store.putBill(sampleBill({ id: 'b1', status: 'sent' }));
    const drive = { fileId: 'f1', link: 'l', savedAt: '2026-09-26T08:00:00.000Z', error: null };
    await server.updateDriveStatus({ type: 'bill', id: 'b1' }, 'drive', () => drive);
    const paid = await store.putBill({ ...saved, status: 'paid', paidDate: '2026-09-30' });
    expect([paid.status, paid.version]).toEqual(['paid', 2]);
    expect(paid.drive).toEqual(drive);
    const k = await store.putContract(sampleContract());
    await server.updateDriveStatus({ type: 'contract', id: 'k1' }, 'drive', () => drive);
    const done = await store.putContract({ ...k, status: 'completed' });
    expect(done.drive).toEqual(drive);
  });
});
