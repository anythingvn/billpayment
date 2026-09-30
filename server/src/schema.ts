import type { DatabaseSync } from 'node:sqlite';

/** Creates the tables (idempotent). Records are JSON documents with a few indexed columns. */
export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      customer_id TEXT, parent_id TEXT, contract_id TEXT, sort_date TEXT,
      created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS records_customer ON records(kind, customer_id);
    CREATE INDEX IF NOT EXISTS records_parent ON records(kind, parent_id);
    CREATE INDEX IF NOT EXISTS records_contract ON records(kind, contract_id);
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY, json TEXT NOT NULL, data BLOB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      role TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
      must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_signin TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_used TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signin_failures (username TEXT NOT NULL COLLATE NOCASE, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL
    );
  `);
}
