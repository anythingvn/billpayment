import { useState } from 'preact/hooks';
import type { AuthApi, SessionUser } from '../storage/authApi';
import { InvalidError } from '../storage/errors';

const box = 'max-width:460px;margin:60px auto;padding:0 16px';

/** First run: create the Admin, then optionally import a backup from the single-user app. */
export function Setup({ auth, onDone }: { auth: AuthApi; onDone: (u: SessionUser) => void }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [f, setF] = useState({ setupCode: '', username: '', displayName: '', password: '', again: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });

  const create = async (e: Event) => {
    e.preventDefault();
    setErr('');
    if ([...f.password].length < 10) return setErr('The password must be at least 10 characters');
    if (f.password !== f.again) return setErr('The passwords are different');
    try {
      setUser(await auth.setup({ setupCode: f.setupCode.trim(), username: f.username.trim(), displayName: f.displayName.trim(), password: f.password }));
    } catch (x) {
      setErr(x instanceof InvalidError ? x.messages.join(' ') : String((x as Error).message ?? x));
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try {
      const summary = await auth.importBackup(JSON.parse(await file.text()));
      setMsg(`Imported: ${summary}.`);
    } catch (x) {
      setErr(x instanceof InvalidError ? x.messages.join(' ') : x instanceof SyntaxError ? 'This file is not a backup (not valid JSON).' : String((x as Error).message ?? x));
    }
  };

  if (!user) {
    return (
      <form class="panel" style={box} onSubmit={create}>
        <h2 style="margin-top:0">Set up the server</h2>
        <p class="muted">Create the Admin account. The Admin adds the other users and chooses their roles.</p>
        <p class="muted">The setup code is printed in the server's log when it starts (e.g. <code>docker compose logs app</code>).</p>
        <label class="field">Setup code (in the server log)<input autocomplete="off" value={f.setupCode} onInput={set('setupCode')} /></label>
        <label class="field">Username<input autocomplete="username" value={f.username} onInput={set('username')} /></label>
        <label class="field">Your name<input value={f.displayName} onInput={set('displayName')} /></label>
        <label class="field">Password<input type="password" autocomplete="new-password" value={f.password} onInput={set('password')} /></label>
        <label class="field">Password again<input type="password" autocomplete="new-password" value={f.again} onInput={set('again')} /></label>
        {err && <p class="errors">{err}</p>}
        <button class="btn" type="submit" style="margin-top:12px">Create Admin</button>
      </form>
    );
  }
  return (
    <div class="panel" style={box}>
      <h2 style="margin-top:0">Import your data</h2>
      <p class="muted">In the old app (this browser or the online app) open Backup / Restore → Download backup file, then choose that file here.</p>
      <label class="field">Backup file<input type="file" accept="application/json,.json" onChange={(e) => importFile(e.currentTarget.files?.[0])} /></label>
      {err && <p class="errors">{err}</p>}
      {msg && <p>{msg}</p>}
      <div style="display:flex;gap:10px;margin-top:12px">
        {msg
          ? <button class="btn" onClick={() => onDone(user)}>Continue</button>
          : <button class="btn ghost" onClick={() => onDone(user)}>Skip — start empty</button>}
      </div>
    </div>
  );
}
