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
 *
 * From slice 9 it starts a **second** process beside Next: the job worker, which
 * is §8's other process type. Notifications and the digest are not something the
 * web process does — an outbox row is written by a request and turned into an
 * inbox entry and an email by a worker — so a suite with no worker running would
 * be asserting that half of §7.8 exists. Same image, same environment, different
 * entry point, exactly as it is deployed.
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

  const env = {
    ...process.env,
    DATABASE_URL: urls.app,
    DATABASE_URL_OWNER: urls.owner,
    DATABASE_URL_OPERATOR: urls.operator,
    DATABASE_URL_IDENTITY: urls.identity,
    /**
     * Blanked, not merely left unset.
     *
     * The logging transport is deliberately what runs, so the invitation link
     * — and, from slice 9, every notification and digest — lands in a file the
     * specs can read. `emailConfig()` picks Resend the moment `RESEND_API_KEY`
     * and `EMAIL_FROM` are both truthy, and *not setting* them here does not
     * make them absent: `next start` loads `.env` itself, so a developer who
     * has put a real key in theirs gets the Resend transport in the child, no
     * file, and every mail-dependent spec failing with "Mailbox held:
     * (nothing)" — while CI, which has no `.env`, stays green.
     *
     * An empty string is what fixes it rather than `delete`, because
     * `@next/env` only fills a key whose `typeof` is `undefined`. Present and
     * empty is present.
     */
    RESEND_API_KEY: '',
    EMAIL_FROM: '',
    EMAIL_LOG_FILE: logPath,
    /**
     * The worker builds absolute deep links from this, and unlike the Next
     * process it has no build step to inline it — a worker without it throws
     * while rendering the email, *after* the inbox row is written, which reads
     * as "the notification works but the mail never arrives".
     */
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? `http://127.0.0.1:${port}`,
  };

  const child = spawn('pnpm', ['exec', 'next', 'start', '-p', port], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  /**
   * The worker holds the operator credential to enumerate undelivered outbox
   * rows, and the app credential to write each notification in its recipient's
   * own scope. Both are in `env` above; nothing here is a test-only shortcut.
   */
  const worker = spawn(
    'pnpm',
    // `--conditions=react-server`, like `pnpm db:seed` and `pnpm jobs`: the job
    // modules carry `import 'server-only'`, which throws under a plain Node
    // resolution and resolves to nothing under this one.
    ['exec', 'tsx', '--conditions=react-server', 'src/server/jobs/worker.ts'],
    {
      stdio: 'inherit',
      shell: true,
      env,
    },
  );

  const stopWorker = () => {
    if (!worker.killed) worker.kill();
  };

  process.on('exit', stopWorker);
  process.on('SIGINT', stopWorker);
  process.on('SIGTERM', stopWorker);

  child.on('exit', (code) => {
    stopWorker();
    process.exit(code ?? 0);
  });
}

main().catch((error: unknown) => {
  console.error('Could not start the end-to-end server.');
  console.error(error);
  process.exit(1);
});
