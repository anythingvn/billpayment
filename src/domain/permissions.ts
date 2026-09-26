import type { Role } from '../storage/roles';

/** Everything a role may or may not do (spec 2026-09-27-role-permissions §2). Viewing is open to every role. */
export type Action =
  | 'record.edit' | 'bill.send' | 'bill.pay' | 'bill.cancel'
  | 'contract.activate' | 'contract.close' | 'record.remove'
  | 'drive.record' | 'reports.use' | 'settings.edit' | 'admin';

const ALLOWED: Record<Action, Role[]> = {
  'record.edit': ['admin', 'manager', 'creator'],
  'bill.send': ['admin', 'manager', 'creator'],
  'bill.pay': ['admin', 'manager', 'accountant'],
  'bill.cancel': ['admin', 'manager'],
  'contract.activate': ['admin', 'manager', 'creator'],
  'contract.close': ['admin', 'manager'],
  'record.remove': ['admin', 'manager'],
  'drive.record': ['admin', 'manager', 'creator'],
  'reports.use': ['admin', 'manager', 'accountant'],
  'settings.edit': ['admin'],
  admin: ['admin'],
};
export const ACTIONS = Object.keys(ALLOWED) as Action[];

export function can(role: Role, action: Action): boolean {
  return ALLOWED[action].includes(role);
}

export type RecordKind = 'bills' | 'contracts' | 'customers' | 'services';

/** Fields that are not "content": status and archive have their own actions; the rest are tracking or server-owned. */
const NOT_CONTENT = new Set(['status', 'paidDate', 'archived', 'updatedAt', 'drive', 'driveDocx', 'version', 'createdBy', 'updatedBy', 'createdAt']);

function content(x: object, skip: Set<string>): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, w]) => [k, sorted(w)]))
      : v;
  return JSON.stringify(sorted(Object.fromEntries(Object.entries(x).filter(([k, v]) => !skip.has(k) && v !== undefined))));
}

function statusAction(kind: RecordKind, from: string | undefined, to: string | undefined): Action | undefined {
  if (from === to || to === undefined) return undefined;
  if (kind === 'bills') {
    if (to === 'cancelled') return 'bill.cancel';
    if (from === 'draft' && to === 'sent') return 'bill.send';
    if ((from === 'sent' && to === 'paid') || (from === 'paid' && to === 'sent')) return 'bill.pay';
  }
  if (kind === 'contracts') {
    if (from === 'draft' && to === 'active') return 'contract.activate';
    if (to === 'completed' || to === 'terminated') return 'contract.close';
  }
  return undefined; // any other transition is refused by validation
}

/** Every action a save of `next` over the stored `prev` needs (all must be allowed). */
export function actionsFor(kind: RecordKind, prev: object | undefined, next: object): Action[] {
  const n = next as { status?: string; archived?: boolean };
  const out: Action[] = [];
  if (!prev) {
    out.push('record.edit');
    if (kind === 'bills' && n.status === 'sent') out.push('bill.send');
    if (kind === 'contracts' && n.status === 'active') out.push('contract.activate');
    return out;
  }
  const p = prev as { status?: string; archived?: boolean };
  const s = statusAction(kind, p.status, n.status);
  if (s) out.push(s);
  if (!!p.archived !== !!n.archived) out.push('record.remove');
  // Sending a bill stores the business details as sent: part of sending, not an edit.
  const skip = kind === 'bills' && p.status === 'draft' && n.status === 'sent' ? new Set([...NOT_CONTENT, 'business']) : NOT_CONTENT;
  if (content(prev, skip) !== content(next, skip)) out.push('record.edit');
  return out;
}
