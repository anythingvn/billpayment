import { DatabaseSync } from 'node:sqlite';
import type { Bill, Contract, Customer, DocKind, DocTemplate, DriveStatus, Service, Settings } from '../../src/domain/types';
import { normalizeSettings } from '../../src/domain/settings';
import type { Store } from '../../src/storage/store';
import { base64ToBytes, bytesToBase64, type BackupData } from '../../src/storage/backup';
import { migrate } from './schema';

type Kind = 'customers' | 'services' | 'bills' | 'contracts' | 'settings';
/** Who is writing, and (optionally) the version the writer started from. */
export interface WriteOpts { actor?: { id: string; displayName: string }; expectVersion?: number; now?: string }
/** A write started from an older version than the stored one. */
export class VersionConflict extends Error {
  constructor() { super('conflict'); this.name = 'VersionConflict'; }
}

const REPORT_DRIVE = 'report-drive:';
const STATEMENT_DRIVE = 'statement-drive:';
/** Server facts that a restore keeps: last backup time, the company Drive connection and its folder cache. */
export const KEEP_META = ['lastBackupAt', 'driveConnected', 'driveFolders', 'drive-token'];

interface Row { json: string; version: number; created_by: string | null; updated_by: string | null }

/** The Store in a SQLite file (node:sqlite), used by the server. */
export class SqliteStore implements Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(this.db);
  }

  close(): void { this.db.close(); }

  /** Runs fn in one write transaction (BEGIN IMMEDIATE), rolling back if it throws. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private names = new Map<string, string>();
  /** Display name for a user id (for createdBy/updatedBy). */
  private nameOf(id: string | null): string | undefined {
    if (!id) return undefined;
    if (!this.names.has(id)) {
      const r = this.db.prepare('SELECT display_name FROM users WHERE id = ?').get(id) as { display_name: string } | undefined;
      if (!r) return undefined;
      this.names.set(id, r.display_name);
    }
    return this.names.get(id);
  }
  /** Call after a user's display name changes. */
  forgetNames(): void { this.names.clear(); }

  private toRecord<T>(r: Row): T {
    const rec = JSON.parse(r.json) as T & { version?: number; createdBy?: string; updatedBy?: string };
    rec.version = r.version;
    const createdBy = this.nameOf(r.created_by);
    const updatedBy = this.nameOf(r.updated_by);
    if (createdBy) rec.createdBy = createdBy;
    if (updatedBy) rec.updatedBy = updatedBy;
    return rec;
  }

  private list<T>(kind: Kind): T[] {
    return (this.db.prepare('SELECT json, version, created_by, updated_by FROM records WHERE kind = ?').all(kind) as unknown as Row[])
      .map((r) => this.toRecord<T>(r));
  }

  private get<T>(kind: Kind, id: string): T | undefined {
    const r = this.db.prepare('SELECT json, version, created_by, updated_by FROM records WHERE kind = ? AND id = ?').get(kind, id) as unknown as Row | undefined;
    return r ? this.toRecord<T>(r) : undefined;
  }

  /** Inserts or updates a record; with `expectVersion`, a different stored version throws VersionConflict. */
  putRecord<T extends { id?: string }>(kind: Kind, rec: T, opts: WriteOpts = {}): T {
    const id = kind === 'settings' ? 'settings' : String(rec.id);
    const now = opts.now ?? new Date().toISOString();
    const actor = opts.actor?.id ?? null;
    const { version: _v, createdBy: _c, updatedBy: _u, ...body } = rec as T & { version?: number; createdBy?: string; updatedBy?: string };
    const cols = {
      customer_id: (body as { customerId?: string }).customerId ?? null,
      parent_id: (body as { parentId?: string | null }).parentId ?? null,
      contract_id: (body as { contractRef?: { contractId: string } }).contractRef?.contractId ?? null,
      sort_date: (body as { billDate?: string }).billDate ?? null,
    };
    return this.transaction(() => {
      const prev = this.db.prepare('SELECT version FROM records WHERE kind = ? AND id = ?').get(kind, id) as { version: number } | undefined;
      if (opts.expectVersion !== undefined && (prev?.version ?? 0) !== opts.expectVersion) throw new VersionConflict();
      if (prev) {
        this.db.prepare(`UPDATE records SET json = ?, version = version + 1, customer_id = ?, parent_id = ?, contract_id = ?, sort_date = ?,
          updated_at = ?, updated_by = ? WHERE kind = ? AND id = ?`)
          .run(JSON.stringify(body), cols.customer_id, cols.parent_id, cols.contract_id, cols.sort_date, now, actor, kind, id);
      } else {
        this.db.prepare(`INSERT INTO records (kind, id, json, version, customer_id, parent_id, contract_id, sort_date, created_at, created_by, updated_at, updated_by)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(kind, id, JSON.stringify(body), cols.customer_id, cols.parent_id, cols.contract_id, cols.sort_date, now, actor, now, actor);
      }
      return this.get<T>(kind, id)!;
    });
  }

  private deleteRecord(kind: Kind, id: string): void {
    this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, id);
  }

  async listCustomers() { return this.list<Customer>('customers'); }
  async putCustomer(c: Customer) { return this.putRecord('customers', c); }

  async deleteOrArchiveCustomer(id: string): Promise<'deleted' | 'archived'> {
    return this.transaction(() => {
      const used = (this.db.prepare("SELECT 1 FROM records WHERE kind IN ('bills', 'contracts') AND customer_id = ? LIMIT 1").get(id)) !== undefined;
      if (used) {
        const c = this.get<Customer>('customers', id);
        if (c) this.db.prepare('UPDATE records SET json = ?, version = version + 1 WHERE kind = ? AND id = ?')
          .run(JSON.stringify({ ...stripTracked(c), archived: true }), 'customers', id);
      } else {
        this.deleteRecord('customers', id);
      }
      return used ? 'archived' : 'deleted';
    });
  }

  async listServices() { return this.list<Service>('services'); }
  async putService(s: Service) { return this.putRecord('services', s); }

  async listBills(): Promise<Bill[]> {
    return this.list<Bill>('bills').sort((a, b) => b.billDate.localeCompare(a.billDate) || b.number.localeCompare(a.number));
  }
  async getBill(id: string) { return this.get<Bill>('bills', id); }
  async putBill(b: Bill) { return this.putRecord('bills', b); }

  async listContracts() { return this.list<Contract>('contracts'); }
  async getContract(id: string) { return this.get<Contract>('contracts', id); }
  async putContract(c: Contract) { return this.putRecord('contracts', c); }

  async deleteContract(id: string): Promise<'deleted' | 'refused'> {
    return this.transaction(() => {
      const hasAddenda = this.db.prepare("SELECT 1 FROM records WHERE kind = 'contracts' AND parent_id = ? LIMIT 1").get(id) !== undefined;
      const hasBills = this.db.prepare("SELECT 1 FROM records WHERE kind = 'bills' AND contract_id = ? LIMIT 1").get(id) !== undefined;
      if (!hasAddenda && !hasBills) this.deleteRecord('contracts', id);
      return hasAddenda || hasBills ? 'refused' : 'deleted';
    });
  }

  private templateRows(): DocTemplate[] {
    return (this.db.prepare('SELECT json, data, version, created_by, updated_by FROM templates').all() as unknown as (Row & { data: Uint8Array })[])
      .map((r) => ({ ...this.toRecord<DocTemplate>(r), data: toArrayBuffer(r.data) }));
  }
  async listTemplates() { return this.templateRows(); }

  /** Saves a template; a default contract template clears the other contract templates' default. */
  putTemplateSync(t: DocTemplate, opts: WriteOpts = {}): void {
    const now = opts.now ?? new Date().toISOString();
    const actor = opts.actor?.id ?? null;
    const { data, version: _v, createdBy: _c, updatedBy: _u, ...meta } = t;
    this.transaction(() => {
      const prev = this.db.prepare('SELECT version FROM templates WHERE id = ?').get(t.id) as { version: number } | undefined;
      if (opts.expectVersion !== undefined && (prev?.version ?? 0) !== opts.expectVersion) throw new VersionConflict();
      if (t.kind === 'contract' && t.isDefault) {
        for (const other of this.templateRows()) {
          if (other.kind === 'contract' && other.id !== t.id && other.isDefault) {
            const { data: _d, version: _ov, createdBy: _oc, updatedBy: _ou, ...o } = other;
            this.db.prepare('UPDATE templates SET json = ?, version = version + 1 WHERE id = ?').run(JSON.stringify({ ...o, isDefault: false }), other.id);
          }
        }
      }
      const bytes = new Uint8Array(data);
      if (prev) {
        this.db.prepare('UPDATE templates SET json = ?, data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?')
          .run(JSON.stringify(meta), bytes, now, actor, t.id);
      } else {
        this.db.prepare('INSERT INTO templates (id, json, data, version, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
          .run(t.id, JSON.stringify(meta), bytes, now, actor, now, actor);
      }
    });
  }
  async putTemplate(t: DocTemplate) { this.putTemplateSync(t); }

  async removeTemplate(id: string): Promise<{ contractsReset: number }> {
    return this.transaction(() => {
      const removed = this.templateRows().find((t) => t.id === id);
      this.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
      if (removed?.kind === 'contract' && removed.isDefault) {
        const oldest = this.templateRows().filter((t) => t.kind === 'contract').sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))[0];
        if (oldest) {
          const { data: _d, version: _v, createdBy: _c, updatedBy: _u, ...o } = oldest;
          this.db.prepare('UPDATE templates SET json = ?, version = version + 1 WHERE id = ?').run(JSON.stringify({ ...o, isDefault: true }), oldest.id);
        }
      }
      let contractsReset = 0;
      for (const c of this.list<Contract>('contracts')) {
        if (c.templateId === id) {
          this.db.prepare("UPDATE records SET json = ?, version = version + 1 WHERE kind = 'contracts' AND id = ?")
            .run(JSON.stringify({ ...stripTracked(c), templateId: null }), c.id);
          contractsReset++;
        }
      }
      return { contractsReset };
    });
  }

  async templateFor(kind: DocKind, templateId?: string | null): Promise<DocTemplate | null> {
    const all = this.templateRows().filter((t) => t.kind === kind).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    if (kind !== 'contract') return all[0] ?? null;
    return all.find((t) => t.id === templateId) ?? all.find((t) => t.isDefault) ?? all[0] ?? null;
  }

  async getSettings(): Promise<Settings> {
    const s = this.get<Settings & { id?: string }>('settings', 'settings');
    const normal = normalizeSettings(s ? (stripTracked(s) as unknown as Record<string, unknown>) : undefined);
    return s ? { ...normal, version: s.version, createdBy: s.createdBy, updatedBy: s.updatedBy } : normal;
  }
  async putSettings(s: Settings) { this.putRecord('settings', s as Settings & { id?: string }); }

  getMetaSync<T>(key: string): T | undefined {
    const r = this.db.prepare('SELECT json FROM meta WHERE key = ?').get(key) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as T) : undefined;
  }
  setMetaSync(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO meta (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(value));
  }
  async getMeta<T>(key: string) { return this.getMetaSync<T>(key); }
  async setMeta(key: string, value: unknown) { this.setMetaSync(key, value); }

  async nextCounter(key: string): Promise<number> {
    return this.transaction(() => {
      const next = (this.getMetaSync<number>(key) ?? 0) + 1;
      this.setMetaSync(key, next);
      return next;
    });
  }

  async updateDriveStatus(target: { type: 'bill' | 'contract'; id: string }, field: 'drive' | 'driveDocx', make: (prev: DriveStatus | undefined) => DriveStatus) {
    const kind: Kind = target.type === 'bill' ? 'bills' : 'contracts';
    const key = target.type === 'bill' ? field : 'drive';
    return this.transaction(() => {
      const rec = this.get<Record<string, unknown>>(kind, target.id);
      const next = make(rec?.[key] as DriveStatus | undefined);
      // Drive status is written only by the server's uploads — not a user's edit, so the version stays (no false
      // "someone else changed this" for whoever has the record open).
      if (rec) this.db.prepare('UPDATE records SET json = ? WHERE kind = ? AND id = ?')
        .run(JSON.stringify({ ...stripTracked(rec), [key]: next }), kind, target.id);
      return next;
    });
  }

  async exportAll(nowIso: string): Promise<BackupData> {
    const counters: Record<string, number> = {};
    const reportDrive: Record<string, DriveStatus> = {};
    const statementDrive: Record<string, DriveStatus> = {};
    for (const { key, json } of this.db.prepare('SELECT key, json FROM meta').all() as { key: string; json: string }[]) {
      if (/^(contract-)?counter-/.test(key)) counters[key] = JSON.parse(json);
      if (key.startsWith(REPORT_DRIVE)) reportDrive[key.slice(REPORT_DRIVE.length)] = JSON.parse(json);
      if (key.startsWith(STATEMENT_DRIVE)) statementDrive[key.slice(STATEMENT_DRIVE.length)] = JSON.parse(json);
    }
    return {
      app: 'payment-bills',
      schemaVersion: 1,
      exportedAt: nowIso,
      customers: this.list<Customer>('customers').map(stripTracked),
      services: this.list<Service>('services').map(stripTracked),
      bills: this.list<Bill>('bills').map(stripTracked),
      contracts: this.list<Contract>('contracts').map(stripTracked),
      templates: this.templateRows().map(({ data, ...t }) => ({ ...stripTracked(t), dataBase64: bytesToBase64(data) })),
      settings: stripTracked(await this.getSettings()),
      counters,
      reportDrive,
      statementDrive,
    };
  }

  async restoreAll(data: BackupData, opts: WriteOpts = {}): Promise<void> {
    const now = opts.now ?? new Date().toISOString();
    const actor = opts.actor?.id ?? null;
    this.transaction(() => {
      const keep = KEEP_META.map((k) => [k, this.getMetaSync<unknown>(k)] as const);
      this.db.exec('DELETE FROM records; DELETE FROM templates; DELETE FROM meta;');
      const insert = this.db.prepare(`INSERT INTO records (kind, id, json, version, customer_id, parent_id, contract_id, sort_date, created_at, created_by, updated_at, updated_by)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const add = (kind: Kind, rec: Record<string, unknown>) => insert.run(kind, kind === 'settings' ? 'settings' : String(rec.id), JSON.stringify(stripTracked(rec)),
        (rec.customerId as string) ?? null, (rec.parentId as string) ?? null, (rec.contractRef as { contractId?: string } | undefined)?.contractId ?? null,
        (rec.billDate as string) ?? null, now, actor, now, actor);
      for (const c of data.customers) add('customers', c as unknown as Record<string, unknown>);
      for (const s of data.services) add('services', s as unknown as Record<string, unknown>);
      for (const b of data.bills) add('bills', b as unknown as Record<string, unknown>);
      for (const c of data.contracts) add('contracts', c as unknown as Record<string, unknown>);
      add('settings', data.settings as unknown as Record<string, unknown>);
      for (const { dataBase64, ...t } of data.templates) {
        this.db.prepare('INSERT INTO templates (id, json, data, version, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
          .run(t.id, JSON.stringify(stripTracked(t)), base64ToBytes(dataBase64), now, actor, now, actor);
      }
      for (const [k, v] of Object.entries(data.counters)) this.setMetaSync(k, v);
      for (const [name, status] of Object.entries(data.reportDrive)) this.setMetaSync(`${REPORT_DRIVE}${name}`, status);
      for (const [name, status] of Object.entries(data.statementDrive)) this.setMetaSync(`${STATEMENT_DRIVE}${name}`, status);
      for (const [k, v] of keep) if (v !== undefined) this.setMetaSync(k, v);
    });
  }
}

/** Removes the server-only fields before storing or exporting a record. */
export function stripTracked<T extends object>(x: T): T {
  const { version: _v, createdBy: _c, updatedBy: _u, ...rest } = x as T & { version?: number; createdBy?: string; updatedBy?: string };
  return rest as T;
}

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
