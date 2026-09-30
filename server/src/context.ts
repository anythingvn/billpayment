import type { Accounts } from './auth';
import type { Env } from './env';
import type { SqliteStore } from './sqliteStore';

/** What every route needs. */
export interface Ctx { store: SqliteStore; accounts: Accounts; env: Env; now: () => Date }
