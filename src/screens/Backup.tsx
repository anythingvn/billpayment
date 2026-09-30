import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { useWrite } from '../ui/useOnline';
import { backupFileName, exportAll, lastBackupAt, markBackedUp, parseBackup, restoreAll, type BackupData } from '../storage/backup';
import { isHandled } from '../storage/errors';
import type { AuthApi, DriveBackupStatus } from '../storage/authApi';
import { formatDateTime } from '../ui/DriveStatusLine';

function download(data: BackupData, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function BackupScreen() {
  const { db, reloadSettings, user, auth } = useApp();
  const w = useWrite();
  const onServer = !!auth;
  const [last, setLast] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { lastBackupAt(db).then(setLast); }, []);

  const backup = async () => {
    const now = new Date().toISOString();
    download(await exportAll(db, now), backupFileName(now));
    await markBackedUp(db, now);
    setLast(now);
    setMsg('Backup file downloaded. Keep it somewhere safe, e.g. Google Drive.');
  };

  const restore = async (file: File | undefined) => {
    setMsg(''); setErr('');
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) { setErr(parsed.error); return; }
    if (onServer) {
      // On the server a restore replaces everyone's data: it must be typed out.
      if (prompt(`Replace ALL data on the server with this backup (${parsed.summary})?\nUsers and the Google Drive connection are kept.\nA backup of the current data is downloaded first.\n\nType RESTORE to confirm.`) !== 'RESTORE') return;
    } else if (!confirm(`Replace ALL current data with this backup (${parsed.summary})?\n\nA backup of your current data will be downloaded first.`)) return;
    try {
      const now = new Date().toISOString();
      download(await exportAll(db, now), backupFileName(now).replace('.json', '-before-restore.json'));
      await restoreAll(db, parsed.data);
      await reloadSettings();
      setMsg(`Restored: ${parsed.summary}.`);
    } catch (e) {
      if (isHandled(e)) return;
      setErr(`Restore failed, current data was not changed: ${String(e)}`);
    }
  };

  if (onServer && user?.role !== 'admin') {
    return (
      <div>
        <div class="page-head"><h2>Backup / Restore</h2></div>
        <p class="panel">The server backs up all data every night. Backup files and restores are handled by the Admin.</p>
      </div>
    );
  }

  return (
    <div>
      <div class="page-head"><h2>Backup / Restore</h2></div>
      {onServer && <p class="muted">The server also keeps a copy every night (the last 14 days).</p>}
      {msg && <p class="panel">{msg}</p>}
      {err && <p class="errors">{err}</p>}
      <div class="panel">
        <h3>Back up</h3>
        <p class="muted">Last backup: {last ? new Date(last).toLocaleString('vi-VN') : 'never'}</p>
        <button class="btn" {...w()} onClick={backup}>Download backup file</button>
      </div>
      {onServer && auth && <DriveBackupPanel auth={auth} />}
      <div class="panel">
        <h3>Restore</h3>
        <p class="muted">Replaces everything in this app with the contents of a backup file.</p>
        <input type="file" accept="application/json,.json" {...w()} onChange={(e) => { restore(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}

/** Admin, server: the nightly copy to the company Google Drive, and a button to make one now. */
function DriveBackupPanel({ auth }: { auth: AuthApi }) {
  const w = useWrite();
  const [st, setSt] = useState<DriveBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { auth.driveBackup().then(setSt, () => undefined); }, []);
  const now = async () => {
    setBusy(true);
    try { setSt(await auth.driveBackupNow()); } catch (e) { if (!isHandled(e)) setSt((p) => ({ at: new Date().toISOString(), error: String((e as Error).message ?? e), days: p?.days ?? [] })); }
    setBusy(false);
  };
  const n = st?.days.length ?? 0;
  return (
    <div class="panel">
      <h3>Google Drive</h3>
      <p class="muted" style="margin-top:0">Every night the server also copies the backup to the company Google Drive, folder “Sao lưu” (the last 14 nights).
        The database copy in “Máy chủ – không chia sẻ” holds password hashes: never share that folder.</p>
      {st && (st.error
        ? <p class="errors">Google Drive: the last try {st.at ? formatDateTime(st.at) : ''} failed — {st.error}</p>
        : st.at ? <p>Google Drive: last copy {formatDateTime(st.at)} · {n} {n === 1 ? 'night' : 'nights'} kept</p>
          : <p class="muted">Google Drive: no copy yet</p>)}
      <button class="btn ghost" {...w(busy)} onClick={now}>{busy ? 'Backing up…' : 'Back up to Google Drive now'}</button>
    </div>
  );
}
