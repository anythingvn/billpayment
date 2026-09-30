import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import type { UserInfo } from '../storage/authApi';
import { ROLE_LABEL, ROLES, type Role } from '../storage/roles';
import { InvalidError } from '../storage/errors';
import { formatDateTime } from '../ui/DriveStatusLine';
import { useWrite } from '../ui/useOnline';

/** Admin only: add users, change roles, reset passwords, disable accounts. */
export function Users() {
  const { auth, user: me } = useApp();
  const w = useWrite();
  const [users, setUsers] = useState<UserInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ username: '', displayName: '', role: 'creator' as Role, password: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = async () => setUsers(await auth!.listUsers());
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setErr('');
    setMsg('');
    try {
      await fn();
      setMsg(done);
      await load();
    } catch (x) {
      setErr(x instanceof InvalidError ? x.messages.join(' ') : String((x as Error).message ?? x));
    }
  };
  if (!users) return <p class="muted">Loading…</p>;
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });

  return (
    <div>
      <div class="page-head"><h2>Users</h2><button class="btn" {...w()} onClick={() => setAdding(true)}>+ Add user</button></div>
      {err && <p class="errors">{err}</p>}
      {msg && <p class="muted">{msg}</p>}
      {adding && (
        <div class="panel">
          <div class="grid2">
            <label class="field">Username<input value={f.username} onInput={set('username')} /></label>
            <label class="field">Name<input value={f.displayName} onInput={set('displayName')} /></label>
            <label class="field">Role
              <select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            </label>
            <label class="field">First password<input type="password" autocomplete="new-password" value={f.password} onInput={set('password')} /></label>
          </div>
          <p class="muted">They choose their own password when they first sign in.</p>
          <button class="btn" {...w()} onClick={() => run(async () => {
            await auth!.addUser({ username: f.username.trim(), displayName: f.displayName.trim(), role: f.role, password: f.password });
            setAdding(false);
            setF({ username: '', displayName: '', role: 'creator', password: '' });
          }, 'User created.')}>Create user</button>{' '}
          <button class="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      <div class="table-scroll"><table class="list">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.displayName}{u.id === me?.id && <span class="muted"> (you)</span>}</td>
              <td>{u.username}</td>
              <td>
                <select aria-label={`Role of ${u.username}`} value={u.role} {...w()}
                  onChange={(e) => run(() => auth!.updateUser(u.id, { role: e.currentTarget.value as Role }), 'Role changed.')}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </td>
              <td>{u.disabled ? 'Disabled' : u.mustChangePassword ? 'Must change password' : 'Active'}</td>
              <td>{u.lastSignIn ? formatDateTime(u.lastSignIn) : '—'}</td>
              <td style="white-space:nowrap">
                <button class="btn ghost" {...w()} onClick={() => {
                  const p = prompt(`New password for ${u.displayName} (at least 10 characters). They must change it at their next sign-in.`);
                  if (p) run(() => auth!.resetPassword(u.id, p), 'Password reset.');
                }}>Reset password</button>{' '}
                {u.disabled
                  ? <button class="btn ghost" {...w()} onClick={() => run(() => auth!.updateUser(u.id, { disabled: false }), 'Enabled.')}>Enable</button>
                  : <button class="btn ghost" {...w()} onClick={() => {
                    if (confirm(`Disable ${u.displayName}? They are signed out everywhere.`)) run(() => auth!.updateUser(u.id, { disabled: true }), 'Disabled.');
                  }}>Disable</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
