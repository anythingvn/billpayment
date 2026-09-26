import type { Bill, DriveStatus, Settings } from '../domain/types';
import type { AppDb } from '../storage/db';
import { getBill, getMeta, putBill, setMeta } from '../storage/db';
import { createDriveApi, DriveError, type DriveApi } from './api';
import { createDriveAuth, loadGis } from './auth';
import { uploadBillPdf } from './upload';

/** Everything the service talks to; replaced by fakes in tests. */
export interface DriveDeps {
  auth: { getToken(o?: { refresh?: boolean }): Promise<string>; revoke(): Promise<void> };
  api: DriveApi;
  makePdf(bill: Bill, s: Settings): Promise<Blob>;
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

export const isUploading = (billId: string): boolean => uploading.has(billId);

export function onDriveChange(fn: (billId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function errorText(e: unknown): string {
  if (e instanceof DriveError) {
    if (e.kind === 'auth') return 'Not connected to Google Drive';
    if (e.kind === 'offline') return 'Offline';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

async function recordError(db: AppDb, billId: string, error: string): Promise<DriveStatus> {
  const bill = await getBill(db, billId);
  const status = { ...(bill?.drive ?? EMPTY), error };
  if (bill) await putBill(db, { ...bill, drive: status });
  return status;
}

// ---- saving ----
const inFlight = new Map<string, Promise<DriveStatus>>();
let queue: Promise<unknown> = Promise.resolve();

/**
 * Uploads a sent/paid bill's PDF to Drive and records the result on the bill.
 * Never throws; the returned status carries any error. The token is requested synchronously
 * (before any await) so Google's permission window may open from the triggering click.
 */
export function saveBillToDrive(db: AppDb, billId: string, s: Settings): Promise<DriveStatus> {
  const running = inFlight.get(billId);
  if (running) return running;
  const deps = depsFor(s);
  const online = deps.online();
  const token = online ? deps.auth.getToken() : null;
  token?.catch(() => undefined);

  uploading.add(billId);
  notify(billId);

  const job = (async (): Promise<DriveStatus> => {
    const bill = await getBill(db, billId);
    if (!bill || (bill.status !== 'sent' && bill.status !== 'paid')) return { ...EMPTY, error: NOT_FINAL };
    if (!online || !token) return recordError(db, billId, 'Offline');
    try {
      await token;
    } catch (e) {
      return recordError(db, billId, errorText(e));
    }
    // Uploading without pressing Connect still counts as connected, so Google won't ask for consent every session.
    if (!knownConnected || (await driveConnection(db)) === null) {
      await setMeta(db, 'driveConnected', { email: null, at: deps.now() });
      knownConnected = true;
    }
    let pdf: Blob;
    try {
      pdf = await deps.makePdf(bill, s);
    } catch {
      return recordError(db, billId, 'Could not create the PDF');
    }
    // One upload at a time, so two bills for a new customer don't create the same folder twice.
    const run = queue.then(async () => {
      const cache = (await getMeta<Record<string, string>>(db, 'driveFolders')) ?? {};
      const result = await uploadBillPdf(deps.api, bill, pdf, s.driveFolderName, cache, deps.now());
      await setMeta(db, 'driveFolders', result.cache);
      return result.status;
    });
    queue = run.catch(() => undefined);
    try {
      const status = await run;
      const fresh = await getBill(db, billId);
      if (fresh) await putBill(db, { ...fresh, drive: status });
      return status;
    } catch (e) {
      return recordError(db, billId, errorText(e));
    }
  })().finally(() => {
    inFlight.delete(billId);
    uploading.delete(billId);
    notify(billId);
  });

  inFlight.set(billId, job);
  return job;
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
