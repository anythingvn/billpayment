import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { backupFileName, exportAll, lastBackupAt, markBackedUp, parseBackup, restoreAll, type BackupData } from '../storage/backup';

function download(data: BackupData, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function BackupScreen() {
  const { db, reloadSettings } = useApp();
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
    if (!confirm(`Replace ALL current data with this backup (${parsed.summary})?\n\nA backup of your current data will be downloaded first.`)) return;
    try {
      const now = new Date().toISOString();
      download(await exportAll(db, now), backupFileName(now).replace('.json', '-before-restore.json'));
      await restoreAll(db, parsed.data);
      await reloadSettings();
      setMsg(`Restored: ${parsed.summary}.`);
    } catch (e) {
      setErr(`Restore failed, current data was not changed: ${String(e)}`);
    }
  };

  return (
    <div>
      <div class="page-head"><h2>Backup / Restore</h2></div>
      {msg && <p class="panel">{msg}</p>}
      {err && <p class="errors">{err}</p>}
      <div class="panel">
        <h3>Back up</h3>
        <p class="muted">Last backup: {last ? new Date(last).toLocaleString('vi-VN') : 'never'}</p>
        <button class="btn" onClick={backup}>Download backup file</button>
      </div>
      <div class="panel">
        <h3>Restore</h3>
        <p class="muted">Replaces everything in this app with the contents of a backup file.</p>
        <input type="file" accept="application/json,.json" onChange={(e) => { restore(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}
