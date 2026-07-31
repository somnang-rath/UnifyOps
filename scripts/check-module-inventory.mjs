#!/usr/bin/env node
/**
 * Fails when `apps/api/src/modules/` contains a module that does not exist.
 *
 * Twice now a directory under `modules/` has held nothing but empty `dto/` and
 * `schemas/` folders while the plan docs recorded the feature as built —
 * `cycles`/`modules` (found in Phase 10) and `estimates` (found 2026-07-31).
 * An empty directory is invisible to `nest build`, to `eslint "src/**\/*.ts"`,
 * and to git, so nothing in the toolchain contradicted the docs. This script is
 * the contradiction.
 *
 * Two failures:
 *   1. a directory under `modules/` with no `.ts` file anywhere inside it
 *      — a scaffold that was never written;
 *   2. a `*.module.ts` that no other file under `src/` imports — a module class
 *      that exists but is wired to nothing, so its controllers never mount.
 *
 * (2) deliberately looks at every source file rather than only `app.module.ts`:
 * shared leaf modules like `projects/access/project-access.module.ts` are
 * imported by feature modules, never by the root.
 *
 * Run: `node scripts/check-module-inventory.mjs` (part of `pnpm --filter api lint`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const apiSrc = join(repoRoot, 'apps/api/src');
const modulesDir = join(apiSrc, 'modules');

/** Every file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');

const problems = [];

// ── 1. Empty module directories ────────────────────────────────────────
const moduleDirs = readdirSync(modulesDir).filter((d) =>
  statSync(join(modulesDir, d)).isDirectory(),
);

for (const dir of moduleDirs) {
  const files = walk(join(modulesDir, dir));
  if (!files.some((f) => f.endsWith('.ts'))) {
    problems.push(
      `${rel(join(modulesDir, dir))}/ contains no .ts file — an empty scaffold. ` +
        `Write it or delete it, and fix whichever doc claims it exists.`,
    );
  }
}

// ── 2. Unreferenced module classes ─────────────────────────────────────
const allSources = walk(apiSrc).filter((f) => f.endsWith('.ts'));
const moduleFiles = allSources.filter((f) => f.endsWith('.module.ts'));

for (const moduleFile of moduleFiles) {
  if (basename(moduleFile) === 'app.module.ts') continue; // the root: nothing imports it
  const stem = basename(moduleFile, '.ts'); // e.g. "project-access.module"
  const importedSomewhere = allSources.some(
    (f) => f !== moduleFile && readFileSync(f, 'utf8').includes(`/${stem}'`),
  );
  if (!importedSomewhere) {
    problems.push(
      `${rel(moduleFile)} is imported by nothing — its controllers never mount.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\nModule inventory: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`Module inventory: ${moduleDirs.length} modules, all wired.`);
