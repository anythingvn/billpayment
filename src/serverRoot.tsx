import { useEffect, useMemo, useState } from 'preact/hooks';
import { App } from './app';
import type { Store } from './storage/store';
import type { Settings } from './domain/types';
import { guardStore, type StoreProblem } from './storage/guard';
import type { AuthApi, SessionUser } from './storage/authApi';
import { ConflictError, OfflineError, SignInError } from './storage/errors';
import { clearCache } from './storage/cache';
import { SignIn, ChangePassword } from './screens/SignIn';
import { Setup } from './screens/Setup';

export type { AuthApi, SessionUser } from './storage/authApi';

const LAST_USER = 'bp-last-user';
const remember = (u: SessionUser | null) => {
  try {
    if (u) localStorage.setItem(LAST_USER, JSON.stringify(u));
    else localStorage.removeItem(LAST_USER);
  } catch { /* private mode: offline start just won't work */ }
};
const remembered = (): SessionUser | null => {
  try { return JSON.parse(localStorage.getItem(LAST_USER) ?? 'null'); } catch { return null; }
};

type Stage = { kind: 'loading' } | { kind: 'setup' } | { kind: 'signin'; username?: string } | { kind: 'password'; user: SessionUser }
  | { kind: 'app'; user: SessionUser; store: Store; settings: Settings } | { kind: 'error'; message: string };

/**
 * The server-mode shell: first-run setup, sign-in, the first-password change, then the app with a server Store.
 * A session that ends mid-work shows sign-in over the same screen; afterwards the user is back where they were.
 */
export function ServerRoot({ auth, makeStore }: { auth: AuthApi; makeStore: (u: SessionUser) => Promise<Store> }) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [signedOut, setSignedOut] = useState(false);
  const [problem, setProblem] = useState<StoreProblem | null>(null);

  const open = async (user: SessionUser) => {
    remember(user);
    if (user.mustChangePassword) return setStage({ kind: 'password', user });
    const raw = await makeStore(user);
    const store = guardStore(raw, (e) => {
      if (e instanceof SignInError) setSignedOut(true);
      else setProblem(e);
    });
    setStage({ kind: 'app', user, store, settings: await raw.getSettings() });
  };

  useEffect(() => {
    (async () => {
      try {
        if (await auth.setupNeeded()) return setStage({ kind: 'setup' });
        await open(await auth.me());
      } catch (e) {
        if (e instanceof SignInError) return setStage({ kind: 'signin', username: remembered()?.username });
        // The server can't be reached: open the last user's offline copy (read-only), if this device has one.
        const last = remembered();
        if (e instanceof OfflineError && last) return open(last);
        setStage({ kind: 'error', message: e instanceof OfflineError ? e.message : 'Something went wrong on the server' });
      }
    })();
  }, []);

  const signOut = async () => {
    if (stage.kind !== 'app') return;
    await auth.signOut().catch(() => undefined);
    await clearCache(stage.user.id);
    remember(null);
    setStage({ kind: 'signin' });
  };
  const toast = useMemo(() => problem && (
    <div class="errors app-problem" role="alert">
      {problem.message}{' '}
      {problem instanceof ConflictError && <button onClick={() => location.reload()}>Reload</button>}{' '}
      <button onClick={() => setProblem(null)}>Dismiss</button>
    </div>
  ), [problem]);

  switch (stage.kind) {
    case 'loading': return <p class="muted" style="margin:40px">Loading…</p>;
    case 'error': return <div class="panel" style="max-width:460px;margin:60px auto"><h2>Can't open the app</h2><p>{stage.message}</p></div>;
    case 'setup': return <Setup auth={auth} onDone={open} />;
    case 'signin': return <SignIn auth={auth} username={stage.username} onSignedIn={open} />;
    case 'password': return <ChangePassword auth={auth} onDone={open} />;
    case 'app':
      return (
        <>
          {signedOut && (
            <div class="signin-overlay">
              <SignIn auth={auth} username={stage.user.username} onSignedIn={(u) => {
                setSignedOut(false);
                if (u.id !== stage.user.id) open(u);
              }} />
            </div>
          )}
          {toast}
          <App key={stage.user.id} db={stage.store} initialSettings={stage.settings} user={stage.user} auth={auth} onSignOut={signOut} />
        </>
      );
  }
}
