/**
 * Writes ./.env with fresh random secrets for the server (npm run make-env). Never overwrites an existing .env.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env already exists — left unchanged.');
} else {
  writeFileSync('.env', [
    '# Server settings (keep this file private; never commit it).',
    `SESSION_SECRET=${randomBytes(32).toString('base64')}`,
    `TOKEN_KEY=${randomBytes(32).toString('base64')}`,
    'PUBLIC_URL=http://localhost:8080',
    'DATA_DIR=./data',
    'PORT=8080',
    '# Google "Web application" client for the company Drive (see docs/server-setup.md):',
    'GOOGLE_CLIENT_ID=',
    'GOOGLE_CLIENT_SECRET=',
    '',
  ].join('\n'), { mode: 0o600 });
  console.log('Wrote .env with new secrets.');
}
