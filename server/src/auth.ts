import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { SqliteStore } from './sqliteStore';

export type Role = 'admin' | 'manager' | 'creator' | 'accountant';
export const ROLES: Role[] = ['admin', 'manager', 'creator', 'accountant'];
export const BAD_SIGNIN = 'Wrong username or password, or the account is locked for a while';
export const PASSWORD_RULE = 'The password must be at least 10 characters';
const DAY = 86400000;
const SESSION_DAYS = 30;
const LOCK_MINUTES = 15;
const MAX_FAILURES = 5;

/** What the API returns about a user — never the hash, salt or sessions. */
export interface PublicUser {
  id: string; username: string; displayName: string; role: Role; disabled: boolean; mustChangePassword: boolean; lastSignIn: string | null;
}
interface UserRow {
  id: string; username: string; display_name: string; role: Role; hash: string; salt: string; disabled: number; must_change: number; last_signin: string | null;
}
const toPublic = (u: UserRow): PublicUser => ({
  id: u.id, username: u.username, displayName: u.display_name, role: u.role, disabled: !!u.disabled, mustChangePassword: !!u.must_change, lastSignIn: u.last_signin,
});

/** scrypt N=2^15, r=8, p=1, 64-byte key. */
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  return { hash: (await derive(password, salt)).toString('base64'), salt: salt.toString('base64') };
}
async function passwordMatches(password: string, hash: string, salt: string): Promise<boolean> {
  const key = await derive(password, Buffer.from(salt, 'base64'));
  const stored = Buffer.from(hash, 'base64');
  return stored.length === key.length && timingSafeEqual(stored, key);
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const passwordErrors = (password: unknown): string[] => (typeof password !== 'string' || [...password].length < 10 ? [PASSWORD_RULE] : []);

export class Accounts {
  constructor(private store: SqliteStore) {}
  private get db() { return this.store.db; }

  count(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n; }
  list(): PublicUser[] { return (this.db.prepare('SELECT * FROM users ORDER BY created_at, username').all() as unknown as UserRow[]).map(toPublic); }
  get(id: string): PublicUser | undefined {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
    return u && toPublic(u);
  }
  byUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as unknown as UserRow | undefined;
  }
  activeAdmins(exceptId?: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?").get(exceptId ?? '') as { n: number }).n;
  }

  async create(input: { username: string; displayName: string; role: Role; password: string; mustChange: boolean }, now: Date): Promise<PublicUser> {
    const { hash, salt } = await hashPassword(input.password);
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id, username, display_name, role, hash, salt, disabled, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .run(id, input.username.trim(), input.displayName.trim(), input.role, hash, salt, input.mustChange ? 1 : 0, now.toISOString());
    return this.get(id)!;
  }

  update(id: string, change: { displayName?: string; role?: Role; disabled?: boolean }): PublicUser {
    if (change.displayName !== undefined) this.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(change.displayName.trim(), id);
    if (change.role !== undefined) this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(change.role, id);
    if (change.disabled !== undefined) {
      this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(change.disabled ? 1 : 0, id);
      if (change.disabled) this.endSessions(id);
    }
    this.store.forgetNames();
    return this.get(id)!;
  }

  async setPassword(id: string, password: string, mustChange: boolean): Promise<void> {
    const { hash, salt } = await hashPassword(password);
    this.db.prepare('UPDATE users SET hash = ?, salt = ?, must_change = ? WHERE id = ?').run(hash, salt, mustChange ? 1 : 0, id);
  }
  async checkPassword(id: string, password: string): Promise<boolean> {
    const u = this.db.prepare('SELECT hash, salt FROM users WHERE id = ?').get(id) as { hash: string; salt: string } | undefined;
    return !!u && passwordMatches(password, u.hash, u.salt);
  }

  /**
   * Checks a sign-in. Unknown users, wrong passwords, disabled accounts and locked usernames all fail the same way.
   * Returns the user, or `{ failed, locked }` where `locked` is true when this failure just locked the username.
   */
  async signIn(username: string, password: string, now: Date): Promise<{ user: PublicUser } | { failed: true; lockedNow: boolean }> {
    const since = new Date(now.getTime() - LOCK_MINUTES * 60000).toISOString();
    const failures = () => (this.db.prepare('SELECT COUNT(*) AS n FROM signin_failures WHERE username = ? AND at > ?').get(username.trim(), since) as { n: number }).n;
    const u = this.byUsername(username);
    // Always derive once, so unknown usernames take as long as wrong passwords.
    const ok = u ? await passwordMatches(password, u.hash, u.salt) : (await derive(password, randomBytes(16)), false);
    if (failures() >= MAX_FAILURES || !u || !ok || u.disabled) {
      const before = failures();
      this.db.prepare('INSERT INTO signin_failures (username, at) VALUES (?, ?)').run(username.trim(), now.toISOString());
      return { failed: true, lockedNow: before === MAX_FAILURES - 1 };
    }
    this.db.prepare('DELETE FROM signin_failures WHERE username = ?').run(u.username);
    this.db.prepare('UPDATE users SET last_signin = ? WHERE id = ?').run(now.toISOString(), u.id);
    return { user: this.get(u.id)! };
  }

  /** Starts a session; returns the cookie value (only its hash is stored). */
  startSession(userId: string, now: Date): string {
    const sid = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, last_used) VALUES (?, ?, ?)').run(sha(sid), userId, now.toISOString());
    return sid;
  }
  /** The signed-in user for a cookie value, renewing the session; undefined when missing, expired or disabled. */
  sessionUser(sid: string | undefined, now: Date): PublicUser | undefined {
    if (!sid) return undefined;
    const row = this.db.prepare('SELECT user_id, last_used FROM sessions WHERE id_hash = ?').get(sha(sid)) as { user_id: string; last_used: string } | undefined;
    if (!row) return undefined;
    if (now.getTime() - new Date(row.last_used).getTime() > SESSION_DAYS * DAY) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha(sid));
      return undefined;
    }
    const user = this.get(row.user_id);
    if (!user || user.disabled) return undefined;
    this.db.prepare('UPDATE sessions SET last_used = ? WHERE id_hash = ?').run(now.toISOString(), sha(sid));
    return user;
  }
  endSession(sid: string): void { this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha(sid)); }
  endSessions(userId: string): void { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
