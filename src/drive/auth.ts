import { DriveError } from './api';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };

/** The part of Google Identity Services (google.accounts.oauth2) this app uses. */
export interface Gis {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string }) => void;
  }): { requestAccessToken(o: { prompt: '' | 'consent' }): void };
  revoke(token: string, done: () => void): void;
}

let gisPromise: Promise<Gis> | null = null;

/** Loads the Google Identity Services script once and returns google.accounts.oauth2. */
export function loadGis(): Promise<Gis> {
  gisPromise ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = (window as unknown as { google?: { accounts?: { oauth2?: Gis } } }).google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new DriveError('other', 'Google sign-in did not load'));
    };
    script.onerror = () => {
      gisPromise = null;
      reject(new DriveError('offline', 'Offline'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

function toError(message: string): DriveError {
  if (/origin/i.test(message)) {
    return new DriveError('origin', `Google refused this address. Add ${location.origin} to the Authorized JavaScript origins of your Google Client ID.`);
  }
  return new DriveError('auth', 'Not connected to Google Drive');
}

/**
 * Access tokens for Drive. The token is kept only in this closure (memory) — never stored or logged.
 * Tokens are reused until 60 s before they expire.
 */
export function createDriveAuth(
  clientId: string,
  opts: { gis: () => Promise<Gis>; now?: () => number; wasConnected: boolean },
): { getToken(o?: { refresh?: boolean }): Promise<string>; revoke(): Promise<void> } {
  const now = opts.now ?? Date.now;
  let token: string | null = null;
  let expiresAt = 0;
  let consented = opts.wasConnected;
  let inFlight: Promise<string> | null = null;
  let client: ReturnType<Gis['initTokenClient']> | null = null;
  let settle: { resolve(t: string): void; reject(e: Error): void } | null = null;

  async function request(): Promise<string> {
    const gis = await opts.gis();
    client ??= gis.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.access_token) {
          token = r.access_token;
          expiresAt = now() + (r.expires_in ?? 3600) * 1000;
          consented = true;
          settle?.resolve(r.access_token);
        } else {
          settle?.reject(toError(`${r.error ?? ''} ${r.error_description ?? ''}`));
        }
        settle = null;
      },
      error_callback: (e) => {
        settle?.reject(toError(e.type));
        settle = null;
      },
    });
    return new Promise<string>((resolve, reject) => {
      settle = { resolve, reject };
      client!.requestAccessToken({ prompt: consented ? '' : 'consent' });
    });
  }

  return {
    getToken(o) {
      if (!o?.refresh && token && now() < expiresAt - 60_000) return Promise.resolve(token);
      inFlight ??= request().finally(() => { inFlight = null; });
      return inFlight;
    },
    async revoke() {
      const t = token;
      token = null;
      expiresAt = 0;
      consented = false;
      if (t) {
        const gis = await opts.gis();
        await new Promise<void>((done) => gis.revoke(t, done));
      }
    },
  };
}
