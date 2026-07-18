#!/usr/bin/env node
/**
 * PreToolUse guardrail. Deterministic — no model involved.
 * Denies shell commands and file writes that are destructive or out of bounds for this repo.
 * Contract: stdin = hook JSON, stdout = { hookSpecificOutput: { permissionDecision } }.
 */
'use strict';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

const DANGEROUS_COMMANDS = [
  [/\brm\s+(-\w*\s+)*-\w*[rf]\w*\s+(\/|~|[A-Za-z]:[\\/])\s*($|\s)/i, 'recursive delete of a filesystem root'],
  [/\bdropDatabase\s*\(/i, 'dropping a MongoDB database'],
  [/\bdb\.dropDatabase\b/i, 'dropping a MongoDB database'],
  [/\bgit\s+push\b[^|;&]*--force(?!-with-lease)/i, 'force push'],
  [/\bgit\s+reset\s+--hard\b[^|;&]*\borigin\//i, 'hard reset onto a remote ref'],
  [/\bdocker\s+compose\s+down\b[^|;&]*(-v|--volumes)/i, 'destroying compose volumes (wipes Mongo/Redis data)'],
  [/\bmongo(sh)?\b[^|;&]*--eval[^|;&]*\bdrop\b/i, 'a mongo drop via --eval'],
];

/** Dev data lives on localhost only — see .claude/rules/project.md. */
const FOREIGN_MONGO = /mongodb(\+srv)?:\/\/(?!(localhost|127\.0\.0\.1|mongo)[:/])/i;

const PROTECTED_WRITES = [
  [/(^|[\\/])\.env(\.|$)/i, '.env files hold real secrets — edit them yourself'],
  [/(^|[\\/])node_modules[\\/]/i, 'node_modules is generated'],
  [/(^|[\\/])pnpm-lock\.yaml$/i, 'the lockfile is generated — use pnpm to change it'],
  [/(^|[\\/])(dist|\.next|tsconfig\.tsbuildinfo)([\\/]|$)/i, 'build output is generated'],
];

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // never break the session on a parse failure
  }

  const tool = input.tool_name;
  const args = input.tool_input || {};

  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(args.command || '');
    for (const [pattern, what] of DANGEROUS_COMMANDS) {
      if (pattern.test(cmd)) deny(`Blocked by prism guard: ${what}. Ask the user to run this themselves.`);
    }
    if (FOREIGN_MONGO.test(cmd)) {
      deny('Blocked by prism guard: this points at a non-local MongoDB. Dev work uses mongodb://localhost:27017/prism only.');
    }
    if (/\bpnpm\s+(run\s+)?seed\b/i.test(cmd)) {
      deny('Blocked by prism guard: `pnpm seed` wipes the dev database. Confirm with the user first, then run it yourself.');
    }
  }

  if (WRITE_TOOLS.has(tool)) {
    const file = String(args.file_path || args.notebook_path || '');
    for (const [pattern, why] of PROTECTED_WRITES) {
      if (pattern.test(file)) deny(`Blocked by prism guard: ${why} (${file}).`);
    }
  }

  process.exit(0);
});
