#!/usr/bin/env node
/**
 * PostToolUse nudge. Reminds the model of repo rules the edited path implicates,
 * so conventions survive long sessions. Cheap: path matching only, no builds.
 */
'use strict';

const RULES = [
  [
    /apps[\\/]api[\\/]src[\\/]modules[\\/][^\\/]+[\\/](schemas|dto)[\\/]/i,
    'New/changed schema or DTO in apps/api: the module class must be registered in apps/api/src/app.module.ts, and `pnpm --filter api build` must pass before this counts as done.',
  ],
  [
    /apps[\\/](admin|space)[\\/].*\.(tsx?|css)$/i,
    'Editing apps/admin or apps/space: anything also needed by apps/web belongs in packages/ (types, ui, services, editor) — copy-pasting across the three frontends is the top pitfall of this conversion.',
  ],
  [
    /apps[\\/]api[\\/]src[\\/]modules[\\/]public[\\/]/i,
    'The public module is unauthenticated: keep routes throttled and strip private fields (emails, member lists, internal notes) from every response.',
  ],
  [
    /apps[\\/]api[\\/]src[\\/]modules[\\/]instance[\\/]/i,
    'Instance-level endpoints must be behind @InstanceAdminGuard. Workspace roles never grant instance access.',
  ],
  [
    /apps[\\/]live[\\/]/i,
    'apps/live must not re-implement authorization: verify the JWT locally, then ask apps/api internal endpoints for the access decision (see docs/adr/0001).',
  ],
  [
    /packages[\\/]ui[\\/]/i,
    'Changing packages/ui: it is consumed by web, admin, and space — check all three still build, and keep the component API generic.',
  ],
];

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const file = String(
    input?.tool_response?.filePath || input?.tool_input?.file_path || ''
  );
  if (!file) process.exit(0);

  const hits = RULES.filter(([p]) => p.test(file)).map(([, msg]) => msg);
  if (!hits.length) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: hits.join('\n'),
      },
    })
  );
});
