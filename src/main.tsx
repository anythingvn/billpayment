import { render } from 'preact';
import './styles.css';
import { App } from './app';
import { openAppDb, getSettings } from './storage/db';

async function boot() {
  const root = document.getElementById('app')!;
  try {
    const db = await openAppDb(undefined, {
      onBlocked: () => render(
        <div style="max-width:560px;margin:60px auto;font-family:system-ui;padding:0 16px">
          <h2>Updating the app…</h2>
          <p>Please close other tabs of this app to finish updating, then reload.</p>
        </div>,
        root,
      ),
    });
    const settings = await getSettings(db);
    navigator.storage?.persist?.().catch(() => undefined);
    render(<App db={db} initialSettings={settings} />, root);
  } catch (e) {
    render(
      <div style="max-width:560px;margin:60px auto;font-family:system-ui;padding:0 16px">
        <h2>Cannot open your saved data</h2>
        <p>The browser did not allow this app to store data ({String(e)}).</p>
        <p>Open the app in a normal (not private/incognito) window of Chrome or Edge. If this keeps happening, restore from your latest backup file.</p>
      </div>,
      root,
    );
  }
}
boot();
