#!/usr/bin/env node
/**
 * SessionStart briefing. Parses the roadmap checkboxes out of PLANE-CONVERSION-PLAN.md
 * so every session opens knowing which phase is live, without reading the whole plan.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const planPath = path.join(root, 'PLANE-CONVERSION-PLAN.md');

function phases(md) {
  const out = [];
  const re = /^###\s+(Phase\s+\d+[^\n]*)$/gm;
  let m;
  const marks = [];
  while ((m = re.exec(md))) marks.push({ title: m[1].trim(), start: m.index });
  marks.forEach((mark, i) => {
    // A phase ends at the next phase, or at the next top-level section — otherwise the
    // last phase swallows every checkbox in the rest of the document.
    let end = i + 1 < marks.length ? marks[i + 1].start : md.length;
    const nextSection = md.slice(mark.start).search(/\n## /);
    if (nextSection !== -1 && mark.start + nextSection < end) end = mark.start + nextSection;
    const body = md.slice(mark.start, end);
    const done = (body.match(/^- \[x\]/gim) || []).length;
    const todo = (body.match(/^- \[ \]/gim) || []).length;
    out.push({ title: mark.title.replace(/\s*[—-]\s*$/, ''), done, todo });
  });
  return out;
}

let context = 'Prism → Plane conversion. Plan: PLANE-CONVERSION-PLAN.md · team: docs/AI-TEAM.md · ADRs: docs/adr/.';

try {
  const list = phases(fs.readFileSync(planPath, 'utf8'));
  if (list.length) {
    const lines = list.map((p) => {
      const state = p.todo === 0 ? 'complete' : `${p.done} done / ${p.todo} open`;
      return `  ${p.title} — ${state}`;
    });
    const open = list.find((p) => p.todo > 0);
    context +=
      '\n\nRoadmap:\n' +
      lines.join('\n') +
      (open ? `\n\nCurrent phase: ${open.title}.` : '\n\nAll roadmap phases are checked off.');
  }
} catch {
  // plan missing — fall back to the one-liner
}

context +=
  '\n\nPorts: api 4000 (/api/v1) · web 3000 · admin 3001 (/god-mode) · space 3002 (/spaces) · live 3100.' +
  '\nDev DB: mongodb://localhost:27017/prism only. `pnpm seed` is destructive.' +
  '\nFor multi-layer work, route through the prism-orchestrator agent first.';

process.stdout.write(
  JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  })
);
