import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/storage/db';
import { allocateBillNumber } from '../../src/storage/numbering';

let n = 0;
const freshDb = () => openAppDb(`num-db-${n++}`);

describe('allocateBillNumber', () => {
  it('counts up per year with 4-digit padding', async () => {
    const db = await freshDb();
    expect(await allocateBillNumber(db, 'TT', '2026-09-25')).toBe('TT-2026-0001');
    expect(await allocateBillNumber(db, 'TT', '2026-12-31')).toBe('TT-2026-0002');
  });
  it('restarts at 0001 for a new year based on the bill date, not today', async () => {
    const db = await freshDb();
    await allocateBillNumber(db, 'TT', '2026-12-30');
    expect(await allocateBillNumber(db, 'TT', '2027-01-02')).toBe('TT-2027-0001');
    expect(await allocateBillNumber(db, 'TT', '2026-12-31')).toBe('TT-2026-0002');
  });
  it('never hands out the same number twice, even when called concurrently', async () => {
    const db = await freshDb();
    const nums = await Promise.all(Array.from({ length: 10 }, () => allocateBillNumber(db, 'TT', '2026-01-01')));
    expect(new Set(nums).size).toBe(10);
  });
  it('uses the current prefix', async () => {
    const db = await freshDb();
    expect(await allocateBillNumber(db, 'SM', '2026-01-01')).toBe('SM-2026-0001');
  });
});
