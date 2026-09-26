export type DriveErrorKind = 'auth' | 'notFound' | 'offline' | 'origin' | 'other';

export class DriveError extends Error {
  constructor(public kind: DriveErrorKind, message: string) {
    super(message);
    this.name = 'DriveError';
  }
}

export interface DriveFile {
  id: string;
  name: string;
  trashed?: boolean;
  parents?: string[];
  webViewLink?: string;
}

export interface DriveApi {
  /** null when the file does not exist or is in the trash. */
  getFile(id: string): Promise<DriveFile | null>;
  /** parentId may be 'root'. */
  findFolder(name: string, parentId: string): Promise<string | null>;
  createFolder(name: string, parentId: string): Promise<string>;
  createFile(name: string, parentId: string, pdf: Blob): Promise<DriveFile>;
  updateFile(id: string, name: string, pdf: Blob, move?: { from: string; to: string }): Promise<DriveFile>;
  aboutEmail(): Promise<string | null>;
}

type GetToken = (opts?: { refresh?: boolean }) => Promise<string>;

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,trashed,parents,webViewLink';
/** A stalled request must not hold the upload queue forever. */
const REQUEST_TIMEOUT_MS = 90_000;

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function multipart(metadata: object, pdf: Blob): { body: Blob; contentType: string } {
  const boundary = `bill-${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    pdf,
    `\r\n--${boundary}--`,
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export function createDriveApi(getToken: GetToken, fetchFn: typeof fetch = fetch): DriveApi {
  /** Sends a request with the bearer token; refreshes the token once on 401. Returns null for 404. */
  async function call<T>(url: string, init: RequestInit = {}): Promise<T | null> {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken(attempt ? { refresh: true } : undefined);
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      try {
        res = await fetchFn(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (e) {
        const name = (e as { name?: string } | null)?.name;
        if (name === 'TimeoutError' || name === 'AbortError') throw new DriveError('other', 'Google Drive did not respond. Try again.');
        throw new DriveError('offline', 'Offline');
      }
      if (res.status !== 401) break;
    }
    if (!res) throw new DriveError('other', 'No response from Google Drive');
    if (res.status === 401) throw new DriveError('auth', 'Not connected to Google Drive');
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new DriveError('other', `Google Drive error ${res.status}${detail?.error?.message ? `: ${detail.error.message}` : ''}`);
    }
    return (await res.json()) as T;
  }

  const required = <T>(v: T | null, what: string): T => {
    if (v === null) throw new DriveError('notFound', `${what} not found in Google Drive`);
    return v;
  };

  return {
    async getFile(id) {
      const f = await call<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`);
      return f && !f.trashed ? f : null;
    },
    async findFolder(name, parentId) {
      const q = `name = ${quote(name)} and mimeType = '${FOLDER}' and ${quote(parentId)} in parents and trashed = false`;
      const r = await call<{ files: { id: string }[] }>(`${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`);
      return r?.files[0]?.id ?? null;
    },
    async createFolder(name, parentId) {
      const r = await call<{ id: string }>(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
      });
      return required(r, 'Parent folder').id;
    },
    async createFile(name, parentId, pdf) {
      const { body, contentType } = multipart({ name, mimeType: 'application/pdf', parents: [parentId] }, pdf);
      const r = await call<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
        method: 'POST', headers: { 'Content-Type': contentType }, body,
      });
      return required(r, 'Folder');
    },
    async updateFile(id, name, pdf, move) {
      const { body, contentType } = multipart({ name, mimeType: 'application/pdf' }, pdf);
      const params = new URLSearchParams({ uploadType: 'multipart', fields: FILE_FIELDS });
      if (move) {
        params.set('addParents', move.to);
        params.set('removeParents', move.from);
      }
      const r = await call<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(id)}?${params}`, {
        method: 'PATCH', headers: { 'Content-Type': contentType }, body,
      });
      return required(r, 'File');
    },
    async aboutEmail() {
      const r = await call<{ user?: { emailAddress?: string } }>(`${API}/about?fields=user(emailAddress)`);
      return r?.user?.emailAddress ?? null;
    },
  };
}
