import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app';
import { navigate } from '../router';
import { listBills, listCustomers, templateFor } from '../storage/db';
import type { Bill, Customer, DriveStatus } from '../domain/types';
import { buildStatement, statementFileBase, statementPresets } from '../domain/statement';
import { defaultBankAccount } from '../domain/settings';
import { todayIso } from '../domain/format';
import { StatementPage, statementQrPayload } from '../ui/StatementPage';
import { useQrDataUrl } from '../ui/useQrDataUrl';
import { printBill } from '../ui/print';
import { DriveStatusText } from '../ui/DriveStatusLine';
import { downloadBlob } from '../docs/download';
import { buildStatementDocx } from '../docs/documents';
import { driveConfigured, isUploadingFile, onDriveChange, prepareDrive, saveStatementToDrive, statementDriveKey, statementDriveStatus } from '../drive/service';

const DATE_ERROR = 'The start date must be on or before the end date';

/** A customer's statement of account: period, preview, PDF, Word and Google Drive. */
export function StatementScreen({ id }: { id: string }) {
  const { db, settings } = useApp();
  const today = todayIso();
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);
  const [bills, setBills] = useState<Bill[]>([]);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [hasTemplate, setHasTemplate] = useState(false);
  const [status, setStatus] = useState<DriveStatus | undefined>(undefined);
  const [docxStatus, setDocxStatus] = useState<DriveStatus | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Re-render on Drive start/finish even when the stored status hasn't changed (the first save).
  const [, tick] = useState(0);

  useEffect(() => {
    (async () => {
      // Load everything first, so the statement never shows with the bills still missing.
      const [customers, all, template] = await Promise.all([listCustomers(db), listBills(db), templateFor(db, 'statement')]);
      setBills(all.filter((b) => b.customerId === id));
      setHasTemplate(!!template);
      setCustomer(customers.find((c) => c.id === id) ?? null);
    })();
  }, [id]);
  useEffect(() => { prepareDrive(db, settings); }, [settings.googleClientId]);

  const valid = from !== '' && to !== '' && from <= to;
  const statement = useMemo(() => (customer && valid ? buildStatement(bills, customer, from, to, today) : null), [customer, bills, from, to, today, valid]);
  const base = statement ? statementFileBase(statement.customer.name, from, to) : '';
  const pdfName = base ? `${base}.pdf` : '';
  const docxName = base ? `${base}.docx` : '';
  const qr = useQrDataUrl(statement ? statementQrPayload(statement, settings) : null);

  // The Drive status of this period's PDF and Word files; reloads when an upload starts or finishes.
  useEffect(() => {
    if (!pdfName) {
      setStatus(undefined);
      setDocxStatus(undefined);
      return;
    }
    const load = () => {
      statementDriveStatus(db, id, pdfName).then(setStatus);
      statementDriveStatus(db, id, docxName).then(setDocxStatus);
    };
    load();
    return onDriveChange((changed) => {
      if (changed !== statementDriveKey(id, pdfName) && changed !== statementDriveKey(id, docxName)) return;
      tick((n) => n + 1);
      load();
    });
  }, [pdfName]);

  if (customer === undefined) return <p class="muted">Loading…</p>;
  if (customer === null) return <p>Customer not found. <a href="#/customers">Back to customers</a></p>;

  const presets = statementPresets(today, bills);
  const configured = driveConfigured(settings);
  const pdfUploading = pdfName !== '' && isUploadingFile(statementDriveKey(id, pdfName), 'statement');
  const docxUploading = hasTemplate && docxName !== '' && isUploadingFile(statementDriveKey(id, docxName), 'statement');
  const uploading = pdfUploading || docxUploading;
  const word = async () => {
    if (!statement) return;
    setError('');
    setBusy(true);
    try {
      const doc = await buildStatementDocx(db, statement, settings);
      if (doc) downloadBlob(doc.blob, doc.fileName);
      else setError('Add a template in Settings → Documents');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => { if (statement) saveStatementToDrive(db, statement, settings).catch(() => undefined); };

  return (
    <div>
      <div class="page-head no-print">
        <h2>
          <button class="btn ghost" style="margin-right:10px" onClick={() => navigate({ name: 'customers' })}>← Customers</button>
          Statement · {customer.name}
        </h2>
      </div>
      <div class="panel no-print">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          {presets.map((p) => (
            <button key={p.key} class={from === p.from && to === p.to ? 'btn' : 'btn ghost'} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>
          ))}
        </div>
        <div class="grid2">
          <label class="field">From<input type="date" value={from} onInput={(e) => setFrom(e.currentTarget.value)} /></label>
          <label class="field">To<input type="date" value={to} onInput={(e) => setTo(e.currentTarget.value)} /></label>
        </div>
        {!valid && <p class="errors" style="margin-top:10px">{DATE_ERROR}</p>}
        {!defaultBankAccount(settings) && <p class="muted">Add a bank account in Settings to show the VietQR</p>}
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <button class="btn" disabled={!valid} onClick={() => printBill(base)}>Export PDF</button>
          {hasTemplate
            ? <button class="btn ghost" disabled={!valid || busy} onClick={word}>Word (.docx)</button>
            : <a href="#/settings">Add a template in Settings → Documents</a>}
          {configured
            ? <button class="btn ghost" disabled={!valid || uploading} onClick={save}>{status?.fileId ? 'Update in Google Drive' : 'Save to Google Drive'}</button>
            : <a href="#/settings" class="muted">Connect Google Drive in Settings</a>}
          {/* With a Statement template, PDF and Word are shown separately so a failed Word upload is visible. */}
          {valid && (hasTemplate
            ? <>
              <DriveStatusText status={status} uploading={pdfUploading} configured={configured} onSave={save}
                saved={(when) => `PDF: saved to Drive ${when}`} notSaved={(e) => `PDF: not saved: ${e}`} />
              <DriveStatusText status={docxStatus} uploading={docxUploading} configured={configured} onSave={save}
                saved={(when) => `Word: saved to Drive ${when}`} notSaved={(e) => `Word: not saved: ${e}`} />
            </>
            : <DriveStatusText status={status} uploading={pdfUploading} configured={configured} onSave={save}
              saved={(when) => `Saved to Drive ${when}`} notSaved={(e) => `Not saved: ${e}`} />)}
        </div>
        {error && <p class="errors">{error}</p>}
      </div>
      {statement && <div class="preview-wrap"><StatementPage statement={statement} settings={settings} qrDataUrl={qr} /></div>}
    </div>
  );
}
