import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import type { ActivityItem } from '../storage/authApi';
import { formatDateTime } from '../ui/DriveStatusLine';

const LABEL: Record<string, string> = {
  setup: 'Set up the server', signin: 'Signed in', signout: 'Signed out', 'signin-failed': 'Failed sign-in', locked: 'Account locked',
  'user-created': 'User created', 'user-changed': 'User changed', 'user-disabled': 'User disabled', 'password-reset': 'Password reset',
  'password-changed': 'Changed own password', delete: 'Deleted', import: 'Imported data', restore: 'Restored a backup',
  'backup-download': 'Downloaded a backup', 'drive-connect': 'Connected Google Drive', 'drive-disconnect': 'Disconnected Google Drive',
};

/** Admin only: who did what, newest first. */
export function Activity() {
  const { auth } = useApp();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(true);
  useEffect(() => { auth!.listActivity().then((i) => { setItems(i); setMore(i.length === 200); }); }, []);
  if (!items) return <p class="muted">Loading…</p>;
  const loadMore = async () => {
    const next = await auth!.listActivity(items[items.length - 1]?.at);
    setItems([...items, ...next]);
    setMore(next.length === 200);
  };
  return (
    <div>
      <div class="page-head"><h2>Activity</h2></div>
      <div class="table-scroll"><table class="list">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
        <tbody>
          {items.map((a, i) => (
            <tr key={i}>
              <td style="white-space:nowrap">{formatDateTime(a.at)}</td>
              <td>{a.user ?? '—'}</td>
              <td>{LABEL[a.action] ?? a.action}</td>
              <td class="muted">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {more && <button class="btn ghost" onClick={loadMore}>Older…</button>}
    </div>
  );
}
