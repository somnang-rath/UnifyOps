#!/usr/bin/env node
/**
 * Runs scripts/bootstrap.sql against a local Postgres, passing the role
 * passwords in from .env so they never appear in the committed SQL, in shell
 * history, or in a process argument list.
 *
 * Four roles, all created here because role creation is a superuser
 * operation: the owner (migrations), the app (runtime, RLS forced), the
 * platform operator (cross-tenant SELECT only, PLAN.en.md §18-12) and the
 * identity role (the pre-tenancy handshake — sign in, sign up, accept an
 * invitation, all of which happen before a workspace is known).
 *
 *   node scripts/db-setup.mjs [--superuser postgres] [--host localhost] [--port 5432]
 *
 * psql prompts for the SUPERUSER password interactively. The four role
 * passwords come from .env.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');

if (!existsSync(envPath)) {
  console.error('No .env found. Copy .env.example to .env first.');
  process.exit(1);
}

const env = readFileSync(envPath, 'utf8');

function passwordFor(key) {
  const line = env.match(new RegExp(`^${key}="([^"]*)"`, 'm'));
  if (!line) throw new Error(`${key} is missing from .env`);
  const pw = line[1].match(/:\/\/[^:]+:([^@]*)@/)?.[1];
  if (!pw) throw new Error(`${key} has no password in its URL`);
  if (pw === 'CHANGEME') {
    throw new Error(
      `${key} still has the placeholder password. Set a real one in .env before running this.`,
    );
  }
  return decodeURIComponent(pw);
}

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const superuser = opt('superuser', 'postgres');
const host = opt('host', 'localhost');
const port = opt('port', '5432');

let ownerPw, appPw, operatorPw, identityPw;
try {
  ownerPw = passwordFor('DATABASE_URL_OWNER');
  appPw = passwordFor('DATABASE_URL');
  operatorPw = passwordFor('DATABASE_URL_OPERATOR');
  identityPw = passwordFor('DATABASE_URL_IDENTITY');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// The Windows installer does not put psql on PATH, so resolve it properly
// rather than assuming — an unhandled ENOENT from spawn is a confusing way to
// learn that.
function findPsql() {
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0) {
    const first = onPath.stdout.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  }
  const guesses = [
    ...[18, 17, 16].map((v) => `C:\\Program Files\\PostgreSQL\\${v}\\bin\\psql.exe`),
    '/usr/bin/psql',
    '/usr/local/bin/psql',
    '/opt/homebrew/bin/psql',
  ];
  return guesses.find((p) => existsSync(p)) ?? null;
}

const psql = findPsql();

if (!psql) {
  console.error('Could not find psql. Add the PostgreSQL bin directory to PATH, e.g.');
  console.error('  C:\\Program Files\\PostgreSQL\\18\\bin');
  process.exit(1);
}

console.log(`Bootstrapping as "${superuser}" on ${host}:${port}.`);
console.log('psql will prompt for that role\'s password.\n');

const child = spawn(
  psql,
  [
    '-U', superuser,
    '-h', host,
    '-p', port,
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `owner_password=${ownerPw}`,
    '-v', `app_password=${appPw}`,
    '-v', `operator_password=${operatorPw}`,
    '-v', `identity_password=${identityPw}`,
    '-f', resolve(root, 'scripts', 'bootstrap.sql'),
  ],
  { stdio: 'inherit' },
);

child.on('error', (err) => {
  console.error(`Could not run psql at ${psql}: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\nDone. Roles and database created; .env already matches.');
  } else {
    console.error(`\npsql exited with ${code}. Nothing was left half-applied — bootstrap.sql`);
    console.error('stops on the first error and every step is idempotent, so fix and re-run.');
  }
  process.exit(code ?? 1);
});
