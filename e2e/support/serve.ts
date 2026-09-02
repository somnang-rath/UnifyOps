import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { provisionDatabase, superuserConnection } from '../../src/server/db/provision';
import { E2E_DATABASE, EMAIL_LOG_FILE } from './constants';

/**
 * The web server Playwright drives.
 *
 * It provisions its own Postgres before starting Next, for the same reason the
 * tenancy suite does: from slice 3 on, the flows §15 asks to be tested in a
 * browser are flows through a database, and an end-to-end suite that stubs one
 * out is testing the stub.
 *
 * The roles, grants and migrations come from `src/server/db/provision.ts`,
 * shared with the tenancy harness — so the browser drives the same isolation
 * the RLS suite asserts, rather than a permissive copy of it.
 *
 * Postgres comes from `TENANCY_SUPERUSER_URL` if it is set, and from
 * Testcontainers otherwise. Same rule, same variable, one thing to know.
 */

const port = process.env.E2E_PORT ?? '3100';

async function main(): Promise<void> {
  const { url } = await superuserConnection();
  const urls = await provisionDatabase({ superuserUrl: url, database: E2E_DATABASE });

  // Truncated between runs so a leftover account cannot make a signup test fail
  // with "email taken" — the same reasoning as dropping the database.
  const logPath = resolve(EMAIL_LOG_FILE);
  mkdirSync(dirname(logPath), { recursive: true });
  rmSync(logPath, { force: true });

  const child = spawn('pnpm', ['exec', 'next', 'start', '-p', port], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: urls.app,
      DATABASE_URL_OWNER: urls.owner,
      DATABASE_URL_OPERATOR: urls.operator,
      DATABASE_URL_IDENTITY: urls.identity,
      // No RESEND_API_KEY: the logging transport is deliberately what runs, so
      // the invitation link lands in a file the specs can read.
      EMAIL_LOG_FILE: logPath,
    },
  });

  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error: unknown) => {
  console.error('Could not start the end-to-end server.');
  console.error(error);
  process.exit(1);
});
