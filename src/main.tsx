import { render } from 'preact';
import './styles.css';
import { App } from './app';
import { openAppDb, getSettings } from './storage/db';
import { ServerRoot } from './serverRoot';
import { serverAuth } from './storage/authApi';
import { ApiStore } from './storage/apiStore';
import { setConnection } from './ui/useOnline';
import { useServerDrive } from './drive/service';
import { serverDriveClient } from './drive/serverClient';

const root = document.getElementById('app')!;
const message = (title: string, body: string) => render(
  <div style="max-width:560px;margin:60px auto;font-family:system-ui;padding:0 16px"><h2>{title}</h2><p>{body}</p></div>,
  root,
);

/**
 * Where the data lives: on the company server when this page is served by it (/api/health answers), otherwise
 * in this browser (the single-user app, e.g. on GitHub Pages). A device that used the server before but can't
 * reach it now also opens in server mode, showing its offline copy.
 */
async function detectServer(): Promise<boolean> {
  try {
    const r = await fetch('/api/health', { credentials: 'same-origin' });
    return r.ok && ((await r.json().catch(() => null)) as { ok?: boolean } | null)?.ok === true;
  } catch {
    try { return localStorage.getItem('bp-last-user') !== null; } catch { return false; }
  }
}

async function boot() {
  if (await detectServer()) {
    // Drive runs on the server: the company account connected once by the Admin.
    useServerDrive(serverDriveClient).catch(() => undefined);
    render(<ServerRoot auth={serverAuth} makeStore={async (u) => new ApiStore({ userId: u.id, onStatus: setConnection })} />, root);
    return;
  }
  try {
    const db = await openAppDb(undefined, {
      onBlocked: () => message('Updating the app…', 'Please close other tabs of this app to finish updating, then reload.'),
    });
    const settings = await getSettings(db);
    navigator.storage?.persist?.().catch(() => undefined);
    render(<App db={db} initialSettings={settings} />, root);
  } catch (e) {
    message('Cannot open your saved data', `The browser did not allow this app to store data (${String(e)}). Open the app in a normal (not private/incognito) window of Chrome or Edge. If this keeps happening, restore from your latest backup file.`);
  }
}
boot();
