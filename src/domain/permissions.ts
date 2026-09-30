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

/** Fields that are not "content", per kind: status and archive have their own actions; the rest are tracking or server-owned. */
const TRACKED = ['version', 'createdBy', 'updatedBy'];
const NOT_CONTENT: Record<RecordKind, Set<string>> = {
  bills: new Set([...TRACKED, 'status', 'paidDate', 'updatedAt', 'createdAt', 'drive', 'driveDocx']),
  contracts: new Set([...TRACKED, 'status', 'updatedAt', 'createdAt', 'drive']),
  customers: new Set([...TRACKED, 'archived']),
  services: new Set([...TRACKED, 'archived']),
};

function content(x: object, skip: Set<string>): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, w]) => [k, sorted(w)]))
      : v;
  return JSON.stringify(sorted(Object.fromEntries(Object.entries(x).filter(([k, v]) => !skip.has(k) && v !== undefined))));
}

/** The action a status change needs. Changes that aren't normal transitions (validation refuses them) need the
 * strictest action of their kind, so a role that can't close or cancel is refused before validation runs. */
function statusAction(kind: RecordKind, from: string | undefined, to: string | undefined): Action | undefined {
  if (from === to) return undefined;
  if (kind === 'bills') {
    if (from === 'draft' && to === 'sent') return 'bill.send';
    if ((from === 'sent' && to === 'paid') || (from === 'paid' && to === 'sent')) return 'bill.pay';
    return 'bill.cancel';
  }
  if (kind === 'contracts') return from === 'draft' && to === 'active' ? 'contract.activate' : 'contract.close';
  return undefined;
}

/** Every action a save of `next` over the stored `prev` needs (all must be allowed). */
export function actionsFor(kind: RecordKind, prev: object | undefined, next: object): Action[] {
  const n = next as { status?: string; archived?: boolean; paidDate?: string | null };
  const out: Action[] = [];
  if (!prev) {
    out.push('record.edit');
    if (kind === 'bills' && n.status === 'sent') out.push('bill.send');
    if (kind === 'contracts' && n.status === 'active') out.push('contract.activate');
    if (kind === 'contracts' && (n.status === 'completed' || n.status === 'terminated')) out.push('contract.close');
    return out;
  }
  const p = prev as typeof n;
  const hasStatus = kind === 'bills' || kind === 'contracts';
  const s = hasStatus ? statusAction(kind, p.status, n.status) : undefined;
  if (s) out.push(s);
  // A paid date changed on its own is a payment change.
  if (kind === 'bills' && !s && (p.paidDate ?? null) !== (n.paidDate ?? null)) out.push('bill.pay');
  if (!hasStatus && !!p.archived !== !!n.archived) out.push('record.remove');
  // Sending a bill stores the business details as sent: part of sending, not an edit.
  const skip = kind === 'bills' && p.status === 'draft' && n.status === 'sent' ? new Set([...NOT_CONTENT.bills, 'business']) : NOT_CONTENT[kind];
  if (content(prev, skip) !== content(next, skip)) out.push('record.edit');
  return out;
}
