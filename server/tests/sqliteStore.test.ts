// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqliteStore';
import { storeContract } from '../../tests/storage/store-contract';

const dir = mkdtempSync(join(tmpdir(), 'bp-sqlite-'));
let n = 0;
storeContract('SqliteStore', async () => new SqliteStore(join(dir, `t${n++}.db`)));
