import { useState } from 'preact/hooks';
import type { AuthApi, SessionUser } from '../storage/authApi';
import { InvalidError, OfflineError } from '../storage/errors';

const box = 'max-width:380px;margin:60px auto;padding:0 16px';

/** Username + password. Wrong details, disabled or locked accounts all get the same message from the server. */
export function SignIn({ auth, onSignedIn, username: initial = '' }: { auth: AuthApi; onSignedIn: (u: SessionUser) => void; username?: string }) {
  const [username, setUsername] = useState(initial);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      onSignedIn(await auth.signIn(username.trim(), password));
    } catch (x) {
      setErr(x instanceof InvalidError ? x.messages.join(' ') : x instanceof OfflineError ? x.message : 'Something went wrong on the server');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="panel" style={box} onSubmit={submit}>
      <h2 style="margin-top:0">Phiếu thanh toán — Sign in</h2>
      <label class="field">Username<input autocomplete="username" value={username} onInput={(e) => setUsername(e.currentTarget.value)} /></label>
      <label class="field">Password<input type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} /></label>
      {err && <p class="errors">{err}</p>}
      <button class="btn" type="submit" disabled={busy} style="margin-top:12px">Sign in</button>
    </form>
  );
}

/** A new or reset password must be replaced at the first sign-in. */
export function ChangePassword({ auth, onDone, required = true }: { auth: AuthApi; onDone: (u: SessionUser) => void; required?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    if ([...next].length < 10) return setErr('The password must be at least 10 characters');
    if (next !== again) return setErr('The passwords are different');
    try {
      onDone(await auth.changePassword(current, next));
    } catch (x) {
      setErr(x instanceof InvalidError ? x.messages.join(' ') : String((x as Error).message ?? x));
    }
  };
  return (
    <form class="panel" style={box} onSubmit={submit}>
      <h2 style="margin-top:0">Choose a new password</h2>
      {required && <p class="muted">Your password was set by the Admin. Choose your own (at least 10 characters).</p>}
      <label class="field">Current password<input type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} /></label>
      <label class="field">New password<input type="password" autocomplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} /></label>
      <label class="field">New password again<input type="password" autocomplete="new-password" value={again} onInput={(e) => setAgain(e.currentTarget.value)} /></label>
      {err && <p class="errors">{err}</p>}
      <button class="btn" type="submit" style="margin-top:12px">Save password</button>
    </form>
  );
}
