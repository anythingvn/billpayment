import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { getBill, putBill, templateFor } from '../storage/db';
import type { Bill, BillStatus, Settings } from '../domain/types';
import type { AppDb } from '../storage/db';
import { driveConfigured, isUploadingFile, onDriveChange, prepareDrive, saveBillToDrive, saveDocxToDrive } from '../drive/service';
import { buildBillDocx } from '../docs/documents';
import { downloadBlob } from '../docs/download';
import { DriveStatusText } from '../ui/DriveStatusLine';
import { applyStatus, canTransition } from '../domain/status';
import { draftFromBill } from '../domain/draft';
import { formatDateVn, pdfFileName, todayIso } from '../domain/format';
import { BillPage, billQrPayload } from '../ui/BillPage';
import { useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { StatusBadge } from './Home';
import { Authorship } from '../ui/Authorship';
import { useWrite } from '../ui/useOnline';
import { isHandled } from '../storage/errors';

const ACTIONS: { to: BillStatus; label: string; confirm?: string }[] = [
  { to: 'sent', label: 'Mark as sent' },
  { to: 'paid', label: 'Mark as paid' },
  { to: 'cancelled', label: 'Cancel bill', confirm: 'Cancel this bill? Its number will not be reused.' },
];

export function BillView({ id }: { id: string }) {
  const { db, settings } = useApp();
  const w = useWrite();
  const [bill, setBill] = useState<Bill | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [hasTemplate, setHasTemplate] = useState(false);
  const [building, setBuilding] = useState(false);
  useEffect(() => { getBill(db, id).then((b) => setBill(b ?? null)); }, [id]);
  useEffect(() => { templateFor(db, 'bill').then((t) => setHasTemplate(!!t)); }, []);
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
      setBill(await putBill(db, next));
    } catch (e) {
      if (isHandled(e)) return;
      setError(String(e));
    }
  };

  const downloadWord = async () => {
    setError('');
    setBuilding(true);
    try {
      const doc = await buildBillDocx(db, bill, settings);
      if (doc) downloadBlob(doc.blob, doc.fileName);
      else setError('Add a template in Settings → Documents');
    } catch (e) {
      if (isHandled(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
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
          {isDraft && <button class="btn" {...w()} onClick={() => navigate({ name: 'editBill', id: bill.id })}>Continue in editor</button>}
          {actions.map((a) => <button key={a.label} class={a.to === 'cancelled' ? 'btn danger' : 'btn ghost'} {...w()} onClick={() => change(a.to, a.confirm)}>{a.label}</button>)}
          <button class="btn ghost" {...w()} onClick={() => navigate({ name: 'duplicateBill', id: bill.id })}>Duplicate</button>
          {isDraft && <button class="btn ghost" onClick={() => printBill(pdfFileName(bill.number, bill.customer.name, true))}>Download draft PDF</button>}
          {bill.status !== 'cancelled' && (hasTemplate
            ? <button class="btn ghost" disabled={building} onClick={downloadWord}>Word (.docx)</button>
            : <a href="#/settings" style="align-self:center">Add a template in Settings → Documents</a>)}
          {bill.status !== 'cancelled' && !isDraft && <button class="btn" disabled={!qr} onClick={() => printBill(pdfFileName(bill.number, bill.customer.name))}>Export PDF</button>}
        </span>
      </div>
      {error && <p class="errors no-print">{error}</p>}
      <Authorship record={bill} />
      {bill.contractRef && (
        <p class="no-print"><a href={`#/contracts/${encodeURIComponent(bill.contractRef.contractId)}`}>
          Contract {bill.contractRef.parentNumber ?? bill.contractRef.number}{bill.contractRef.parentNumber ? ` · ${bill.contractRef.number}` : ''}
        </a></p>
      )}
      {bill.paidDate && <p class="muted no-print">Paid on {formatDateVn(bill.paidDate)}</p>}
      {(bill.status === 'sent' || bill.status === 'paid') && <DriveLine db={db} bill={bill} settings={settings} withWord={hasTemplate} />}
      {bill.status !== 'draft' && <p class="muted no-print">This bill is locked. Duplicate it to make changes.</p>}
      <div class="preview-wrap"><BillPage bill={draft} settings={settings} qrDataUrl={qr} draftMark={isDraft} /></div>
    </div>
  );
}

/** Google Drive status and save button for a sent or paid bill; with a bill template, PDF and Word are shown separately. */
function DriveLine({ db, bill, settings, withWord }: { db: AppDb; bill: Bill; settings: Settings; withWord: boolean }) {
  const w = useWrite();
  const configured = driveConfigured(settings);
  const savePdf = () => { saveBillToDrive(db, bill.id, settings).catch(() => undefined); };
  const saveWord = () => { saveDocxToDrive(db, { type: 'bill', id: bill.id }, settings).catch(() => undefined); };
  const saveBoth = () => { savePdf(); if (withWord) saveWord(); };
  const pdfUploading = isUploadingFile(bill.id, 'pdf');
  const wordUploading = withWord && isUploadingFile(bill.id, 'docx');
  return (
    <div class="no-print" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      {withWord
        ? <>
          <DriveStatusText status={bill.drive} uploading={pdfUploading} configured={configured} onSave={savePdf}
            saved={(when) => `PDF: saved to Drive ${when}`} notSaved={(e) => `PDF: not saved: ${e}`} />
          <DriveStatusText status={bill.driveDocx} uploading={wordUploading} configured={configured} onSave={saveWord}
            saved={(when) => `Word: saved to Drive ${when}`} notSaved={(e) => `Word: not saved: ${e}`} />
        </>
        : <DriveStatusText status={bill.drive} uploading={pdfUploading} configured={configured} onSave={savePdf}
          saved={(when) => `Saved to Drive ${when}`} notSaved={(e) => `Not saved to Drive: ${e}`} />}
      {configured
        ? <button class="btn ghost" {...w(pdfUploading || wordUploading)} onClick={saveBoth}>{bill.drive?.fileId ? 'Update in Google Drive' : 'Save to Google Drive'}</button>
        : <a href="#/settings" class="muted">Connect Google Drive in Settings</a>}
    </div>
  );
}
