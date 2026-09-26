import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { DriveStatus } from '../../src/domain/types';
import { createDriveApi, type DriveApi } from '../../src/drive/api';
import { uploadFile } from '../../src/drive/upload';
import type { Env } from './env';
import type { SqliteStore } from './sqliteStore';

/** AES-256-GCM with a random 12-byte IV: "iv.tag.cipher" (base64). */
export function encryptToken(key: Buffer, text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decryptToken(key: Buffer, blob: string): string {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Google's OAuth endpoints (a fake in tests). */
export interface GoogleOAuth {
  authUrl(state: string): string;
  exchange(code: string): Promise<{ refreshToken: string; email: string | null }>;
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  revoke(token: string): Promise<void>;
}

export function googleOAuth(env: Env): GoogleOAuth {
  const redirect = `${env.publicUrl}/api/drive/callback`;
  const post = async (url: string, form: Record<string, string>) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(json.error ?? r.status));
    return json;
  };
  return {
    authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: env.googleClientId, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/drive.file openid email', state,
    })}`,
    exchange: async (code) => {
      const j = await post('https://oauth2.googleapis.com/token', {
        code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: redirect, grant_type: 'authorization_code',
      });
      // The ID token comes straight from Google over TLS; we only read the email from it.
      const idToken = String(j.id_token ?? '');
      const email = idToken ? (JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')).email ?? null) : null;
      if (!j.refresh_token) throw new Error('Google did not return a refresh token');
      return { refreshToken: String(j.refresh_token), email };
    },
    refresh: async (refreshToken) => {
      const j = await post('https://oauth2.googleapis.com/token', {
        refresh_token: refreshToken, client_id: env.googleClientId, client_secret: env.googleClientSecret, grant_type: 'refresh_token',
      });
      return { accessToken: String(j.access_token), expiresIn: Number(j.expires_in) || 3600 };
    },
    revoke: async (token) => { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined); },
  };
}

export type UploadTarget = { type: 'bill' | 'contract' | 'report' | 'statement'; id: string };
export const NOT_CONNECTED = "Google Drive isn't connected — ask the Admin";
const EXPIRED = 'Google access expired — the Admin must reconnect Google Drive';
const TOKEN_META = 'drive-token';
const META_PREFIX = { report: 'report-drive:', statement: 'statement-drive:' } as const;
const EMPTY: DriveStatus = { fileId: null, link: null, savedAt: null, error: null };

/** The company Drive: one encrypted refresh token on the server; uploads run one at a time. */
export class ServerDrive {
  private access: { token: string; until: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private store: SqliteStore,
    private env: Env,
    private oauth: GoogleOAuth,
    private makeApi: (getToken: () => Promise<string>) => DriveApi = (g) => createDriveApi(g),
    private now: () => Date = () => new Date(),
  ) {}

  status(): { connected: boolean; email: string | null } {
    const t = this.store.getMetaSync<{ token: string; email: string | null }>(TOKEN_META);
    return { connected: !!t, email: t?.email ?? null };
  }

  save(refreshToken: string, email: string | null): void {
    this.store.setMetaSync(TOKEN_META, { token: encryptToken(this.env.tokenKey, refreshToken), email });
    this.access = null;
  }

  async disconnect(): Promise<void> {
    const t = this.store.getMetaSync<{ token: string }>(TOKEN_META);
    if (t) await this.oauth.revoke(decryptToken(this.env.tokenKey, t.token));
    this.store.db.prepare('DELETE FROM meta WHERE key = ?').run(TOKEN_META);
    this.access = null;
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.until > this.now().getTime()) return this.access.token;
    const t = this.store.getMetaSync<{ token: string }>(TOKEN_META);
    if (!t) throw new Error(NOT_CONNECTED);
    let r;
    try {
      r = await this.oauth.refresh(decryptToken(this.env.tokenKey, t.token));
    } catch {
      throw new Error(EXPIRED);
    }
    this.access = { token: r.accessToken, until: this.now().getTime() + (r.expiresIn - 60) * 1000 };
    return r.accessToken;
  }

  private existing(target: UploadTarget, field: 'drive' | 'driveDocx'): DriveStatus | undefined {
    if (target.type === 'report' || target.type === 'statement') return this.store.getMetaSync<DriveStatus>(`${META_PREFIX[target.type]}${target.id}`);
    const rec = this.store.db.prepare('SELECT json FROM records WHERE kind = ? AND id = ?').get(target.type === 'bill' ? 'bills' : 'contracts', target.id) as { json: string } | undefined;
    const obj = rec ? (JSON.parse(rec.json) as Record<string, DriveStatus | undefined>) : undefined;
    return obj?.[target.type === 'bill' ? field : 'drive'];
  }

  private async record(target: UploadTarget, field: 'drive' | 'driveDocx', make: (prev: DriveStatus) => DriveStatus): Promise<DriveStatus> {
    if (target.type === 'report' || target.type === 'statement') {
      const key = `${META_PREFIX[target.type]}${target.id}`;
      const next = make(this.store.getMetaSync<DriveStatus>(key) ?? EMPTY);
      this.store.setMetaSync(key, next);
      return next;
    }
    return this.store.updateDriveStatus({ type: target.type, id: target.id }, field, (prev) => make(prev ?? EMPTY));
  }

  /** Uploads (or updates) one file and records its status where the app reads it. Errors are recorded, not thrown. */
  upload(input: { target: UploadTarget; field: 'drive' | 'driveDocx'; fileName: string; folders: string[]; mimeType: string; data: Buffer }): Promise<DriveStatus> {
    const run = this.queue.then(async () => {
      try {
        const api = this.makeApi(() => this.accessToken());
        const cache = this.store.getMetaSync<Record<string, string>>('driveFolders') ?? {};
        const result = await uploadFile(api, {
          folders: input.folders, fileName: input.fileName, mimeType: input.mimeType,
          blob: new Blob([new Uint8Array(input.data)], { type: input.mimeType }),
          existingFileId: this.existing(input.target, input.field)?.fileId ?? null,
        }, cache, this.now().toISOString());
        this.store.setMetaSync('driveFolders', result.cache);
        return await this.record(input.target, input.field, () => result.status);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return this.record(input.target, input.field, (prev) => ({ ...prev, error }));
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
