/**
 * Recovery on the server machine when nobody can sign in (e.g. the only Admin forgot the password):
 *   docker compose exec app node server/dist/resetPassword.js <username>
 * Sets a new password (asked for, not echoed), re-enables the account, ends its sessions, and requires a change
 * at the next sign-in. Logged in the activity log.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Accounts, passwordErrors } from './auth';
import { logActivity } from './activity';
import { SqliteStore } from './sqliteStore';

export async function resetPassword(store: SqliteStore, username: string, password: string, now: Date): Promise<void> {
  const accounts = new Accounts(store);
  const user = accounts.byUsername(username);
  if (!user) throw new Error(`No user named ${username}`);
  const problems = passwordErrors(password);
  if (problems.length) throw new Error(problems[0]);
  await accounts.setPassword(user.id, password, true);
  accounts.update(user.id, { disabled: false });
  accounts.endSessions(user.id);
  store.db.prepare('DELETE FROM signin_failures WHERE username = ?').run(user.username);
  logActivity(store, null, 'password-reset', { username: user.username, by: 'server command' }, now);
}

const ask = (q: string) => new Promise<string>((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
  rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
});

if (process.argv[1]?.endsWith('resetPassword.js')) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node server/dist/resetPassword.js <username>');
    process.exit(1);
  }
  const store = new SqliteStore(join(process.env.DATA_DIR || '/data', 'billpayment.db'));
  const password = await ask(`New password for ${username} (at least 10 characters): `);
  try {
    await resetPassword(store, username, password, new Date());
    console.log(`Done. ${username} must choose a new password at the next sign-in.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    store.close();
  }
}
