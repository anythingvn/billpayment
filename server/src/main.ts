import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './env';
import { SqliteStore } from './sqliteStore';
import { buildApp } from './app';

// Settings come from the environment, or from ./.env when present (npm run make-env writes one).
if (existsSync('.env')) process.loadEnvFile('.env');

let env;
try {
  env = loadEnv(process.env);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
mkdirSync(env.dataDir, { recursive: true });
const store = new SqliteStore(join(env.dataDir, 'billpayment.db'));
const app = await buildApp({ store, env, logger: true });
await app.listen({ host: '0.0.0.0', port: env.port });
