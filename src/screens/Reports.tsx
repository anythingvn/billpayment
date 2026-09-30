import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app';
import { listBills } from '../storage/db';
import type { Bill, DriveStatus } from '../domain/types';
import { buildReport, reportFileName, reportPresets, vatLabel } from '../domain/report';
import { formatVnd, todayIso } from '../domain/format';
import { reportToXlsx } from '../report/excel';
import { downloadBlob } from '../docs/download';
import { driveConfigured, isUploadingFile, onDriveChange, prepareDrive, reportDriveStatus, saveReportToDrive } from '../drive/service';
import { DriveStatusText } from '../ui/DriveStatusLine';
import { useWrite } from '../ui/useOnline';
import { isHandled } from '../storage/errors';

const DATE_ERROR = 'The start date must be on or before the end date';

export function Reports() {
  const { db, settings } = useApp();
  const w = useWrite();
  const today = todayIso();
  const presets = useMemo(() => reportPresets(today), [today]);
  const last = presets.find((p) => p.key === 'lastMonth')!;
  const [from, setFrom] = useState(last.from);
  const [to, setTo] = useState(last.to);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [status, setStatus] = useState<DriveStatus | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Re-render on Drive start/finish even when the stored status hasn't changed (the first save of a period).
  const [, tick] = useState(0);

  const valid = from !== '' && to !== '' && from <= to;
  const fileName = valid ? reportFileName(from, to) : '';
  const report = useMemo(() => (bills && valid ? buildReport(bills, from, to, settings, today) : null), [bills, from, to, settings, today, valid]);

  useEffect(() => { listBills(db).then(setBills); }, []);
  useEffect(() => { prepareDrive(db, settings); }, [settings.googleClientId]);
  // The Drive status of this period's file; reloads when its upload starts or finishes.
  useEffect(() => {
    if (!fileName) return setStatus(undefined);
    const load = () => { reportDriveStatus(db, fileName).then(setStatus); };
    load();
    return onDriveChange((id) => {
      if (id !== fileName) return;
      tick((n) => n + 1);
      load();
    });
  }, [fileName]);

  if (!bills) return <p class="muted">Loading…</p>;

  const download = async () => {
    if (!report) return;
    setError('');
    setBusy(true);
    try {
      downloadBlob(await reportToXlsx(report), fileName);
    } catch (e) {
      if (isHandled(e)) return;
      setError(`The Excel file could not be created: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const save = () => { if (report) saveReportToDrive(db, report, settings).catch(() => undefined); };
  const configured = driveConfigured(settings);
  const uploading = fileName !== '' && isUploadingFile(fileName, 'report');

  return (
    <div>
      <div class="page-head"><h2>Reports</h2></div>
      <div class="panel">
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
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <button class="btn" disabled={!valid || busy} onClick={download}>Download Excel</button>
          {configured
            ? <button class="btn ghost" {...w(!valid || uploading)} onClick={save}>{status?.fileId ? 'Update in Google Drive' : 'Save to Google Drive'}</button>
            : <a href="#/settings" class="muted">Connect Google Drive in Settings</a>}
          {valid && <DriveStatusText status={status} uploading={uploading} configured={configured} onSave={save}
            saved={(when) => `Saved to Drive ${when}`} notSaved={(e) => `Not saved: ${e}`} />}
        </div>
        {fileName && <p class="muted" style="margin-bottom:0">{fileName}</p>}
        {error && <p class="errors">{error}</p>}
      </div>

      {report && (
        <>
          <div class="grid2" style="margin-bottom:16px">
            <Kpi label="Received" amount={report.received} />
            <Kpi label="Billed" amount={report.billed.total} count={report.billed.count} />
            <Kpi label="Owed at end" amount={report.owed.total} count={report.owed.count} />
          </div>
          <div class="panel"><h3 style="margin-top:0">VAT on bills paid in the period</h3>
            <div class="table-scroll"><table class="list">
              <thead><tr><th>VAT rate</th><th class="r">Bills</th><th class="r">Before VAT</th><th class="r">VAT</th><th class="r">Total</th></tr></thead>
              <tbody>
                {report.vat.map((v) => (
                  <tr key={String(v.rate)}>
                    <td>{vatLabel(v.rate)}</td><td class="r">{v.count}</td><td class="r">{formatVnd(v.beforeVat)}</td>
                    <td class="r">{formatVnd(v.vat)}</td><td class="r">{formatVnd(v.total)}</td>
                  </tr>
                ))}
                {report.vat.length === 0 && <tr><td colSpan={5} class="muted">No bills paid in this period.</td></tr>}
                <tr style="font-weight:700">
                  <td>Total</td><td class="r">{report.vatTotal.count}</td><td class="r">{formatVnd(report.vatTotal.beforeVat)}</td>
                  <td class="r">{formatVnd(report.vatTotal.vat)}</td><td class="r">{formatVnd(report.vatTotal.total)}</td>
                </tr>
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, amount, count }: { label: string; amount: number; count?: number }) {
  return (
    <div class="panel" style="margin:0">
      <span class="muted">{label}</span>{count !== undefined && <span class="muted"> · {count} {count === 1 ? 'bill' : 'bills'}</span>}
      <div style="font-size:20px;font-weight:700">{formatVnd(amount)} ₫</div>
    </div>
  );
}
