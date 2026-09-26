import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { getBill, putBill } from '../storage/db';
import type { Bill, BillStatus, Settings } from '../domain/types';
import type { AppDb } from '../storage/db';
import { driveConfigured, isUploading, onDriveChange, prepareDrive, saveBillToDrive } from '../drive/service';
import { applyStatus, canTransition } from '../domain/status';
import { draftFromBill } from '../domain/draft';
import { formatDateVn, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { StatusBadge } from './Home';

const ACTIONS: { to: BillStatus; label: string; confirm?: string }[] = [
  { to: 'sent', label: 'Mark as sent' },
  { to: 'paid', label: 'Mark as paid' },
  { to: 'cancelled', label: 'Cancel bill', confirm: 'Cancel this bill? Its number will not be reused.' },
];

export function BillView({ id }: { id: string }) {
  const { db, settings } = useApp();
  const [bill, setBill] = useState<Bill | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => { getBill(db, id).then((b) => setBill(b ?? null)); }, [id]);
  // Reload when a Drive upload for this bill starts or finishes.
  useEffect(() => onDriveChange((changed) => {
    if (changed === id) getBill(db, id).then((b) => setBill(b ?? null));
  }), [id]);
  useEffect(() => { prepareDrive(db, settings); }, [settings.googleClientId]);
  const draft = bill ? draftFromBill(bill) : null;
  const qr = useQrDataUrl(draft ? billQrPayload(draft, settings) : null);

  if (bill === undefined) return <p class="muted">Loading…</p>;
  if (bill === null || !draft) return <p>Bill not found. <button class="btn ghost" onClick={() => navigate({ name: 'home' })}>Back to bills</button></p>;

  const change = async (to: BillStatus, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    // Undoing "paid" is labelled clearly so it is not clicked by accident.
    try {
      const next = applyStatus(bill, to, todayIso(), new Date().toISOString());
      await putBill(db, next);
      setBill(next);
    } catch (e) {
      setError(String(e));
    }
  };

  // Drafts are sent from the editor, where the export checks run; here they can only be continued or cancelled.
  const isDraft = bill.status === 'draft';
  const actions = [
    ...ACTIONS.filter((a) => canTransition(bill.status, a.to) && !(bill.status === 'paid' && a.to === 'sent') && !(isDraft && a.to === 'sent')),
    ...(bill.status === 'paid' ? [{ to: 'sent' as BillStatus, label: 'Undo paid', confirm: 'Mark this bill as not paid?' }] : []),
  ];

  return (
    <div>
      <div class="page-head no-print">
        <h2>
          <button class="btn ghost" style="margin-right:10px" onClick={() => navigate({ name: 'home' })}>← Back to bills</button>
          {bill.number} <StatusBadge bill={bill} today={todayIso()} />
        </h2>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          {isDraft && <button class="btn" onClick={() => navigate({ name: 'editBill', id: bill.id })}>Continue in editor</button>}
          {actions.map((a) => <button key={a.label} class={a.to === 'cancelled' ? 'btn danger' : 'btn ghost'} onClick={() => change(a.to, a.confirm)}>{a.label}</button>)}
          <button class="btn ghost" onClick={() => navigate({ name: 'duplicateBill', id: bill.id })}>Duplicate</button>
          {isDraft && <button class="btn ghost" onClick={() => printBill(pdfFileName(bill.number, bill.customer.name, true))}>Download draft PDF</button>}
          {bill.status !== 'cancelled' && !isDraft && <button class="btn" disabled={!qr} onClick={() => printBill(pdfFileName(bill.number, bill.customer.name))}>Export PDF</button>}
        </span>
      </div>
      {error && <p class="errors no-print">{error}</p>}
      {bill.paidDate && <p class="muted no-print">Paid on {formatDateVn(bill.paidDate)}</p>}
      {(bill.status === 'sent' || bill.status === 'paid') && <DriveLine db={db} bill={bill} settings={settings} />}
      {bill.status !== 'draft' && <p class="muted no-print">This bill is locked. Duplicate it to make changes.</p>}
      <div class="preview-wrap"><BillPage bill={draft} settings={settings} qrDataUrl={qr} draftMark={isDraft} /></div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDateVn(todayIso(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Google Drive status and save button for a sent or paid bill. */
function DriveLine({ db, bill, settings }: { db: AppDb; bill: Bill; settings: Settings }) {
  const d = bill.drive;
  const configured = driveConfigured(settings);
  const save = () => { saveBillToDrive(db, bill.id, settings).catch(() => undefined); };
  const uploading = isUploading(bill.id);
  const expired = d?.error === 'Google access expired';
  return (
    <div class="no-print" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      {uploading && <span class="muted">Uploading to Google Drive…</span>}
      {!uploading && configured && d?.error && (
        <span style="color:var(--danger)">Not saved to Drive: {d.error} · <button class="btn ghost" onClick={save}>{expired ? 'Reconnect' : 'Retry'}</button></span>
      )}
      {!uploading && !d?.error && d?.savedAt && (
        <span class="muted">Saved to Drive {formatDateTime(d.savedAt)}{d.link && <> · <a href={d.link} target="_blank" rel="noopener">Open in Drive</a></>}</span>
      )}
      {configured
        ? <button class="btn ghost" disabled={uploading} onClick={save}>{d?.fileId ? 'Update in Google Drive' : 'Save to Google Drive'}</button>
        : <a href="#/settings" class="muted">Connect Google Drive in Settings</a>}
    </div>
  );
}
