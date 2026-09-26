import type { DriveStatus } from '../domain/types';
import { formatDateVn, todayIso } from '../domain/format';

const pad = (n: number) => String(n).padStart(2, '0');
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDateVn(todayIso(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One Drive status (saved / not saved / uploading) with Retry, for a bill's PDF or Word file or a contract's .docx. */
export function DriveStatusText({ status, uploading, configured, onSave, saved, notSaved }: {
  status: DriveStatus | undefined; uploading: boolean; configured: boolean; onSave: () => void;
  saved: (when: string) => string; notSaved: (error: string) => string;
}) {
  const expired = status?.error === 'Google access expired';
  if (uploading) return <span class="muted">Uploading to Google Drive…</span>;
  if (configured && status?.error) {
    return <span style="color:var(--danger)">{notSaved(status.error)} · <button class="btn ghost" onClick={onSave}>{expired ? 'Reconnect' : 'Retry'}</button></span>;
  }
  if (status?.savedAt && !status.error) {
    return <span class="muted">{saved(formatDateTime(status.savedAt))}{status.link && <> · <a href={status.link} target="_blank" rel="noopener">Open in Drive</a></>}</span>;
  }
  return null;
}
