import type { Bill, Contract } from '../../src/domain/types';
import { dateErrors, draftSaveErrors } from '../../src/domain/validate';
import { canTransition } from '../../src/domain/status';
import { contractSaveErrors } from '../../src/domain/contractPlan';
import { draftFromBill } from '../../src/domain/draft';
import { stripTracked } from './sqliteStore';

export const LOCKED = 'This bill is locked — duplicate it to make changes';
/** Fields a sent/paid/cancelled bill may still change. */
const LOCKED_ALLOWED = new Set(['status', 'paidDate', 'drive', 'driveDocx', 'updatedAt']);

const same = (a: object, b: object) => {
  const pick = (x: object) => Object.fromEntries(Object.entries(stripTracked(x)).filter(([k]) => !LOCKED_ALLOWED.has(k)).sort(([p], [q]) => p.localeCompare(q)));
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b));
};

/** Contract status changes the screens make (anything else is refused). */
const CONTRACT_MOVES: Record<string, string[]> = { draft: ['active', 'terminated'], active: ['completed', 'terminated'], completed: ['terminated'], terminated: [] };

/** The same rules the screens apply, checked again on the server for every write. Empty = OK. */
export function validateWrite(kind: string, prev: unknown, next: Record<string, unknown>): string[] {
  switch (kind) {
    case 'customers':
      return typeof next.name === 'string' && next.name.trim() ? [] : ['Name is required.'];
    case 'services':
      return typeof next.nameVi === 'string' && next.nameVi.trim() ? [] : ['Service name is required.'];
    case 'contracts': {
      // The editor's own checks first (same messages), then the contract rules.
      const c = next as unknown as Contract;
      const out: string[] = [];
      const was = (prev as Contract | undefined)?.status;
      if (was && was !== c.status && !CONTRACT_MOVES[was]?.includes(c.status)) return [`A ${was} contract can't become ${c.status}`];
      if (typeof c.customerId !== 'string' || !c.customerId) out.push('Choose a customer');
      if (typeof c.number !== 'string' || !c.number.trim()) out.push('Enter a number');
      if (!Array.isArray(c.lines) || !c.plan) return [...out, 'The contract is incomplete.'];
      return [...out, ...contractSaveErrors(c)];
    }
    case 'bills': {
      const b = next as unknown as Bill;
      const p = prev as Bill | undefined;
      if (!Array.isArray(b.lines) || typeof b.billDate !== 'string' || typeof b.dueDate !== 'string') return ['The bill is incomplete.'];
      if (p && p.status !== 'draft') {
        if (!same(p, b)) return [LOCKED];
        if (p.status !== b.status && !canTransition(p.status, b.status) && !(p.status === 'paid' && b.status === 'sent')) {
          return [`A ${p.status} bill can't become ${b.status}`];
        }
        return [];
      }
      if (!p && !['draft', 'sent'].includes(b.status)) return ['A new bill must be a draft or sent'];
      if (p && b.status !== 'draft' && !canTransition('draft', b.status)) return [`A draft bill can't become ${b.status}`];
      return [...draftSaveErrors(draftFromBill(b)), ...dateErrors(b.billDate, b.dueDate)];
    }
    default:
      return [];
  }
}
