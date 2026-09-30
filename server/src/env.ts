/** Server settings, from the environment / .env. */
export interface Env {
  sessionSecret: string;
  /** 32-byte key that encrypts the Google refresh token. */
  tokenKey: Buffer;
  googleClientId: string;
  googleClientSecret: string;
  /** e.g. http://localhost:8080 or https://bills.example.vn */
  publicUrl: string;
  dataDir: string;
  port: number;
  /** Cookies get `Secure` when the public address is https. */
  secureCookies: boolean;
}

export function loadEnv(vars: Record<string, string | undefined>): Env {
  const sessionSecret = vars.SESSION_SECRET?.trim() ?? '';
  const tokenKeyText = vars.TOKEN_KEY?.trim() ?? '';
  if (!sessionSecret || !tokenKeyText) throw new Error('Missing SESSION_SECRET or TOKEN_KEY in .env');
  const tokenKey = Buffer.from(tokenKeyText, 'base64');
  if (tokenKey.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64-encoded (run: npm run make-env)');
  const publicUrl = (vars.PUBLIC_URL?.trim() || 'http://localhost:8080').replace(/\/+$/, '');
  return {
    sessionSecret,
    tokenKey,
    googleClientId: vars.GOOGLE_CLIENT_ID?.trim() ?? '',
    googleClientSecret: vars.GOOGLE_CLIENT_SECRET?.trim() ?? '',
    publicUrl,
    dataDir: vars.DATA_DIR?.trim() || '/data',
    port: Number(vars.PORT) || 8080,
    secureCookies: publicUrl.startsWith('https:'),
  };
}
