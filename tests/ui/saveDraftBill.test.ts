import 'fake-indexeddb/auto';
import { saveDraftBill } from '../../src/screens/Editor';
import { openAppDb } from '../../src/storage/db';
import { allocateBillNumber } from '../../src/storage/numbering';
import { newDraft, setCustomer, addCustomLine, updateLine, draftFromBill } from '../../src/domain/draft';
import { DEFAULT_SETTINGS } from '../../src/domain/types';

let n = 0;
const settings = { ...DEFAULT_SETTINGS, businessName: 'Sao Mai', taxId: '0312345678', preparedBy: 'An' };
const customer = { id: 'c1', name: 'Hoa Sen Xanh', address: '', taxId: '', contactPerson: '', email: '', phone: '', archived: false };
const draftFor = (date: string) => updateLine(addCustomLine(setCustomer(newDraft(settings, date), customer)), 0, { nameVi: 'A', unitPrice: 100 });

describe('saveDraftBill', () => {
  it('renumbers a draft moved to another year', async () => {
    const db = await openAppDb(`sdb-${n++}`);
    const first = await saveDraftBill(db, draftFor('2026-12-30'), settings, 'draft');
    expect(first.number).toBe('TT-2026-0001');
    await allocateBillNumber(db, 'TT', '2027-01-01'); // 2027-0001 already used elsewhere
    const moved = await saveDraftBill(db, { ...draftFromBill(first), billDate: '2027-01-02', dueDate: '2027-01-12' }, settings, 'draft');
    expect(moved.number).toBe('TT-2027-0002');
    expect(moved.id).toBe(first.id);
  });
  it('keeps the number when the year is unchanged', async () => {
    const db = await openAppDb(`sdb-${n++}`);
    const first = await saveDraftBill(db, draftFor('2026-09-26'), settings, 'draft');
    const again = await saveDraftBill(db, { ...draftFromBill(first), billDate: '2026-12-31' }, settings, 'draft');
    expect(again.number).toBe(first.number);
  });
  it('copies the business details onto the bill when it is sent, not while a draft', async () => {
    const db = await openAppDb(`sdb-${n++}`);
    const draft = await saveDraftBill(db, draftFor('2026-09-26'), settings, 'draft');
    expect(draft.business).toBeUndefined();
    const sent = await saveDraftBill(db, draftFromBill(draft), settings, 'sent');
    expect(sent.business).toEqual({ businessName: 'Sao Mai', taxId: '0312345678', address: '', phone: '', email: '', logoDataUrl: null, preparedBy: 'An' });
  });
});
