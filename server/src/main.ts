import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './env';
import { SqliteStore } from './sqliteStore';
import { buildApp, newSetupCode } from './app';
import { startNightlyBackup } from './nightly';

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
const setupCode = newSetupCode();
const app = await buildApp({ store, env, logger: true, setupCode });
if ((store.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0) {
  // Printed only while the server has no users: whoever sets it up must be able to read this log.
  console.log(`\n  First-time setup: open ${env.publicUrl} and enter this setup code: ${setupCode}\n`);
}
startNightlyBackup(store, env.dataDir, (msg) => app.log.error(msg));
await app.listen({ host: '0.0.0.0', port: env.port });
