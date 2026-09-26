import type { Bill, DriveStatus, Settings } from '../domain/types';
import type { AppDb } from '../storage/db';
import { getBill, getContract, getMeta, setMeta } from '../storage/db';
import { createDriveApi, DriveError, type DriveApi } from './api';
import { createDriveAuth, loadGis } from './auth';
import { uploadFile } from './upload';
import { billDrivePath, safeName } from './paths';
import type { BuiltDoc, DocxTarget } from '../docs/documents';

import type { Report } from '../domain/report';
import { reportFileName } from '../domain/report';
import { XLSX_MIME } from '../report/excel';
import type { Statement } from '../domain/statement';
import { statementFileBase } from '../domain/statement';

export type { DocxTarget } from '../docs/documents';
/** What a Drive job saves: a bill or contract record, or a report (id = its file name; status kept in meta). */
export type DriveTarget = DocxTarget | { type: 'report'; id: string } | { type: 'statement'; id: string };
/** Where a report's or statement's Drive status is kept (by file name). */
const META_PREFIX = { report: 'report-drive:', statement: 'statement-drive:' } as const;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Everything the service talks to; replaced by fakes in tests. */
export interface DriveDeps {
  auth: { getToken(o?: { refresh?: boolean }): Promise<string>; revoke(): Promise<void> };
  api: DriveApi;
  makePdf(bill: Bill, s: Settings): Promise<Blob>;
  /** The Word document for a bill or contract; null when there is no template. */
  makeDocx(target: DocxTarget, s: Settings, db: AppDb): Promise<BuiltDoc | null>;
  /** The accountant report as an .xlsx file. */
  makeXlsx(report: Report): Promise<Blob>;
  /** A customer statement as PDF, and as Word (null when there is no Statement template). */
  makeStatementPdf(st: Statement, s: Settings): Promise<Blob>;
  makeStatementDocx(st: Statement, s: Settings, db: AppDb): Promise<BuiltDoc | null>;
  now(): string;
  online(): boolean;
}

const EMPTY: DriveStatus = { fileId: null, link: null, savedAt: null, error: null };
const NOT_FINAL = 'Only sent or paid bills are saved to Drive';

let testDeps: DriveDeps | null = null;
let live: { clientId: string; deps: DriveDeps } | null = null;
/** Whether this device connected before (so Google can skip the consent screen). Loaded by prepareDrive. */
let knownConnected = false;

export function setDriveDepsForTest(deps: DriveDeps | null): void {
  testDeps = deps;
  live = null;
}

export const driveConfigured = (s: Settings): boolean => s.googleClientId.trim() !== '';

function depsFor(s: Settings): DriveDeps {
  if (testDeps) return testDeps;
  const clientId = s.googleClientId.trim();
  if (live?.clientId !== clientId) {
    const auth = createDriveAuth(clientId, { gis: loadGis, wasConnected: knownConnected });
    live = {
      clientId,
      deps: {
        auth,
        api: createDriveApi(auth.getToken),
        makePdf: async (bill, settings) => (await import('../ui/billPdf')).makeBillPdf(bill, settings),
        makeDocx: async (target, settings, db) => (await import('../docs/documents')).buildDocx(db, target, settings),
        makeXlsx: async (report) => (await import('../report/excel')).reportToXlsx(report),
        makeStatementPdf: async (st, settings) => (await import('../ui/billPdf')).makeStatementPdf(st, settings),
        makeStatementDocx: async (st, settings, db) => (await import('../docs/documents')).buildStatementDocx(db, st, settings),
        now: () => new Date().toISOString(),
        online: () => navigator.onLine,
      },
    };
  }
  return live.deps;
}

/**
 * Call when a screen that can upload opens: loads Google's sign-in script ahead of time,
 * so the permission window can open straight from a click.
 */
export async function prepareDrive(db: AppDb, s: Settings): Promise<void> {
  if (!driveConfigured(s) || testDeps) return;
  knownConnected = (await driveConnection(db)) !== null;
  loadGis().catch(() => undefined);
}

// ---- upload status for screens ----
const uploading = new Set<string>();
const listeners = new Set<(billId: string) => void>();
const notify = (billId: string) => listeners.forEach((fn) => fn(billId));

/** True while the PDF or the Word document of this bill/contract is uploading. */
export const isUploading = (id: string): boolean => uploading.has(`pdf:${id}`) || uploading.has(`docx:${id}`);
export const isUploadingFile = (id: string, file: 'pdf' | 'docx' | 'report' | 'statement'): boolean => uploading.has(`${file}:${id}`);

export function onDriveChange(fn: (billId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `wasConnected`: this device connected before, so an auth failure means access expired. */
function errorText(e: unknown, wasConnected = false): string {
  if (e instanceof DriveError) {
    if (e.kind === 'auth') return wasConnected ? 'Google access expired' : 'Not connected to Google Drive';
    if (e.kind === 'offline') return 'Offline';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

type StatusField = 'drive' | 'driveDocx';

/** Keeps the previous fileId/link/savedAt and records the error on the bill or contract. */
async function recordStatus(db: AppDb, target: DriveTarget, field: StatusField, status: DriveStatus | ((prev: DriveStatus) => DriveStatus)) {
  const make = (prev: DriveStatus | undefined) => (typeof status === 'function' ? status(prev ?? EMPTY) : status);
  if (target.type === 'report' || target.type === 'statement') {
    const key = `${META_PREFIX[target.type]}${target.id}`;
    const next = make(await getMeta<DriveStatus>(db, key));
    await setMeta(db, key, next);
    return next;
  }
  // Read and write in one transaction: the PDF and Word jobs of one bill update the same record.
  if (target.type === 'bill') {
    const tx = db.transaction('bills', 'readwrite');
    const bill = await tx.store.get(target.id);
    const next = make(bill?.[field]);
    if (bill) await tx.store.put({ ...bill, [field]: next });
    await tx.done;
    return next;
  }
  const tx = db.transaction('contracts', 'readwrite');
  const c = await tx.store.get(target.id);
  const next = make(c?.drive);
  if (c) await tx.store.put({ ...c, drive: next });
  await tx.done;
  return next;
}

const recordError = (db: AppDb, target: DriveTarget, field: StatusField, error: string) =>
  recordStatus(db, target, field, (prev) => ({ ...prev, error }));

// ---- saving ----
const inFlight = new Map<string, Promise<DriveStatus>>();
let queue: Promise<unknown> = Promise.resolve();

interface Job {
  /** Unique per record and file, e.g. "pdf:<bill id>" or "docx:<contract id>". */
  key: string;
  target: DriveTarget;
  field: StatusField;
  /** Checks the record may be uploaded; returns an error to report without touching Drive. */
  refuse(): Promise<string | null>;
  /** Builds the file; null = nothing to upload (reported as `missing`). */
  build(deps: DriveDeps): Promise<{ doc: BuiltDoc; mimeType: string } | null>;
  buildError: string;
  missing: string;
  existingFileId(): Promise<string | null>;
}

/**
 * Runs one Drive upload with the shared rules: the token is requested synchronously (so Google's window may open
 * from the click), offline fails fast, double clicks join, uploads run one at a time. Never throws.
 */
function runJob(db: AppDb, s: Settings, job: Job): Promise<DriveStatus> {
  const running = inFlight.get(job.key);
  if (running) return running;
  const deps = depsFor(s);
  const online = deps.online();
  const token = online ? deps.auth.getToken() : null;
  token?.catch(() => undefined);

  uploading.add(job.key);
  notify(job.target.id);

  const p = (async (): Promise<DriveStatus> => {
    const refused = await job.refuse();
    if (refused) return { ...EMPTY, error: refused };
    if (!online || !token) return recordError(db, job.target, job.field, 'Offline');
    try {
      await token;
    } catch (e) {
      return recordError(db, job.target, job.field, errorText(e, (await driveConnection(db)) !== null));
    }
    // Uploading without pressing Connect still counts as connected, so Google won't ask for consent every session.
    if (!knownConnected || (await driveConnection(db)) === null) {
      await setMeta(db, 'driveConnected', { email: null, at: deps.now() });
      knownConnected = true;
    }
    let built: { doc: BuiltDoc; mimeType: string } | null;
    try {
      built = await job.build(deps);
    } catch (e) {
      return recordError(db, job.target, job.field, e instanceof Error && e.name === 'DocTemplateError' ? e.message : job.buildError);
    }
    if (!built) return { ...EMPTY, error: job.missing };
    const { doc, mimeType } = built;
    // One upload at a time, so two files for a new customer don't create the same folder twice.
    const run = queue.then(async () => {
      const cache = (await getMeta<Record<string, string>>(db, 'driveFolders')) ?? {};
      const result = await uploadFile(deps.api, {
        folders: doc.folders, fileName: doc.fileName, mimeType, blob: doc.blob, existingFileId: await job.existingFileId(),
      }, cache, deps.now());
      await setMeta(db, 'driveFolders', result.cache);
      return result.status;
    });
    queue = run.catch(() => undefined);
    try {
      return await recordStatus(db, job.target, job.field, await run);
    } catch (e) {
      return recordError(db, job.target, job.field, errorText(e));
    }
  })().finally(() => {
    inFlight.delete(job.key);
    uploading.delete(job.key);
    notify(job.target.id);
  });

  inFlight.set(job.key, p);
  return p;
}

const finalBill = async (db: AppDb, id: string) => {
  const bill = await getBill(db, id);
  return bill && (bill.status === 'sent' || bill.status === 'paid') ? null : NOT_FINAL;
};

/** Uploads a sent/paid bill's PDF to Drive and records the result on the bill (bill.drive). */
export function saveBillToDrive(db: AppDb, billId: string, s: Settings): Promise<DriveStatus> {
  const target: DocxTarget = { type: 'bill', id: billId };
  return runJob(db, s, {
    key: `pdf:${billId}`, target, field: 'drive',
    refuse: () => finalBill(db, billId),
    build: async (deps) => {
      const bill = (await getBill(db, billId))!;
      const blob = await deps.makePdf(bill, s);
      const { folders, fileName } = billDrivePath(bill, s.driveFolderName);
      return { doc: { blob, fileName, folders }, mimeType: 'application/pdf' };
    },
    buildError: 'Could not create the PDF',
    missing: 'Could not create the PDF',
    existingFileId: async () => (await getBill(db, billId))?.drive?.fileId ?? null,
  });
}

/**
 * Uploads the Word document of a sent/paid bill (bill.driveDocx) or an active contract/addendum (contract.drive).
 * With no template, resolves with error "No Word template" and leaves the record untouched.
 */
export function saveDocxToDrive(db: AppDb, target: DocxTarget, s: Settings): Promise<DriveStatus> {
  const isBill = target.type === 'bill';
  return runJob(db, s, {
    key: `docx:${target.id}`, target, field: isBill ? 'driveDocx' : 'drive',
    refuse: async () => {
      if (isBill) return finalBill(db, target.id);
      const c = await getContract(db, target.id);
      return c && c.status === 'active' ? null : 'Only active contracts are saved to Drive';
    },
    build: async (deps) => {
      const doc = await deps.makeDocx(target, s, db);
      return doc ? { doc, mimeType: DOCX_MIME } : null;
    },
    buildError: 'Could not create the Word document',
    missing: 'No Word template',
    existingFileId: async () => (isBill ? (await getBill(db, target.id))?.driveDocx?.fileId : (await getContract(db, target.id))?.drive?.fileId) ?? null,
  });
}

// ---- connection ----
export async function driveConnection(db: AppDb): Promise<{ email: string | null; at: string } | null> {
  return (await getMeta<{ email: string | null; at: string }>(db, 'driveConnected')) ?? null;
}

/** Opens Google's permission window (from a click), then records the connected account on this device. */
export async function connectDrive(db: AppDb, s: Settings): Promise<{ email: string | null }> {
  const deps = depsFor(s);
  // An explicit Connect replaces any Google window still waiting for an answer.
  await deps.auth.getToken({ refresh: true });
  const email = await deps.api.aboutEmail();
  await setMeta(db, 'driveConnected', { email, at: deps.now() });
  knownConnected = true;
  return { email };
}

export async function disconnectDrive(db: AppDb, s: Settings): Promise<void> {
  await depsFor(s).auth.revoke();
  await setMeta(db, 'driveConnected', null);
  knownConnected = false;
  live = null;
}

/** Drive status of a saved report, by file name. */
export const reportDriveStatus = (db: AppDb, fileName: string) => getMeta<DriveStatus>(db, `report-drive:${fileName}`);

/** Saves the report to Phiếu thanh toán / Báo cáo / <year of To>; the same file name updates the same Drive file. */
export function saveReportToDrive(db: AppDb, report: Report, s: Settings): Promise<DriveStatus> {
  const fileName = reportFileName(report.from, report.to);
  const target: DriveTarget = { type: 'report', id: fileName };
  return runJob(db, s, {
    key: `report:${fileName}`, target, field: 'drive',
    refuse: async () => null,
    build: async (deps) => ({
      doc: { blob: await deps.makeXlsx(report), fileName, folders: [safeName(s.driveFolderName), 'Báo cáo', report.to.slice(0, 4)] },
      mimeType: XLSX_MIME,
    }),
    buildError: 'Could not create the Excel file',
    missing: 'Could not create the Excel file',
    existingFileId: async () => (await reportDriveStatus(db, fileName))?.fileId ?? null,
  });
}

/** Drive status of a saved statement file (.pdf or .docx), by file name. */
export const statementDriveStatus = (db: AppDb, fileName: string) => getMeta<DriveStatus>(db, `${META_PREFIX.statement}${fileName}`);

const NO_STATEMENT_TEMPLATE = 'No Word template';

/**
 * Saves a statement to Phiếu thanh toán / Đối chiếu / <year of To> / <customer>: the PDF, then the Word file when a
 * Statement template exists (docx null otherwise). The same file names update the same Drive files.
 */
export async function saveStatementToDrive(db: AppDb, st: Statement, s: Settings): Promise<{ pdf: DriveStatus; docx: DriveStatus | null }> {
  const base = statementFileBase(st.customer.name, st.from, st.to);
  const folders = [safeName(s.driveFolderName), 'Đối chiếu', st.to.slice(0, 4), safeName(st.customer.name)];
  const job = (fileName: string, build: (deps: DriveDeps) => Promise<{ doc: BuiltDoc; mimeType: string } | null>, buildError: string) => runJob(db, s, {
    key: `statement:${fileName}`, target: { type: 'statement', id: fileName }, field: 'drive',
    refuse: async () => null, build, buildError, missing: NO_STATEMENT_TEMPLATE,
    existingFileId: async () => (await statementDriveStatus(db, fileName))?.fileId ?? null,
  });
  // Both are queued now (from the click); the queue uploads them one after the other.
  const pdf = job(`${base}.pdf`, async (deps) => ({ doc: { blob: await deps.makeStatementPdf(st, s), fileName: `${base}.pdf`, folders }, mimeType: 'application/pdf' }),
    'Could not create the PDF');
  const docx = job(`${base}.docx`, async (deps) => {
    const doc = await deps.makeStatementDocx(st, s, db);
    return doc ? { doc, mimeType: DOCX_MIME } : null;
  }, 'Could not create the Word document');
  const [p, d] = await Promise.all([pdf, docx]);
  return { pdf: p, docx: d.error === NO_STATEMENT_TEMPLATE && !d.fileId ? null : d };
}
