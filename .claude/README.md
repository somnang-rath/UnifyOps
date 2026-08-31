# .claude — the design agent kit

Five layers, of which this directory adds three. Everything here encodes decisions already made in
`PLAN.en.md` §11–§13 and `src/app/globals.css`; none of it invents design rules.

| Layer | Where | What it does |
| --- | --- | --- |
| 1 · Memory | `CLAUDE.md` (repo root) | Always loaded. Architecture rules, bilingual invariants, the token layering |
| 2 · Knowledge | `.claude/skills/` | Loaded on demand when the task matches the skill's description |
| 3 · Guardrail | `.claude/hooks/` | Deterministic. Runs on every write, no judgment involved |
| 4 · Delegation | `.claude/agents/` | Own context window, returns findings only |
| 5 · Distribution | — | Not built. Add a plugin manifest here if these ever ship to other repos |

## Layer 2 — skills

| Skill | Fires when |
| --- | --- |
| `design-tokens` | Picking a colour, adding a Tailwind class, building a dark-mode variant, adding a token, checking contrast |
| `khmer-ui` | Adding a string, a font stack, a date or number format, truncating text, building a search input |
| `ui-component` | Building anything in `src/components/` — a primitive, a view, an item card, an empty state |

`ui-component` carries two references loaded only when needed: `component-specs.md` (the settled §12 sizes,
variants, and behaviours) and `five-states.md` (loading · empty · success · error · edge).

Skills are matched by their `description` frontmatter, so the description says *when to use it*, not what it
contains. A skill nobody's task matches never loads.

## Layer 3 — the hook

`check-design-tokens.sh` runs after every `Write` and `Edit` and greps the written file for five things a
human reviewer reliably misses:

- literal hex outside `globals.css`
- layer-1 ramp utilities (`bg-sky-400`, `text-ink-600`) used from a component
- Tailwind default palette and absolutes (`bg-white`, `text-gray-500`) — no dark-mode counterpart exists
- `outline: none` — focus rings are global
- `.slice()` / `.substring()` on what may be user-visible text — breaks Khmer grapheme clusters

Exit 2 reports back and asks for a fix; it does not block the write. `globals.css` is exempt, because layers
1 and 2 are exactly where hex belongs. The slicing check is the only heuristic one and will occasionally fire
on an array — say so and move on.

Wired in `.claude/settings.json` (checked in, applies to everyone). Personal overrides go in
`.claude/settings.local.json`, which is not tracked.

## Layer 4 — the subagent

`design-reviewer` audits UI against the token layering, contrast, the five states, the accessibility
baseline, bilingual rendering, and spec drift. Read-only — it reports, it does not edit. Runs in its own
context window, so a full sweep of `src/components/` does not consume the main conversation.

## The division of labour

The hook catches what a regex can prove. The skills carry what a regex cannot express — *why* Navy is the
text blue, what an empty state owes the user, which of the three empties applies. The subagent applies both
across more files than fit in one context. Together they cover roughly what a design review would, minus the
part that needs actual eyes on the rendered page.

Nothing here builds features. `PLAN.md` still governs: nothing is built until you say so.
