import { canTransition, applyStatus, isOverdue, displayStatus, isLocked } from '../../src/domain/status';
import { sampleBill } from '../fixtures';

describe('status transitions', () => {
  it('allows exactly the spec transitions', () => {
    const allowed = ['draft>sent', 'draft>cancelled', 'sent>paid', 'sent>cancelled', 'paid>sent'];
    const all = ['draft', 'sent', 'paid', 'cancelled'] as const;
    for (const f of all) for (const t of all) {
      expect(canTransition(f, t)).toBe(allowed.includes(`${f}>${t}`));
    }
  });
  it('records and clears the paid date', () => {
    const paid = applyStatus(sampleBill({ status: 'sent' }), 'paid', '2026-10-01', '2026-10-01T09:00:00.000Z');
    expect(paid.paidDate).toBe('2026-10-01');
    expect(paid.updatedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(applyStatus(paid, 'sent', '2026-10-02', 'x').paidDate).toBeNull();
  });
  it('throws on an invalid transition', () => {
    expect(() => applyStatus(sampleBill({ status: 'cancelled' }), 'sent', '2026-10-01', 'x')).toThrow();
  });
});

describe('overdue and locking', () => {
  it('is overdue only when sent and past the due date', () => {
    expect(isOverdue(sampleBill({ status: 'sent' }), '2026-10-05')).toBe(false);
    expect(isOverdue(sampleBill({ status: 'sent' }), '2026-10-06')).toBe(true);
    expect(isOverdue(sampleBill({ status: 'paid' }), '2026-12-01')).toBe(false);
    expect(displayStatus(sampleBill({ status: 'sent' }), '2026-10-06')).toBe('overdue');
    expect(displayStatus(sampleBill({ status: 'draft' }), '2026-10-06')).toBe('draft');
  });
  it('locks everything except drafts', () => {
    expect(isLocked(sampleBill())).toBe(false);
    expect(isLocked(sampleBill({ status: 'sent' }))).toBe(true);
    expect(isLocked(sampleBill({ status: 'cancelled' }))).toBe(true);
  });
});

describe('drive status and bill status', () => {
  it('keeps drive status when the bill status changes', () => {
    const drive = { fileId: 'f1', link: null, savedAt: null, error: null };
    expect(applyStatus(sampleBill({ status: 'sent', drive }), 'paid', '2026-10-01', 'x').drive).toEqual(drive);
  });
});
