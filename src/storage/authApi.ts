import type { Role } from './roles';
import { ConflictError, ForbiddenError, InvalidError, OfflineError, ServerError, SignInError } from './errors';

export interface SessionUser { id: string; username: string; displayName: string; role: Role; mustChangePassword: boolean }
export interface UserInfo extends SessionUser { disabled: boolean; lastSignIn: string | null }
export interface ActivityItem { at: string; action: string; user: string | null; detail: Record<string, unknown> }

/** Sign-in, users and activity calls to the server (separate from the data Store). */
export interface AuthApi {
  setupNeeded(): Promise<boolean>;
  setup(input: { setupCode: string; username: string; displayName: string; password: string }): Promise<SessionUser>;
  signIn(username: string, password: string): Promise<SessionUser>;
  me(): Promise<SessionUser>;
  signOut(): Promise<void>;
  changePassword(current: string, next: string): Promise<SessionUser>;
  importBackup(data: unknown): Promise<string>;
  listUsers(): Promise<UserInfo[]>;
  addUser(u: { username: string; displayName: string; role: Role; password: string }): Promise<UserInfo>;
  updateUser(id: string, change: { displayName?: string; role?: Role; disabled?: boolean }): Promise<UserInfo>;
  resetPassword(id: string, password: string): Promise<void>;
  listActivity(before?: string): Promise<ActivityItem[]>;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'billpayment', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfflineError();
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: string[]; message?: string };
  if (res.status === 401) {
    // A refused sign-in carries its (deliberately vague) message; any other 401 means the session ended.
    if (url === '/api/signin') throw new InvalidError([json.message ?? 'Wrong username or password']);
    throw new SignInError();
  }
  if (res.status === 403) {
    if (url === '/api/setup') throw new InvalidError([json.message ?? 'Wrong setup code']);
    throw new ForbiddenError();
  }
  if (res.status === 409) {
    if (json.message) throw new InvalidError([json.message]);
    throw new ConflictError();
  }
  if (res.status === 422) throw new InvalidError(json.messages ?? []);
  if (!res.ok) throw new ServerError();
  return json as T;
}

/** The real AuthApi over fetch. */
export const serverAuth: AuthApi = {
  setupNeeded: async () => (await call<{ needed: boolean }>('GET', '/api/setup')).needed,
  setup: async (input) => (await call<{ user: SessionUser }>('POST', '/api/setup', input)).user,
  signIn: async (username, password) => (await call<{ user: SessionUser }>('POST', '/api/signin', { username, password })).user,
  me: async () => (await call<{ user: SessionUser }>('GET', '/api/me')).user,
  signOut: async () => { await call('POST', '/api/signout'); },
  changePassword: async (current, next) => (await call<{ user: SessionUser }>('POST', '/api/me/password', { current, next })).user,
  importBackup: async (data) => (await call<{ summary: string }>('POST', '/api/import', data)).summary,
  listUsers: async () => (await call<{ users: UserInfo[] }>('GET', '/api/users')).users,
  addUser: async (u) => (await call<{ user: UserInfo }>('POST', '/api/users', u)).user,
  updateUser: async (id, change) => (await call<{ user: UserInfo }>('PATCH', `/api/users/${encodeURIComponent(id)}`, change)).user,
  resetPassword: async (id, password) => { await call('POST', `/api/users/${encodeURIComponent(id)}/password`, { password }); },
  listActivity: async (before) => (await call<{ items: ActivityItem[] }>('GET', `/api/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`)).items,
};
