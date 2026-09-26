import type { SqliteStore } from './sqliteStore';

export type Action = 'setup' | 'signin' | 'signout' | 'signin-failed' | 'locked' | 'user-created' | 'user-changed' | 'user-disabled'
  | 'password-reset' | 'password-changed' | 'delete' | 'import' | 'restore' | 'backup-download' | 'drive-connect' | 'drive-disconnect';

/** Records who did what (never passwords, tokens or session ids). */
export function logActivity(store: SqliteStore, userId: string | null, action: Action, detail: Record<string, unknown>, now: Date): void {
  store.db.prepare('INSERT INTO activity (at, user_id, action, detail) VALUES (?, ?, ?, ?)').run(now.toISOString(), userId, action, JSON.stringify(detail));
}

export interface ActivityItem { at: string; action: string; user: string | null; detail: Record<string, unknown> }

/** Newest first, 200 per page; `before` continues from the last item's time. */
export function listActivity(store: SqliteStore, before?: string): ActivityItem[] {
  const rows = store.db.prepare(`SELECT a.at, a.action, a.detail, u.display_name AS name FROM activity a LEFT JOIN users u ON u.id = a.user_id
    WHERE (? IS NULL OR a.at < ?) ORDER BY a.at DESC, a.id DESC LIMIT 200`).all(before ?? null, before ?? null) as
    { at: string; action: string; detail: string; name: string | null }[];
  return rows.map((r) => ({ at: r.at, action: r.action, user: r.name, detail: JSON.parse(r.detail) }));
}
