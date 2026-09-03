# UnifyOps — Product & Technical Plan

**Version 3 · For review · Not approved for build**

*Last updated: 28 August 2026 · Khmer version: [PLAN.km.md](PLAN.km.md)*

---

## 0. How to review this document

Read §2 (user needs) and §17 (review findings) first. Those carry the decisions most likely to be wrong.
Anything marked **✅ DECIDED** is a judgment call made on your behalf that you have since confirmed — the
decision and its reasoning are in §18.

| Process step | Sections |
| --- | --- |
| Prepare the plan | §1 Context · §3 Product definition |
| Define features and user flows | §4 Features · §5 Modern · §6 Customization · §7 Flows |
| Design the architecture | §8 Architecture · §9 Data model · §10 Permissions |
| Design the UX/UI | §11 UX · §12 UI system · §13 Bilingual |
| Review everything | §17 Review findings |
| Fix what is unclear | §18 Open questions |

---

## 1. Context

### The problem

Companies of 20–200 people coordinate work in chat threads, spreadsheets, and memory. The tools meant to fix
this split into two failures: light tools a company outgrows in a year, and heavy tools that need training,
an admin, and configuration before anyone files a first task. Most teams abandon the heavy tool and go back
to chat — the tool asked them to work for it.

### The intent

A multi-company SaaS work platform that is usable without training, bilingual English/Khmer from day one, and
bends to how a company already works rather than the reverse.

> **Plane.so is a process reference only.** We copy its discipline (plan → review → build), not its product.
> Where Plane exposes configuration, UnifyOps ships a good default and hides the configuration until asked.

### Settled decisions

Work management core for v1 · multi-company SaaS from day one · Next.js + Postgres full-stack · English and
Khmer in v1.

> **Note:** The `UnifyCharge_Brand_Assets` folder in this repository belongs to an unrelated EV-charging
> product and is not evidence of what UnifyOps is.

---

## 2. Real user needs

Everything downstream should trace back to something in this section.

### 2.1 Employee — the individual contributor

*Sok, designer at a 40-person agency. Laptop at the office, phone everywhere else.*

| Real problem | What they actually need |
| --- | --- |
| Work arrives in chat and gets buried | One list that is the truth about what is mine |
| Doesn't know what to do next among 14 open things | An ordering already decided, not one they must invent |
| Interrupted for status updates all day | Updating status must be cheaper than answering the question |
| Being blocked has no cheap expression, so they stay silent | One click to say "I'm stuck" that reaches the right person |
| Feels like paperwork done for the manager's benefit | The tool must pay *them* back on day one |

> **⭐ The central insight**
>
> Most work tools are built for the person reading the report, not the person doing the work. The employee
> updates it out of obligation, the data rots, and the report becomes fiction. **If My Work is not genuinely
> useful to the employee on its own, nothing else in this product works.**

**Consequence:** My Work is the landing screen, never a project list. Status change is one click from anywhere
the item appears. Blocked is a first-class concept, not a label someone invents.

### 2.2 Manager — the team lead

*Dara, ops manager, five direct reports across three projects.*

| Real problem | What they actually need |
| --- | --- |
| No honest picture of team load — only who complains loudest | Workload per person, derived from real data |
| Finds out about slips at the deadline | Risk surfaced early: overdue, stale, blocked, unassigned |
| Builds the weekly status report by hand, every week | A status view that already exists and can be sent as-is |
| Can't tell "quiet because busy" from "quiet because stuck" | Staleness and blocked state as visible signals |
| Reassigning work means calling a meeting | Drag a card from one person to another |

**Consequence:** manager views are **derived, never assembled**. A **Needs Attention** surface is a v1
feature, not a nice-to-have: overdue · blocked · unassigned · no due date · untouched for N days.

### 2.3 Company owner — the administrator

*Chantha, founder/COO. Not a project manager. Will configure the tool once and never again.*

| Real problem | What they actually need |
| --- | --- |
| Every tool needs an expert to set up | Working defaults; Settings is optional, not a prerequisite |
| Onboarding a new hire takes an afternoon | Invite → they land in the right teams and projects automatically |
| No view across teams | A cross-project view without building a report |
| The tool's vocabulary doesn't match the company's | Rename states, add the fields they actually track |
| When someone leaves, their work disappears with them | Offboarding that reassigns rather than deletes |

> **The governing rule.** Customization exists so the tool bends to the company — **but a company that never
> opens Settings must still be completely fine.** That is the test every customization feature must pass.

### 2.4 The team, collectively

Duplicated work · unclear ownership · handoffs lost between people · context scattered across chat, email,
and someone's head. The need is **one place where a piece of work carries its own history** — so the answer
to "why did we do it this way" is on the item, not in a chat scroll.

### 2.5 Market-specific needs (Cambodia / SEA)

These are not generic and they change the product:

| # | Need | What it forces |
| --- | --- | --- |
| 1 | Genuinely bilingual teams — Khmer and English mix *within one sentence* | Per-user UI language; content stays as typed; Khmer is never the degraded experience |
| 2 | Chat-first culture — Telegram is where work actually gets discussed | Makes chat integration strategic, not cosmetic (§5) |
| 3 | Phone-heavy usage even among desk staff | Responsive is mandatory in v1 (§17-3) |
| 4 | High turnover, no dedicated tool admin | Zero-training is a market requirement, not a design preference |
| 5 | Cost sensitivity — Western per-seat pricing is a non-starter | A generous light/Guest role; eventual per-active-user pricing |
| 6 | Public holidays arrive in clusters and move with the lunar calendar — Khmer New Year, Pchum Ben, Water Festival | A per-workspace holiday calendar (§6-1), or every "working days" number in the product is wrong during the two weeks a year it matters most |

---

## 3. Product definition

### Goals

1. **Zero-training usability.** Every primary action is discoverable from the screen it belongs to.
2. **Pays back the individual first.** The employee gets value before the manager does.
3. **Honest multi-tenancy.** Company data isolated by the database, not by careful coding.
4. **Bilingual as a property**, not a translation layer.
5. **Bends to the company** without requiring configuration to start.
6. **Additive extensibility.** Phase 2 attaches without a rewrite.

### Non-goals for v1

Realtime collaborative editing · native mobile apps · billing/subscriptions · docs/wiki · time tracking ·
Gantt/timeline · automation rules engine · public API for third parties · SSO/SAML · AI features.

### Design principles

| Principle | In practice |
| --- | --- |
| **Show, don't configure** | A new project is usable immediately with zero setup |
| **Progressive disclosure** | Advanced controls behind a labelled affordance, never in the default path |
| **Derived, not assembled** | If a manager would build it by hand, the product should already have it |
| **Optimistic and reversible** | Actions apply instantly; mistakes are undone, not pre-confirmed |
| **Predictable over clever** | One interaction pattern everywhere; no screen invents its own idiom |
| **Khmer is not second class** | Every flow ships in both languages simultaneously, or not at all |

---

## 4. Feature scope

### Must-have — v1 does not ship without these

| Area | Features |
| --- | --- |
| **Identity** | Email/password + Google OAuth, verification, password reset, sessions |
| **Workspace** | Create, switcher, **bulk invite** by email, accept invite, member list, roles, **member availability flag**, **view-as a member** (§10), remove/offboard |
| **Teams / departments** | Create teams, assign members, projects belong to a team, filter by team |
| **Projects** | Create/edit/archive, lead, members, workspace-visible or private, ID prefix, icon + colour |
| **Work items** | Inline + full create, title, rich description, state, priority, multi-assignee, labels, start/due date, estimate, **blocked flag + reason**, sub-items (depth ≤ 3), human ID `ENG-142` |
| **Custom fields** | Per-project definitions: text, number, select, multi-select, date, user, checkbox. Filterable and groupable |
| **Views** | List (grouped), Board (kanban, drag-drop), Table, Calendar · filter, group, sort, saved views, shareable URL |
| **Needs attention** | Derived surface: overdue · blocked · unassigned · no due date · stale |
| **Cycles** | Date-bounded, add/remove items, active view, progress + burndown |
| **Collaboration** | Comments with @mentions, attachments, per-item activity feed |
| **Notifications** | In-app inbox, read/unread, email for mentions + assignment, **due-date reminder digest**, per-user preferences |
| **Dashboards** | My Work (default landing), team workload by assignee (**availability-aware**), project overview, **printable export** |
| **Settings** | The seven customization areas — see §6 |
| **Navigation** | Command palette `⌘K`, global search, keyboard shortcuts |
| **Bilingual** | Full EN/KH, per-user locale, locale-aware dates/numbers |
| **Responsive** | Every v1 screen usable on a phone browser (§17-3) |
| **Installable** | Web-app manifest, icon set, theme colour — "Add to Home Screen" works on Android and iOS (§17-21) |

### Should-have — v1 if time allows, else immediately after

Bulk edit on multi-select · CSV import of work items · CSV export · item templates · recurring items ·
duplicate item · move item between projects · workspace-level "all work" view · unread activity badges ·
onboarding checklist · saved view sharing with teammates.

### Nice-to-have — Phase 2, designed for but not built

Configurable workflow transitions & gates · notification rules engine · custom roles · realtime presence ·
docs/wiki · time tracking · timeline/Gantt · automation rules · public API + webhooks · native mobile ·
SSO/SAML · AI assist · company group chat · MCP server · billing.

### Behaviour worth stating precisely

- **State groups.** Every state belongs to one of five ordered groups: `backlog`, `unstarted`, `started`,
  `completed`, `cancelled`. Progress, burndown, and "is it done" derive from the **group**, never the state
  name. A new project starts with six working states and needs no setup.
- **Blocked is a flag, not a state.** An item can be *In Progress and blocked*. Making it a state would lose
  the information about where the work actually was, and forces a fake transition to unblock.
- **Deleting a state** holding items requires choosing a migration target. The one place we insist on a
  confirmation dialog, because the alternative is orphaned work.
- **Archive ≠ delete.** `archived_at` is user-facing and reversible; `deleted_at` is a 30-day recovery
  window. Human identifiers (`ENG-142`) are never reused. **Archiving is a project-level action in v1** —
  there is no per-item archive; a work item leaves the active surface by being completed, cancelled, or
  deleted. **An archived project is read-only** — no new items, no edits, no state changes, no comments —
  until it is unarchived, which is one click. Anything
  less is a saved filter wearing the word "archive".
- **Dates are workspace time; staleness is working days.** "Overdue" is evaluated in the **workspace**
  timezone (§6-1), never the viewer's device — otherwise an item is late for the employee and on time for
  their manager, and the two disagree about one number in one meeting. Due dates count **calendar** days,
  because a human deliberately picked that date. "Stale > N days" counts **working** days from the same
  §6-1 setting, or every Monday morning flags Friday's work and the surface trains people to ignore it.
- **Working days exclude workspace holidays.** The week-start and working-days settings alone still break in
  this market: Khmer New Year and Pchum Ben are multi-day closures that move with the lunar calendar, so a
  three-day staleness rule fires on the entire workspace the morning everyone returns. Holidays are workspace
  data with a seeded, editable calendar (§6-1), read by the one `business_days_between` function (§9) that
  staleness, the reminder digest, and cycle progress all share. A holiday calendar the company cannot edit is
  worse than none — it is confidently wrong.
- **Availability is a flag, not time tracking.** A member can be marked *unavailable until* a date, with an
  optional reason. Workload and Needs Attention read it; nothing else does. It is one date — no hours, no
  balances, no approval flow — because time tracking is a §3 non-goal and this is the smallest thing that
  keeps the manager's workload view honest while someone is on leave.
- **Due-date reminders are a digest, not a stream.** One message per person per evening in workspace time,
  listing what is due tomorrow and what is already overdue. One email per item is the fastest way to teach a
  team to filter the product's mail (§7.8).
- **Assignment is multiple.** Single-assignee is a limitation teams route around with comments.
- **Notifications reach every assignee except the actor.** Nobody is notified of their own action —
  self-notification is the most common reason people mute a product's email. Unassignment notifies the
  person removed. This is also the default rule set the Phase 2 rules engine overrides.
- **Offboarding reassigns.** Removing a member requires choosing what happens to their open work.

---

## 5. Modern & useful features

What separates this from a 2015 task tracker, split by when it lands.

### v1 — the modern baseline

A product without these feels dated on arrival.

| Feature | Why it matters |
| --- | --- |
| **Command palette `⌘K`** | Not knowing where something lives stops being a problem — the highest-leverage feature for zero-training |
| **Inline everything** | Create and edit in place. No modal chains anywhere in the default path |
| **Optimistic UI** | Every action lands instantly; the network is invisible when it works |
| **Natural-language dates** | "next friday", "in 3 days", "ថ្ងៃស្អែក" parsed in the date field |
| **Smart defaults** | Prefix suggested from project name, assignee defaults to you, state defaults to the column you created in |
| **Shareable filtered URLs** | Any view state is a URL. Paste it in chat and a colleague sees exactly what you see |
| **Keyboard-first** | Full create → assign → move → comment loop without a mouse |
| **Paste-to-upload** | Screenshot straight into a comment — the most-used collaboration action in practice |
| **Dark mode** | Table stakes, and costs nothing because it is a second token set (§12) |
| **Needs-attention digest** | The product tells you what is wrong instead of waiting to be asked |
| **Due-date reminders** | One digest the evening before, in workspace time. The product warns you *before* an item is late, not after |
| **Add to Home Screen** | A manifest and an icon set — a static file, not a flow. In a phone-first market (§2.5-3) an icon on the home screen is most of what "app" means to a user (§17-21) |

### Phase 2 — differentiators, architected for in v1

| Feature | Note |
| --- | --- |
| **Telegram integration** | Strategically the most valuable item here for this market (§2.5). Create an item from a message, get notified in chat, update state from chat. Depends on the §8 outbox, which v1 builds. Designed in **§19.5** |
| **Company group chat** | Channels and DMs inside the workspace, with one-action promotion of a message into a work item — the thing Telegram cannot do for the company. Designed in **§19.3** |
| **Email-to-task** | Forward an email into a project |
| **AI assist** | Summarize a long comment thread · suggest sub-task breakdown · draft the weekly status from activity · translate a comment EN↔KH inline — the last is unusually valuable for bilingual teams. Designed in **§19.4** |
| **MCP server, one per company** | A company points its own AI client at its own workspace, on a token scoped exactly like a member. Designed in **§19.6** |
| **Realtime presence** | Live cursors and updates; v1 installs the seams |
| **Workload forecasting** | Capacity vs committed work per person over time |
| **Duplicate detection** | Warn when a new item looks like an existing one |
| **Automation rules** | "When state → Done, notify the lead and clear the blocked flag" |
| **Client intake form** | A link an outside client fills in that becomes a work item in one project — the agency case in §2.1. Gated on an abuse plan, not on engineering (§17-23) |

> **✅ DECIDED (§18-8):** Telegram integration is Phase 2. Revisited only if the pilot company (§18-7) turns
> out to be strongly chat-first. It depends on the outbox (§8), so it cannot be built earlier than slice 9
> regardless.

> **The four chat and AI items above are designed in §19** — group chat, the assistant,
> the Telegram bridge and a per-company MCP server, with the one rule they share: an assistant or an
> integration is an *actor*, never a tenancy bypass.

---

## 6. Company customization

> **Governing rule:** a company that never opens Settings must be completely fine. Every item below is an
> override of a working default, never a prerequisite.

| # | Area | v1 | Phase 2 |
| --- | --- | --- | --- |
| 1 | **Company settings** | Name, slug, logo, timezone, week start, working days, **public holidays**, default language | Fiscal year, data residency, subscribed holiday feeds |
| 2 | **Roles & permissions** | Four workspace roles + three project roles, fixed (§10) · **view as a member** (§7.13) | Custom roles, per-field permissions |
| 3 | **Workflow configuration** | States per project: add, rename, recolour, reorder, regroup, delete-with-migration | Project templates, transitions, required fields per state, approval gates |
| 4 | **Custom fields** | Per-project definitions: text, number, select, multi-select, date, user, checkbox. Filter, group, show in views | Formula fields, cross-project fields, per-role visibility |
| 5 | **Departments / teams** | Teams with members; projects belong to a team; filter and group by team | Nested departments, team-level permissions and budgets |
| 6 | **Notifications** | Per-user preferences (in-app / email, per event type) + workspace defaults | Rules engine, digest scheduling, chat routing |
| 7 | **Branding** | Logo, accent colour, login page, email header | Custom domain, full theme, white-label |

### Why these moved into v1

**Custom fields** are the single most common reason a company rejects a work tool — they track something the
tool has no place for (client name, invoice number, campaign). Without it, they use a spreadsheet alongside,
and then the spreadsheet wins. It is cheap now (two tables, one filter branch — §9) and expensive to
retrofit, because every view, filter, and export must learn about it.

**Departments and teams** are how a 50+ person company actually thinks. Retrofitting a grouping layer *above*
projects means touching every query's scoping, which is the most dangerous refactor in the codebase.

**Workflow states** were already v1.

**The holiday calendar** is the cheapest of the four and the one this market cannot do without. Everything the
product says about time — stale, due soon, cycle progress, the reminder digest — is arithmetic over working
days, and in Cambodia those days are interrupted by multi-day, lunar-dated closures. Seeded from the workspace
country and editable, it is one table and one SQL function (§9). Hardcoded, it is wrong every year; absent,
every derived date in the product is wrong for the fortnight around Khmer New Year.

Deferred: project templates, transitions/gates, notification rules, custom roles. Each is genuinely additive — they constrain or
route things that already exist rather than adding new nouns.

### Customization safety rules

- Every customization is **workspace-scoped and reversible.** No setting can put a workspace in an
  unrecoverable state.
- **Deleting a definition** with data requires an explicit choice about the data.
- **Defaults are seeded, not empty.** New projects get six states; new workspaces get one team ("General")
  and a sensible notification default.
- **Settings is discoverable but never on the critical path.** Nothing in onboarding routes through it.

---

## 7. User flows

Every major feature, entry to exit. `[L]` loading · `[E]` empty · `[S]` success · `[X]` error ·
`[!]` edge case.

### 7.1 Sign up → first task *(target: under 3 minutes)*

```
Landing → Sign up (email or Google) → Verify email
   → Create company     name only; slug auto-derived and editable
   → Invite teammates   SKIPPABLE — "Skip" is visually equal to "Send"
   → Create project     name entered; prefix auto-suggested (Marketing → MKT)
   → Land on the BOARD  six default states already present,
                        "add your first task" input already focused
```

No configuration step exists anywhere in this path.

`[L]` skeleton board with state columns already drawn · `[E]` the focused input *is* the empty state ·
`[S]` first item appears in column 1, input stays focused for the next · `[X]` email taken → inline on the
field with a sign-in link, form retained · `[!]` invite email bounces → shown in member list as "not
delivered" with a resend, never a silent failure · `[!]` company name is Khmer → slug transliterates to
Latin, editable.

### 7.2 Create a work item *(target: under 5 seconds)*

Inline `+` at the bottom of any board column or list group → type title → `Enter`. Created in that group with
defaults, input stays focused. Everything else editable inline afterwards. **There is no create-task modal in
the default path.** `⌘K → "new task"` reaches the same thing from anywhere.

`[X]` offline → item held locally, marked pending, retried; never lost on refresh ·
`[!]` title pasted with newlines → offers to split into multiple items.

### 7.3 Daily employee loop — the flow that decides adoption

```
Open app → lands on MY WORK (never a project list)
  grouped by: Overdue · Today · This week · Later · No date
  → click a state pill to advance an item      (one click, optimistic)
  → mark blocked + reason                       (one click; notifies project lead)
  → open item for detail, comment, attach
```

`[E]` nothing assigned → "You're clear. Here's what your team is working on" + team view link. Never a bare
"No results" — an empty My Work is good news and should read that way.

### 7.4 Manager loop

```
My Work → Team switcher → group by ASSIGNEE
  each column headed by person + open count + overdue count
  → NEEDS ATTENTION tab: overdue · blocked · unassigned · no due date · stale (>N days)
  → drag a card between people to reassign      (notifies both)
  → "Copy status summary" → markdown to clipboard, ready to paste in chat
  → "Export"               → print layout → Save as PDF, the version you send a client
```

**Workload is availability-aware.** A member marked *unavailable until* a date (§4) is shown with those dates
on their column and is excluded from "who has capacity" arithmetic — otherwise the honest picture the manager
came for is confidently wrong about the one person it matters most about. Reassigning onto someone unavailable
is **warned, never blocked**: the manager knows things the flag does not.

**Export is a print stylesheet, not a PDF service.** A print-specific layout plus `⌘/Ctrl+P → Save as PDF`
costs a stylesheet; a server-side renderer costs Chromium in the container and a job queue, for a document one
person produces once a week. **The Khmer face must be embedded in the print layout** — the classic failure is a
dashboard that is perfect on screen and prints Khmer as boxes.

`[E]` nothing needs attention → explicit "Nothing needs your attention" confirmation state ·
`[!]` 30-person team → columns virtualize and scroll horizontally; header stays ·
`[!]` printing a board with 30 columns → the print layout is the grouped list, never the board.

### 7.5 Board drag

Drag card → optimistic move → server computes rank from neighbour IDs under row lock → confirmed.

`[X]` rejected (permission lost, item deleted) → card animates back with a toast explaining why ·
`[!]` two people drag the same card → both windows converge to the same order; no ghost cards (§9).

### 7.6 Cycle (sprint)

Create with date range → add items (multi-select from backlog, or drag) → cycle becomes "active" on start
date → progress bar + burndown → on end date, incomplete items prompt: move to next cycle, return to
backlog, or leave.

**Cycle membership is per item, never inherited.** A sub-item is not pulled into its parent's cycle:
carry-over work routinely outlives the parent's cycle, and silent inheritance rewrites burndown history the
moment a parent moves. Burndown counts only items assigned **directly** to the cycle, so a parent in the
cycle whose sub-items sit outside it counts once — no double-count. Adding a parent may *offer* to add its
sub-items; it never does so silently.

`[E]` no items → "Add work to this cycle" with a picker · `[!]` cycle ends with items open → the prompt is a
decision, never an automatic move · `[!]` overlapping cycles → allowed, warned.

### 7.7 Comment & mention

Comment box on item → `@` opens member picker → post → mentioned users get inbox entry + email (subject to
their preferences) → their name is highlighted in the thread.

`[X]` post fails → draft retained in the box, retry button. **Never lose typed text.** ·
`[!]` mentioning a non-member of a private project → offer to add them, or block with a clear reason.

### 7.8 Notifications

Bell shows unread count → inbox lists grouped by item → click navigates to the item **and the specific
comment** → mark read/unread, mark all read. Email links deep-link to the same anchor.

**Who gets notified.** On any item change: every assignee **except the person who made the change**, plus
anyone mentioned in it. Unassigning notifies the person removed. An actor never hears about their own action.

**Due-date reminders.** One digest per person per evening, in the **workspace** timezone (§6-1): what is due
tomorrow, and what is already overdue. Never one email per item — that is the fastest way to teach a team to
filter the product's mail. The digest is skipped when the list is empty, and when the next day is a non-working
day or a workspace holiday it moves to the last working evening before, so nobody is reminded on Sunday about
Monday. One switch in per-user preferences turns it off.

`[E]` "You're all caught up." · `[!]` 500 notifications → paginated, "mark all read" acts on all ·
`[!]` an item due tomorrow with five assignees → five digests, each listing only that person's own work.

### 7.9 Search & command palette

`⌘K` → type. Results in sections: Work items · Projects · People · Actions. `ENG-142` short-circuits to that
item. Khmer queries use trigram matching (§13). Actions include "assign to me", "switch language", "go to My
Work".

`[L]` results skeleton, previous results stay visible while typing · `[E]` "No results for X" + a create
option · `[!]` Khmer text with no spaces → still matches.

**Scope.** Items belonging to an **archived project** are **excluded by default**, with a one-click
"include archived" toggle — archiving is project-level, so there is no separately archived item (§4).
Soft-deleted items never appear in search and are reachable only from the 30-day recovery screen in
Settings. A direct `ENG-142` lookup always resolves regardless of either — that is the entire reason
identifiers are never reused.

### 7.10 Invite & join

Admin → Settings → Members → Invite (email + role + teams + projects) → invitee receives email → clicks →
signs up or signs in → lands **directly in the workspace, in the right teams**, on My Work.

**Bulk invite.** The email field takes many at once: paste a comma-, space-, or newline-separated list, or drop
a CSV with `email,role,team` columns. Each address becomes a validated, removable chip; duplicates and existing
members are collapsed, not rejected. Role, teams, and projects apply to the whole batch and stay overridable
per row before sending. A 40-person company (§2.1) should not submit the same form 40 times — that is the kind
of onboarding a company does once, badly, and then never again.

`[X]` expired invite (14 days) → clear message + request-new-link button · `[!]` already a member → straight
to the workspace, no error · `[!]` invited while already in other workspaces → switcher highlights the new one ·
`[X]` part of a batch fails → **no rollback**; the result lists sent and not-sent, with retry on the failures
only · `[!]` a pasted list contains a malformed address → flagged in place, the rest still send.

### 7.11 Customization — creating a custom field

Settings → Project → Custom fields → Add → pick type → name → (options if select) → save. Immediately
available in create form, item detail, filters, group-by, and table columns.

`[!]` deleting a field with values → choose: delete values, or export first. Explicit, never silent ·
`[!]` renaming → values preserved, no migration.

### 7.12 Offboarding a member

Settings → Members → Remove → **required choice**: reassign their open items to X, or leave unassigned and
flag in Needs Attention. Their comments and activity history are preserved and attributed.

`[!]` removing the last Owner → blocked, with a clear reason.

### 7.13 View as a member — checking what someone can actually see

Settings → Members → row → **View as** → the app re-renders as that person: their projects, their navigation,
their My Work, their Needs Attention. A persistent bar names who is being viewed and offers **Exit**.

**Every mutation is refused while it is active.** This flow answers a question; it does not do work.

It is a **real actor context**, not a UI filter — `resolveActorContext` resolves the target member, and the
same RLS variables and the same policy module (§10) apply. A UI filter would show the owner a correct-looking
screen over an incorrect query, which is exactly the bug they opened the screen to find.

Owner and Admin only (§10). Starting a session is logged against the viewer: this is a permission an owner
holds openly, not a back door.

`[E]` the member sees nothing — no projects yet → that *is* the answer, stated plainly ·
`[!]` viewing as someone in a private project the viewer is not in → allowed for Owner/Admin, and the log entry
is the accountability · `[!]` the member is removed mid-session → view-as ends with an explanation, not a 404.

---

## 8. Architecture

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, React 19, TS 5.9) | One language, one deployable; RSC suits a data-dense read-heavy UI |
| Database | **Postgres 18** | RLS, `tsvector`, `pg_trgm`, arrays, and the job queue in one dependency |
| ORM | **Drizzle** | SQL-first control for the §9 list query; RLS and generated columns without escape hatches |
| Auth | **Own session layer** on `node:crypto` | Email/password + database sessions; Auth.js v5 cannot do both — see §17-29. Google OAuth slots in behind the same interface |
| Styling | **Tailwind v4** + **Radix primitives** | Accessible behaviour we don't rebuild; components stay ours |
| Animation | **Motion** (formerly Framer Motion) | Radix ships behaviour, not motion; layout and enter/exit animation that survives unmounting, gated on `prefers-reduced-motion` |
| Rich text | **TipTap 2** | Comments and descriptions, mentions, paste-image |
| Drag & drop | **dnd-kit** | Keyboard-accessible dragging — required by the a11y baseline |
| Files | **S3-compatible** (R2 or MinIO) | Presigned direct upload; no bytes through the app server |
| Email | **Resend** + **React Email** | Templates in the same language as the app |
| Jobs | **pg-boss 12** | Postgres-backed; no Redis in v1 |
| i18n | **next-intl 4** | `localePrefix: 'always'` |
| Validation | **Zod 4** | One schema for server actions, route handlers, and forms |
| Tests | **Vitest** + **Playwright** | Unit/integration and end-to-end |

*Versions verified current as of 27 August 2026.*

**Deployment:** long-lived Node container, two process types — web and job worker — from one image. Not
serverless: the worker and the pg pool both want a persistent process.

### Mutation flow

**Server Actions for everything**, with five deliberate Route Handler exceptions: drag-and-drop reorder, list
fetch, file upload, webhooks, and the future public API.

Every mutation runs through `withActor(ctx, fn)`, which opens a transaction, sets the RLS variables, builds a
unit of work, runs the handler, then flushes events **before commit** so data, activity, and outbox share
atomicity.

### Activity and notifications

```
service layer → uow.emit(typedEvent)
                   ├─→ activity projectors   (exhaustive Record<EventType, Projector>)
                   └─→ transactional outbox
                             └─→ pg-boss consumers → inbox · email · [Phase 2] Telegram
```

> **Why this shape.** The projector registry is **exhaustive over the event union**, so adding an event type
> without deciding how it appears in the activity feed **fails to compile**. A mechanism, not a convention
> someone has to remember.
>
> Database triggers were rejected: they cannot express "notify the mentioned users" without putting
> application logic in SQL, and they are invisible to whoever reads the handler.

### Realtime-ready seams (built in v1, unused until Phase 2)

`resolveActorContext` resolves from a **token**, not a Next request object, so a WebSocket can call it — and
the same seam is what makes view-as (§7.13) a real actor context rather than a UI filter. The outbox carries a
monotonic **`seq`** so a reconnecting client replays what it missed. `version` columns on mutable entities for
conflict detection. Disciplined cache keys.

### Board revalidation (v1, §17-2)

Not realtime, but never silently stale. Board views poll a **change token** — `max(updated_at)` plus a row
count for the current filter, one indexed aggregate — and only fetch the board when the token moves:

| Condition | Behaviour |
| --- | --- |
| Tab visible | Poll every **20s** |
| Token unchanged | Back off 20s → 40s → **60s cap**; reset to 20s on any change or any local mutation |
| Tab hidden (`document.hidden`) | **Stop.** A background tab polls nothing |
| Window regains focus | Immediate revalidate, then resume at 20s |
| `saveData`, or `2g`/`slow-2g` | Focus and mutation revalidation only — no timer at all |

A quiet board therefore costs a few hundred bytes a minute, and a phone in a pocket costs nothing. **The last
two rows are not a nicety**: §2.5-5 is a cost-sensitive market on mobile data, and a tracker that quietly eats
a data plan is uninstalled without anyone filing the reason.

### Directory layout

```
src/
  app/[locale]/
    (auth)/ (onboarding)/
    [workspaceSlug]/
      (dashboard)/   my-work · inbox · needs-attention · search
      projects/[projectId]/  views · cycles · settings
      teams/ settings/
  app/api/internal/  reorder · list · upload
  server/
    db/       schema/ · client.ts · tenant.ts
    authz/    policy.ts
    queries/  work-item-list.ts
    services/ events/ jobs/
  components/ ui/ · work-item/ · views/
  i18n/  lib/
drizzle/
```

---

## 9. Data model

### Hierarchy

```
User ──< WorkspaceMember >── Workspace (a company)
                               ├── Team ──< TeamMember >── User
                               ├── Project (belongs to a Team) ──< ProjectMember >── User
                               │     ├── WorkflowState (grouped)
                               │     ├── CustomFieldDefinition
                               │     ├── Cycle
                               │     └── WorkItem ── sub-items (depth ≤ 3)
                               │            ├── CustomFieldValue
                               │            ├── Comment · Attachment · Activity
                               ├── Label · SavedView · Invitation · Notification · Holiday
```

### Tenancy

**Every tenant table carries `workspace_id` denormalized**, held honest by composite foreign keys — a work
item's `(project_id, workspace_id)` must match the project's own pair, so a row physically cannot reference a
parent in another workspace.

**Isolation is Postgres Row-Level Security**, not a remembered `WHERE` clause:

- The app connects as a **non-owner role** with `FORCE ROW LEVEL SECURITY` on every tenant table.
- Each request runs in a transaction setting **transaction-local** variables — so a pooled connection cannot
  leak scope across requests.
- The Drizzle handle is a **branded type**; repositories accept nothing else.

> **Why not just a scoped query layer.** A scoped data-access layer alone fails the moment one query is
> written outside it — and that query is invisible in review. RLS turns the failure mode from *"returns
> another company's data"* into *"returns nothing"*. The scoped layer still exists, but for authorization,
> not tenancy.

### Decisions on the fiddly parts

| Concern | Decision |
| --- | --- |
| **Human IDs** `ENG-142` | Counter row per project, allocated last in the transaction. Gapless — and the lock that guarantees that is contention **scoped to a single project's counter row**, never workspace-wide |
| **Ordering** | Fractional-index base-62 strings, jittered. The client sends **neighbour IDs**, never a rank; the server reads neighbours under `FOR UPDATE` and computes the key. A stale drag lands correctly relative to present state — this is what stops boards feeling haunted |
| **Hierarchy** | Adjacency list plus trigger-maintained `root_id`/`depth`, capped at 3. "All descendants" is a cheap lookup without a closure table's write amplification |
| **Soft delete** | `archived_at` (on projects) and `deleted_at` are separate concepts. The `security_invoker` views hide **`deleted_at` only**. Archived is user-facing and reversible, so the unarchive screen, the archived-projects list, the include-archived toggle and direct ID lookup all have to see it — four bypasses and the guarantee is gone. Archived is a **default filter in the query builder** instead |
| **Custom fields** | Real tables, not JSONB. Typed indexed columns per value kind. A `custom:{fieldId}` filter is one branch in the builder |
| **Working days & holidays** | A working-days bitmask and a `workspace_holiday` date table, both workspace-scoped, behind one SQL function `business_days_between(workspace, from, to)`. Staleness, the reminder digest, and cycle progress all call it — three surfaces that must never disagree about whether Friday counted |
| **Availability** | One nullable `unavailable_until` (plus optional reason) on workspace membership. Deliberately not an entity: leave periods, balances, and approvals are how this becomes the time tracking §3 rules out |
| **Search** | `tsvector('simple')` for Latin, `pg_trgm` for Khmer — which has no inter-word spaces, so word-based FTS fails — routed by script detection. `ENG-142` short-circuits |

### The list query

The performance-critical surface. **One Zod filter DSL, one builder, two queries** — a counts query and a
`LATERAL` per-group page query, because a board needs a page *per column*, not one page overall. Keyset
cursors only; offset pagination degrades exactly when a workspace becomes valuable.

Denormalized `assignee_ids uuid[]` and `label_ids uuid[]` with GIN indexes let common filters avoid join
fan-out; join tables stay the source of truth, arrays are trigger-maintained.

Column identifiers come only from frozen maps, and an `invariant` refuses to emit an unanchored
workspace-wide scan — the query that otherwise takes production down at 3am.

---

## 10. Permissions

**Workspace roles:** Owner · Admin · Member · Guest.
**Project roles:** Lead · Member · Viewer.

| Action | Owner | Admin | Member | Guest |
| --- | :-: | :-: | :-: | :-: |
| Delete workspace, manage billing | ✅ | — | — | — |
| Workspace settings, branding, teams | ✅ | ✅ | — | — |
| Invite / remove members, change roles | ✅ | ✅ | — | — |
| Create project | ✅ | ✅ | ✅ | — |
| See workspace-visible projects | ✅ | ✅ | ✅ | — |
| See private project | ✅ | ✅ | if member | if member |
| Project settings, states, custom fields | ✅ | ✅ | if Lead | — |
| Create / edit work items | ✅ | ✅ | if Member+ | if Member+ |
| Comment | ✅ | ✅ | if Member+ | if Member+ |
| Delete others' comments | ✅ | ✅ | if Lead | — |
| View as a member (read-only) | ✅ | ✅ | — | — |

**Composition.** Owner and Admin are implicit project Leads everywhere. A workspace-visible project grants
Members implicit Viewer. **Guests get nothing implicitly** — only projects they are explicitly added to. That
rule is what makes Guest safe to hand a contractor.

> **View as.** An owner who cannot answer *"what does Sophea actually see?"* has to ask a developer — so the
> non-technical owner of §2.3 never audits their own permissions, and this table becomes a document nobody
> checks against the running product. View-as re-resolves a real `ActorContext` for the target member, applies
> the same RLS variables and this same module, and refuses every mutation while active (§7.13).

> **Implementation.** One central policy module: `can(ctx, action, resource)` over a pre-resolved
> `ActorContext`, with an exhaustive `Record<Action, Rule>`. Adding an action without deciding its rule is a
> compile error, so a check cannot be forgotten by omission. The module must not import `next/headers`,
> keeping it pure and unit-testable.

---

## 11. UX principles

### The five states — every view specifies all of them

| State | Requirement |
| --- | --- |
| **Loading** | Skeletons matching the final layout. Never a full-page spinner, never layout shift on arrival |
| **Empty** | Says what this is and offers the primary action. A live input, not a shrug. Where empty is *good news* (My Work), say so |
| **Success** | Optimistic. A toast only when the result isn't visible on screen |
| **Error** | Plain language, says what to do next, **retains user input**. Never a raw error code |
| **Edge** | Long titles · 50 assignees · 200 columns · deleted-while-viewing · permission-lost-while-viewing · offline · Khmer text with no spaces |

### Accessibility baseline

Keyboard-operable throughout including drag-and-drop · visible focus rings · WCAG AA contrast · correct
labels and roles from Radix · `prefers-reduced-motion` respected · every icon-only control has an accessible
name.

---

## 12. UI design system

> **✅ DECIDED (§18-1):** UnifyOps inherits the Unify family palette and typography — the same company owns
> both products, so there is no separate identity to commission. The values below are the brand's, not
> placeholders, and §12 is settled.

### Colour

| Name | Hex | Role |
| --- | --- | --- |
| Sky | `#54A6DB` | Primary accent — fills and large text only |
| Navy | `#214775` | **The text blue** |
| Crimson | `#FF5952` | Danger |
| Lilac | `#BDA3CC` | Decorative, labels |
| Chartreuse | `#C4D145` | Decorative, labels |
| Ivory | `#F2F0ED` | Neutral base, instead of pure white |
| Charcoal | `#212E3B` | Neutral base, instead of pure black |

The brand gives seven flat colours, no ramps, no semantic mapping, and no green. A product UI needs all
three, so we extend:

- **Ramps** 50–950 for Sky, Navy, and an Ivory→Charcoal neutral. Hover, pressed, and disabled states are
  undefined in the brand and must come from these.
- **Semantic tokens** — `--success` (a **new green**; the brand has none), `--warning` (an amber; Chartreuse
  reads as "go", not "caution"), `--danger` → Crimson, `--info` → Sky.
- **Three layers**: fixed ramps → semantic aliases that flip for dark mode → utilities. Dark mode is a second
  token set, not a rewrite. Per-workspace accent branding is a token override.

> **🛑 Contrast failure — must not be ignored.** Sky `#54A6DB` on Ivory is approximately **2.4:1 and fails
> WCAG AA.** **Navy is the text blue**; Sky is for fills, accents, and large text only.

**Semantic assignments**

| Use | Token |
| --- | --- |
| Priority urgent / high / medium / low / none | danger · warning · sky · ink-400 · ink-300 |
| State group backlog / unstarted / started / completed / cancelled | ink-400 · ink-500 · warning · success · ink-400 |
| Blocked flag | danger-subtle background + danger border |
| Overdue | danger text on danger-subtle |

### Typography

| Role | Latin | Khmer | Size / weight |
| --- | --- | --- | --- |
| Page title | Plex Sans Condensed | Koh Santepheap Bold | 32 / 600 |
| Section heading | Plex Sans Condensed | Koh Santepheap Bold | 20 / 600 |
| Body, UI default | IBM Plex Sans | Kantumruy Pro | 14 / 400 |
| Item title in list | IBM Plex Sans | Kantumruy Pro | 14 / 500 |
| Meta, labels | IBM Plex Sans | Kantumruy Pro | 12 / 400 |
| Micro (counts, IDs) | IBM Plex Sans | — | 11 / 500 |

Scale: **11 / 12 / 14 / 16 / 20 / 24 / 32 / 40** — the brand defines none, so this is ours. Khmer lines set
at **`line-height: 1.75`**, because Khmer stacks diacritics vertically and clips at Latin heights. The Khmer
face sits **after** the Latin face in every stack — it has no Latin coverage worth using.

> **✅ DECIDED (§18-2):** Koh Santepheap is the brand Khmer face but is display-weight, so it is used for
> headings and display only; Kantumruy Pro carries body text, where at 12–14px it is materially more legible.
> The table above is the settled assignment.

### Spacing, radius, elevation

4px scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Radii: `4` inputs/chips, `6` buttons/cards, `8` panels,
`12` dialogs. Three elevations only. One motion curve; 120ms hover, 180ms panel, 240ms dialog.

### Component specs

| Component | Specification |
| --- | --- |
| **Button** | Variants `primary` (Navy fill) · `secondary` (surface + border) · `ghost` · `danger`. Sizes 28 / 32 / 40px. Loading replaces the label with a spinner at preserved width, so nothing reflows |
| **Input** | 32px height, label above at 12px, help text below, error replaces help and sets `aria-invalid`. Required marked on the label. **Placeholders are never labels** |
| **Select / Combobox** | Type-ahead above 7 options. Multi-select shows chips with an overflow count. Arrows, Enter, Escape, Home/End |
| **Table** | 36px rows, sticky header, 1px separators, no zebra, right-aligned numerics, column widths persisted per saved view. Scrolls inside its own container |
| **Dialog** | 400 / 560 / 720px. Focus trapped and restored. Escape closes unless there are unsaved changes. Never nested |
| **Toast** | Bottom-right, 5s auto-dismiss, action slot for Undo, max 3 stacked |
| **Avatar** | 20 / 24 / 32px, initials fallback on a deterministic colour from user ID. Groups cap at 3 + `+N` |
| **Icons** | Lucide, 16px inline / 20px standalone, 1.5px stroke, always with a label or accessible name |
| **Item card** | ID · title (2-line clamp **by grapheme, not character**) · assignee avatars · priority icon · due date · label chips · blocked badge · sub-item count |

**Inventory** — Button · Input · Textarea · Select · Combobox · DatePicker · Checkbox · Radio · Switch ·
Avatar/Group · Badge · StatePill · PriorityIcon · LabelChip · Dropdown · ContextMenu · Dialog · Sheet ·
Popover · Toast · Tooltip · Tabs · Table · Skeleton · EmptyState · CommandPalette · Pagination · FilterBar ·
GroupBySelect.

---

## 13. Bilingual architecture

**next-intl 4**, `localePrefix: 'always'` (`/en/…`, `/km/…`). Locale resolves from URL → saved preference →
`Accept-Language` → `en`.

| Content kind | Handling |
| --- | --- |
| **System strings** | Message catalogues per locale |
| **User content** — project names, titles, comments | **Never translated.** Stored exactly as entered |
| **Seeded defaults** — the six state names, default labels, the "General" team | The awkward middle: user-editable content that ships pre-filled. Carries an `i18n_key` column, rendered translated until the user renames one — at which point the key clears and the literal wins |
| **Closed enums** — priority, state groups | Mapped to messages **in code**. **No translation key ever reaches the database** |

### Khmer rendering — the specific traps

| Trap | Fix |
| --- | --- |
| **Digits.** Khmer locale renders Khmer numerals (០១២៣), which users overwhelmingly do not want in a task list | Pin `numberingSystem: 'latn'` explicitly |
| **Line breaking.** Khmer has no inter-word spaces | Mark the content subtree `lang="km"` so the browser applies ICU line-breaking rules |
| **Truncation.** Character slicing breaks grapheme clusters and produces broken glyphs | Truncate with `Intl.Segmenter` |
| **Search.** Word-based full-text search fails on Khmer | Trigram matching, routed by script detection. U+200B zero-width spaces preserved in stored text, stripped before indexing |

> **Non-negotiable.** Every string is externalized from the first slice, and every end-to-end test runs in
> both languages from slice 4 onward. Retrofitting bilingual support is the most expensive mistake available
> on this project.

---

## 14. Build sequence

Vertical slices, dependency-ordered, each ending in something demonstrable. Riskiest first — discovering a
foundation flaw in month three is fatal.

| # | Slice | Demonstrable outcome |
| --- | --- | --- |
| 0 | Repo, tokens, Drizzle, Postgres, CI | `pnpm dev` runs; migrations apply |
| **1** | **Schema + RLS + `withActor`** | Workspace B cannot read A's rows *even with a deliberately unscoped query* |
| **2** | **Policy module** | Full permission matrix unit-tested, no HTTP involved |
| 3 | Auth + workspace + teams + invitations (single **and bulk**) | Two users sign up, one invites the other, both land in the same workspace; a pasted list of ten addresses goes out in one action |
| 4 | Projects + workflow states + i18n scaffold | Create a project, six default states, switch to Khmer, all translated |
| **5** | **Work items + list query + List view** | Create, edit, filter, group, paginate — proven early |
| **6** | **Board + ranking** | Drag between columns; concurrent drags from two browsers land correctly |
| 7 | Events + activity + unit of work | Every change appears in the activity feed automatically |
| 8 | Comments, mentions, attachments | Full collaboration loop on one item |
| 9 | Notifications + pg-boss + email + **due-date digest** | Mention someone → inbox entry + email; the evening job sends one digest listing tomorrow's due items |
| 10 | Custom fields | Define a field; it appears in create, detail, filter, group, table |
| 11 | Cycles + progress + burndown | Run a two-week cycle end to end |
| 12 | Table + Calendar + saved views | All four view types |
| 13 | My Work + Needs attention + workload + **availability** | The §7.3 and §7.4 loops; a member on leave shows as such instead of as idle capacity |
| 14 | Command palette + search + shortcuts | `⌘K` finds anything, in both scripts |
| 15 | Settings — all seven customization areas, **holiday calendar**, **view-as** | §6 complete; an owner can see the product as any member sees it |
| 16 | Onboarding, empty/error states, a11y, responsive + **install** pass | First-run under 3 minutes with a real stranger; the app installs to a phone home screen |

Slices **1, 2, 5, and 6** are where a wrong decision is expensive to reverse. Front-loaded on purpose.

---

## 15. Verification

### Per slice, before it counts as done

`typecheck` + `lint` clean · Vitest for pure logic (policy matrix, rank generation, filter DSL, i18n
formatting, **working-day maths across a multi-day holiday cluster**) · integration tests on real Postgres via Testcontainers, **including a cross-workspace read test
per tenant table asserting zero rows** · Playwright for the slice's primary flow, **run in both `en` and
`km`**.

### Manual verification — running the app

| # | Check | Pass condition |
| --- | --- | --- |
| 1 | First-run timing, with someone who has never seen it | Signup → first task in under 3 minutes |
| 2 | Tenancy by hand — paste workspace B's URL while signed in as A | **404, not an empty page** |
| 3 | Concurrency — same board in two browsers, drag the same card | Both windows converge |
| 4 | Khmer pass across every screen | Line breaking, diacritics, truncation, dates, digits correct; no untranslated key visible |
| 5 | Keyboard-only — create → assign → move → comment | Completed without a mouse |
| 6 | Responsive — every v1 screen | Usable at 390px wide |
| 7 | Load — 50k work items in one workspace | List and board under 300ms server time |
| 8 | Install — Add to Home Screen, Android Chrome and iOS Safari | Launches standalone with the right name and icon, in both locales |
| 9 | Print — export a dashboard to PDF with Khmer content | Khmer renders as text, not boxes; no column clipped |

> **Definition of done for v1.** Someone who has never seen UnifyOps creates a workspace, invites a
> colleague, and runs a two-week cycle — and neither of them asks how to do anything.

---

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| **Tenancy leak** — the failure that ends the product | Four independent layers: forced RLS, non-owner role, transaction-local scope, branded connection type — plus per-table cross-tenant tests in CI |
| **List query degrades as workspaces grow** | Built in slice 5, not last. Keyset cursors only. A 50k-item load test as a gate. An `invariant` blocking unanchored scans |
| **Custom fields slow the list query** | Typed indexed columns, not JSONB. Custom-field filters go through the same builder and the same load test |
| **Drag-and-drop feels unreliable** | The server computes ranks from neighbour IDs under lock; the client never sends a rank. Two-browser test in slice 6 |
| **Khmer typography breaks the UI late** | i18n scaffold in slice 4, not at the end. Every end-to-end flow runs in both languages from that point |
| **v1 grows until it never ships** | The §3 non-goals are binding. Any addition must pass "does this survive the zero-training test" |
| **Employee adoption fails, data rots, product dies** | §2.1 is the highest-stakes bet in the plan. Validate My Work with real employees at slice 13 before building anything on top of it |

---

## 17. Review findings

A review pass over this plan. Each finding is resolved here, or escalated to §18.

**1. Customization conflict — RESOLVED.** The written brief treats company customization as core; the
questionnaire answer excluded it from v1 must-haves. Resolved toward the brief: custom fields and departments
move **into** v1 (§6), transitions and notification rules stay Phase 2. Reasoning: both add *nouns*
(retrofitting is expensive); the deferred items add *constraints* on existing nouns (genuinely additive).
**⚠️ Overrule this if v1 size matters more than fidelity to the brief.**

**2. Realtime excluded, but the board is inherently multi-user — RESOLVED.** Without any liveness, two people
on one board see divergent state until refresh, which reads as a bug. Fix: v1 revalidates on window focus and
on mutation, plus a lightweight poll on board views only. Not realtime, but never silently stale. The §8
seams stay for Phase 2. **The interval was left unspecified in v2 and is now fixed in §8** — see §17-24.

**3. Mobile not selected, but §2.5 says users are phone-heavy — RESOLVED.** Contradiction. Fix: **responsive
is a v1 must-have** (§4), verified at 390px (§15-6). Mobile-*optimized* flows — bottom sheets, swipe
gestures — stay Phase 2. Responsive-by-default costs little; retrofitting costs a lot. **PWA install has since
been split out of that Phase 2 group and moved into v1** — see §17-21.

**4. "Multi-company SaaS" with no billing — RESOLVED as deliberate.** v1 is free for pilot companies. Billing
is Phase 2. The data model carries `workspace` as the billing boundary so adding it is additive. **This means
v1 cannot be opened to public self-serve signup without an abuse plan** — settled: the first cohort is
invite-only (§18-3).

**5. Blocked was a label; now a first-class flag — RESOLVED.** §2.1 and §2.2 both independently need it. As a
label it is invisible to Needs Attention and unqueryable. As a state it loses where the work actually was. A
flag on the item is correct.

**6. My Work was buried under dashboards — RESOLVED.** §2.1 says the employee must be paid back first, so My
Work is now the landing screen and moved earlier in the build.

**7. Version drift — RESOLVED.** The first draft named Next 15, pg-boss 10, Postgres 16. Current as of
27 August 2026: **Next 16.3, pg-boss 12, Postgres 18.4** (18.4 confirmed installed locally).

**8. `dnd-kit` package name — NOTED.** The bare `dnd-kit` package on npm is a 0.0.2 placeholder; the real
imports are `@dnd-kit/core` and `@dnd-kit/sortable`.

**9. Estimate field has no defined unit — RESOLVED.** Points, hidden by default (§18-4). Hours would claim a
precision the product cannot back while it has no time tracking.

**10. No data export / account deletion — GAP, deferred.** A company must be able to get its data out and
close its account. Not v1, but it must be said out loud: **v1 is a pilot product, not one you can sell to a
company with a procurement process.**

**11. Human ID allocation claimed "no contention" — RESOLVED as wording.** Gapless allocation requires
serializing on the counter row; that *is* row-level contention, scoped to one project. The trade-off is
right, the claim was not. §9 now states the scope instead of denying the cost.

**12. Project templates were in §6 but not §4 — RESOLVED by removal.** §6 listed them as v1 while the §4
must-have table did not, so slice 15 ("§6 complete") would have built them behind an unsized checklist
item. A pilot company with three projects gains nothing from templates. Moved to Phase 2 rather than
added to §4.

**13. "Overdue" had no timezone authority — RESOLVED.** Workspace timezone, not device (§4). Device
timezone makes an item late for one person and on time for another, turning a shared number into an
argument.

**14. Staleness and working days were unlinked — RESOLVED.** Due dates count calendar days, staleness
counts working days (§4). Without the split, a two-day staleness rule fires every Monday on Friday's work.
**Working days without a holiday calendar only fixes the small half of this** — see §17-18.

**15. Multi-assignee notification targets were undefined — RESOLVED.** Every assignee except the actor,
plus anyone mentioned (§7.8). This also gives the Phase 2 rules engine a default rule set to override,
which it did not have.

**16. Sub-items and cycle membership were undefined — RESOLVED.** Membership is per item, never inherited,
and burndown counts only direct members (§7.6). Inheritance would rewrite burndown history whenever a
parent moved.

**17. Archive and search scope were underspecified — RESOLVED, and one design bug fixed.** Archived
projects are read-only (§4); search excludes archived by default with a toggle and excludes deleted
entirely, while a direct ID lookup always resolves (§7.9). The §9 claim that the `security_invoker` views
hide archived *and* deleted was wrong: four legitimate paths need to see archived rows, and a guarantee
with four bypasses is not a guarantee. The views now hide `deleted_at` only. Archiving is also confirmed
**project-level**: §7.9's "archived items" meant items in an archived project, not a per-item archive flag,
which v1 does not have.

**18. "Working days" with no holiday calendar — RESOLVED.** §17-14 fixed Monday morning and left the larger
hole open. Cambodia's closures are multi-day and lunar-dated — Khmer New Year, Pchum Ben, Water Festival — so
a three-day staleness rule fires on the entire workspace the morning everyone returns, and the surface trains
people to ignore it in exactly the way §17-14 was trying to prevent. Fix: a seeded, editable per-workspace
holiday calendar (§6-1), consumed by the single `business_days_between` function in §9, so staleness, the
reminder digest, and cycle progress cannot disagree. Maintenance of the seed → §18-10.

**19. Nothing warned before a due date, only after — RESOLVED.** Notifications covered mentions and
assignment, so the first time the product mentioned a due date was when the item was already overdue and
sitting in Needs Attention. A tracker reports; a product warns. Fix: one digest per person the evening before,
in workspace time (§7.8), on the pg-boss and outbox that slice 9 already builds. The cost is a scheduled job
and an email template.

**20. Invitation was one address at a time — RESOLVED.** §7.10 sent one invite per form submission, so
onboarding the 40-person agency of §2.1 meant 40 identical submissions — the kind of task a company does once,
badly, and then never again, which shows up later as "only nine people ever used it". Fix: paste a list or drop
a CSV (§7.10). The invitation model is unchanged; only the form is.

**21. Installability was bundled with mobile-*optimized* flows — RESOLVED by splitting.** §17-3 put PWA
install in the same Phase 2 bucket as bottom sheets and swipe gestures. Those are flows and genuinely cost
weeks; a manifest, an icon set, and a theme colour are a static file and a `<link>`. In a phone-first market
(§2.5-3) an icon on the home screen is most of what "app" means to a user. Install moves to v1 (§4, §5,
§15-8); the optimized flows stay Phase 2.

**22. An owner could not check what a member sees — RESOLVED.** §10 specifies permissions precisely and gave
the non-technical owner of §2.3 no way to verify them against the running product, so every "why can Sophea
see this?" became a developer question — and in a company with no dedicated tool admin (§2.5-4), an unanswered
one. Fix: view-as, Owner/Admin only, read-only, a real actor context rather than a UI filter (§7.13, §10).

**23. No path for work arriving from outside the company — GAP, Phase 2 and named.** Agency work often starts
as a client email; the §2.1 project lead wants a link the client fills in that becomes a work item. It is not
in v1, and the reason is not engineering: it would be the product's **first unauthenticated write path**, and
§17-4 already records that v1 has no abuse plan. Shipping it without one moves a spam problem inside a
customer's workspace, where it is their data-quality problem rather than our inbox problem. Listed in §5 and
→ §18-9, in case the pilot company needs it sooner — in which case it needs the abuse plan **first**, not
instead.

**24. The board poll had no interval — RESOLVED.** §17-2 specified a mechanism and no number, which in
practice means whoever builds it picks 5s and a forgotten background tab bills someone's mobile data all
afternoon. §8 now fixes it: 20s while visible, stop when hidden, immediate revalidate on focus, backoff to a
60s cap when nothing changes, and no timer at all under `saveData`. §2.5-5 makes this a product decision, not
a tuning detail.

**25. Workload assumed everyone is always available — RESOLVED.** §7.4 promises the manager an honest picture
and had no way to know someone is on leave, so the picture was confidently wrong about the one person it
mattered most about. Fix: an `unavailable_until` flag on membership (§4, §9), read by workload and Needs
Attention. **This is not time tracking** — a §3 non-goal — and must not be allowed to grow into it: one date,
no hours, no balances, no approval flow.

**26. Dashboard export stopped at a markdown paste — RESOLVED.** "Copy status summary" suits a chat message
and nothing else; an owner reporting to a client or an investor needs something presentable, and today produces
it by screenshotting. Fix: a print layout, so `Save as PDF` is the browser's job (§7.4). A server-side renderer
would mean Chromium in the container and a queue for a document one person makes once a week. **Khmer must be
embedded in the print layout** — the failure mode is a dashboard that is perfect on screen and prints boxes.

**27. No workspace audit log, and view-as makes that urgent — GAP, blocks slice 1.** §8 builds a per-item
activity feed through the projector registry and stops there, so the events a security review asks about
first — role changes, invitations sent, members removed, permission changes — are recorded nowhere.
§7.13 turns this from a missing feature into a real problem: view-as re-resolves a genuine `ActorContext`
for another member, and an owner who can see through a colleague's eyes with no record of having done so
leaves the product unable to answer *"who looked, and at what."* The table itself is additive; **the write
path is not.** If `withActor` emits audit records as a byproduct of the transaction it already opens, every
mutation is covered by construction. Bolted on afterwards it covers the call sites somebody remembered to
instrument — the exact failure mode §8 chose RLS over a scoped data-access layer to avoid. → §18-11.

**28. A platform operator has no seat at the RLS table — GAP, architectural, blocks slice 1.** Every tenant
table carries `FORCE ROW LEVEL SECURITY`, the application role is deliberately not the owner role, and the
owner role is reserved for migrations. Nothing in this plan says how the company *running* UnifyOps answers a
support ticket, diagnoses one tenant's data, or counts anything across workspaces. This is the only gap in
this pass that is not additive: RLS policies are written once, in slice 1, and they are written differently
for three roles than for two. Settling it after slice 1 means rewriting those policies rather than adding
one. → §18-12.

**29. Auth.js v5 cannot deliver what §8 asked of it — RESOLVED by building the session layer.** §8 named
Auth.js v5 with "email/password + Google, **database sessions**". Those two are mutually exclusive in that
library: its Credentials provider — which §7.1's email-and-password signup requires — supports only the JWT
session strategy. Its Drizzle adapter also needs `INSERT` on `app_user`, which the slice-1 hardening
deliberately revoked from the application role. Resolved toward the plan's *requirement* rather than its
*named dependency*: scrypt from `node:crypto`, an opaque token in an httpOnly cookie, and its SHA-256 in an
`auth_session` row. The database session is what makes three later promises real rather than eventual —
offboarding ends a session now (§7.12), view-as is an exitable context (§7.13), and a role change takes
effect on the next click. Google OAuth is additive behind the same interface, and no beta dependency sits
under the auth layer. §8's stack row is updated.

**30. Signup had no connection it could legitimately run on — RESOLVED with a fourth role.** Slice 1's
hardening left a note that signup would create `app_user` and `workspace` "as the owner". Acting on it would
have put a role that owns every table — and can therefore drop any of them — inside the running web process,
which is the exact failure the owner/app split exists to prevent. But the app role cannot do the work either:
signing in means finding an account by email with no workspace in hand, and every app-role policy is false
when `tenancy.workspace_id()` is NULL. Resolved with **`unifyops_identity`**, a fourth non-owner role for the
pre-tenancy handshake, whose reach is short enough to state: `app_user`, `workspace`, the `auth_*` tables,
`invitation` by token, and on `workspace_member` only the rows of the user it has already authenticated. It
cannot read one row of what a company is *doing*, it has no `CREATE` anywhere, and `invariants.test.ts`
asserts its grant list exactly — so a tenant table added in a later slice is outside it by construction rather
than by anyone remembering to revoke.

**31. Email verification was a gate in a three-minute path — RESOLVED as non-blocking.** §7.1 draws "Verify
email" as a step between signing up and creating a company. Implemented as a gate it puts a mail round trip
inside a flow the same section targets at under three minutes, and makes a provider outage cost the account
rather than the confirmation. The link is still sent at signup and still works; the account is usable
immediately, and a standing banner asks for confirmation on every workspace screen until it is done. The
step is kept, its position in the sequence is not.

---

## 18. Open questions

**Seven resolved, five open.** Nothing blocks the build any more: #11 and #12 were the two that did, and both
are answered below and built in slice 1. The rest never blocked it — #5 and #6 are needed by slice 8, #7 and
#10 are decisions only you can make, and #9 is deferred to Phase 2 by its own dependency.

1. **Brand identity — RESOLVED.** UnifyOps inherits the UnifyCharge palette and typography; both products
   belong to the same company, so a separate identity would be cost without benefit. Nothing to commission —
   §12 is unblocked and the `BRAND` values there are the brand's, not placeholders.
2. **Khmer body font — RESOLVED.** Kantumruy Pro for body text; Koh Santepheap for headings and display
   only. Koh Santepheap is display-weight and is hard to read at 12–14px. The §12 typography table already
   reflects this.
3. **Signup model — RESOLVED.** Invite-only for the first cohort — consistent with shipping without billing
   and without an abuse plan (§17-4). Slice 3 is unblocked.
4. **Estimate unit — RESOLVED.** Points, hidden by default. Hours would claim a precision the product cannot
   back while it has no time tracking.
5. **Attachment storage — RESOLVED (2026-09-03).** **Cloudflare R2.** Nothing in the implementation is
   R2-specific: the driver speaks the S3 API, so a MinIO endpoint is the same four environment variables,
   and switching is a configuration change rather than a code change. Slice 8's attachments are unblocked
   and built.
6. **Hosting and data residency — RESOLVED (2026-09-03).** **No known residency requirement**, to be
   revisited with the pilot customer (#7) — an agency handling government or bank work is the case that
   would change the answer. Until then the bucket is placed for latency rather than jurisdiction. This is
   the answer that let #5 settle.
7. **Pilot customer — OPEN.** A business decision: which real company uses this first. §2's personas are
   reasoned, not researched — one real pilot team would validate or kill several assumptions cheaply. The
   answer also settles #8.
8. **Telegram in v1 or Phase 2 — RESOLVED (Phase 2), revisitable.** Phase 2 by default; reconsidered only if
   the pilot customer (#7) turns out to be strongly chat-first.
9. **Client intake form — OPEN (Phase 2, conditional).** (§17-23) It needs the abuse plan §17-4 defers
   first: rate limiting, spam scoring, attachment handling. *Recommendation: per-client tokenised links
   rather than one open URL — it removes most of the abuse surface and is closer to how an agency actually
   works, since submissions arrive from clients who are already known.*
10. **Holiday calendar maintenance — OPEN (needs an operational answer).** (§17-18) Cambodian public holidays
   are set by sub-decree each year and several move with the lunar calendar, so the seed is not a constant we
   ship once. *Recommendation: seed the current and next year at signup, surface a warning in Settings when
   the calendar runs out, and never silently guess a date the workspace has not confirmed.*
11. **Audit records from `withActor` — RESOLVED.** (§17-27) A second sink on the existing event registry, not
   a blanket "every mutation writes a row" — that duplicates the activity feed and doubles write volume on
   ordinary title edits. Activity and audit differ in scope (item vs workspace), audience (everyone vs
   Owner/Admin), language (translated vs never), and lifetime (follows the item vs append-only), so one table
   cannot serve both without being wrong for one of them. Each registry entry carries an `audit` field,
   exhaustive over the event union exactly as the projectors are, so a new event type cannot be added without
   deciding whether it is auditable. Two details were cheap to settle now and expensive later, and both are
   built: **append-only is enforced by RLS** — `audit_record` has no `UPDATE` or `DELETE` policy, which denies
   both to every application role including Owner, and the matching table privileges are revoked as well, so
   an admin editing the record of their own role change is not a supported operation; and the row carries both
   `actor_user_id` and `on_behalf_of_user_id`, because during view-as the `ActorContext` resolves to the
   target member and a single actor column would make view-as sessions invisible in the log that exists to
   record them.
12. **Platform operator access model — RESOLVED.** (§17-28) A separate operator surface on its own database
   role, with "no cross-tenant access" as its mutation path: a `DATABASE_URL_OPERATOR` role behind its own
   auth boundary, cross-tenant **read** only, and anything that must act inside a workspace goes through an
   invited account plus view-as, which #11 has made auditable. The rejected shape is the session-variable
   bypass: it puts the escape hatch on the connection the app already holds, one `SET` away from any bug that
   can influence session state, and §8's rule — reaching for the owner connection at runtime is the bug, not
   the policy — exists to keep that hatch out of reach. The operator is not a workspace member, so their
   identity lives outside the tenant tables and #11's audit row can name an actor with no membership: hence a
   nullable `actor_user_id` alongside an `actor_kind` of `member`, `operator` or `system`.

---

## 19. Company chat, AI, and MCP (Phase 2)

Four things a company asks for once the work data is real: **a place to talk**, **an assistant that has read
the work**, **the chat app they already live in**, and **a way to point their own AI tools at their own
workspace**. None of it is v1 — §3 lists AI features and a public API as non-goals, and §14 is unchanged by
this section. It is written now for the reason §3-6 exists: each piece attaches to a seam v1 already builds,
and the cheap way to keep that true is to know what will attach before the seam is finished.

| Piece | What it is | Attaches to | Earliest |
| --- | --- | --- | --- |
| **19.3 Group chat** | Channels and DMs inside the workspace | RLS + the realtime seams (§8) | After slice 9 |
| **19.4 AI assistant** | Answers grounded in workspace data, in the asker's language | `withActor` + the event registry (§8) | After chat |
| **19.5 Telegram bridge** | The chat app this market already uses, as a surface | The outbox (§8, slice 9) | After slice 9 |
| **19.6 MCP server** | Each company points its own AI client at its own workspace | The policy module (§10) + token-based `resolveActorContext` | Last |

**Order is deliberate.** The Telegram bridge is the cheapest and the most valuable here (§2.5, §18-8), so it
goes first even though it is listed third. MCP goes last because it is the largest new security surface in
the product's life, and it should be built on top of services that chat and the assistant have already
proven, not alongside them.

### 19.1 The governing rule — an assistant is an actor, never a bypass

Everything in this section runs inside `withActor` with the `ActorContext` of the human who asked, under the
same RLS variables and the same policy module (§10). A model, a bot, or an MCP token never holds a
connection wider than the person on whose behalf it acts.

> **Why this is stated first.** The tempting shortcut is identical to the one §18-12 rejected for the
> platform operator: give the integration the owner connection, or a session variable that turns tenancy
> off, "just for the assistant". That puts the escape hatch on the connection the app already holds. §8's
> rule holds without exception here — reaching for the owner connection at runtime is the bug, not the
> policy. An assistant that cannot answer a question is correct behaviour; an assistant that answers it from
> another company's rows is the end of the product.

Three consequences, all cheap now and expensive later:

- **Retrieval is a query, not a corpus.** Nothing is indexed into an external store that has no
  `workspace_id` on it. If a vector index is added, the workspace is part of the key and the filter, not
  metadata that a bug can drop.
- **Every AI or integration action is an event**, on the existing registry (§8), which makes it auditable by
  construction (§18-11). `actor_kind` gains `assistant` and `integration` alongside `member`, `operator` and
  `system` — that is the whole schema change, and §18-12 already made the column nullable and the enum the
  right shape for it.
- **`on_behalf_of_user_id` is not optional here.** An assistant acting for Sophea writes Sophea in that
  column, exactly as view-as does. An audit log where the AI is the only visible actor records nothing worth
  having.

### 19.2 Chat is not comments — the distinction that has to hold

The §18-11 trap, again: two things that look alike, differ in scope, audience, and lifetime, and must not
share a table.

| | Comment | Chat message |
| --- | --- | --- |
| Scope | One work item | A room — project, team, or DM |
| Lifetime | Follows the item, is part of its record | Follows attention; scrollback, not a record |
| Audience | Whoever can see the item | Channel members |
| Purpose | The decision about *this* work | Getting to that decision |

**A chat message is never the record of a decision.** The single most valuable interaction in this whole
section is therefore not the chat — it is **promoting a message into a work item or a comment in one
action**, carrying the message, its author, and a link back to the thread. That is the thing Telegram cannot
do for the company today (§2.5-2), and the reason chat belongs in the product at all rather than being left
to Telegram entirely.

The corollary is a hard no: **chat must not become a second comment system.** If a discussion belongs on an
item, the product's job is to move it there, not to host it twice.

### 19.3 Group chat — data and tenancy

Ordinary tenant tables, built the way §9 requires and no differently: `channel`, `channel_member`,
`message`, `message_read`, each carrying `workspace_id`, composite foreign keys to the parent, and
`...tenantPolicies()` plus a `FORCE ROW LEVEL SECURITY` line — the same three things adding any table means,
enforced by `invariants.test.ts` rather than by review.

| Concern | Decision |
| --- | --- |
| **Channel kinds** | Project channel (auto-created, membership derived from project membership), team channel, and DM. No workspace-wide "general" at launch — an unread badge nobody can mute is how a product gets muted entirely |
| **Ordering & paging** | Monotonic `seq` per channel, not `created_at`. Keyset cursors only (§9); scrollback is the one surface where offset pagination is guaranteed to be wrong |
| **Read state** | One row per `(channel, member)` holding the last-read `seq`. Unread counts are a comparison, not a per-message table |
| **Edit & delete** | Edit in place with an edited marker; delete is `deleted_at` and leaves a tombstone. Neither rewrites history for someone who has already read it |
| **Search** | The §9 routing unchanged — `tsvector('simple')` for Latin, `pg_trgm` for Khmer, script-detected. Chat is where mixed-script messages are most common, so it is tested with both scripts in one message |
| **Attachments** | The existing presigned direct upload (§8). No second upload path |
| **Realtime** | The v1 seams: `resolveActorContext` resolves from a token so a WebSocket can call it, and the outbox `seq` lets a reconnecting client replay what it missed. Chat is the first feature that actually needs them — until then they stay unused on purpose |
| **Notifications** | Mentions reuse the §7.8 rules exactly, including *never notify the actor*. A per-channel mute is required at launch, not later |

### 19.4 The AI assistant

Scope at first release, all of it read-and-draft, grounded only in what the asker may already see:

- Summarize a long thread, or a channel's day.
- Draft the weekly status from activity — the manager loop of §7.4, and the strongest case in the list.
- Suggest a sub-task breakdown for an item, as a proposal the human edits.
- Translate a comment or a message EN↔KH inline — the highest-value item for a bilingual team (§5), and the
  one nothing else in this market does well for Khmer.
- Answer "what is blocked and who is waiting on me" — the Needs-attention surface (§4) asked in words
  instead of filters.

Rules that make it safe to ship:

- **Proposes, never writes silently.** Every mutation the assistant suggests is applied by a human action.
  The first release has no autonomous write path at all; whether it ever gets one is open (§19.7).
- **Off by default, per workspace.** §6's governing rule applies — a company that never opens Settings is
  fine, and here "fine" means no data reaches a model. Enabling it is an Owner action, and it appears in the
  audit log.
- **Answers in the asker's locale**, and Khmer is not the degraded path (§13). Model output is display text
  only: **no model-generated string is ever written to the database as a translation key** — the §13 rule
  holds without exception.
- **Nothing leaves the workspace boundary that the workspace has not agreed to.** Which provider, and where
  inference runs, ties directly to §18-6 residency and is open (§19.7).

### 19.5 Telegram as the chat surface

Already decided (§18-8): Phase 2, depends on the outbox, cannot land before slice 9. What it does, and the
one rule that keeps it from becoming a second source of truth:

| Direction | Behaviour |
| --- | --- |
| Out | Mention, assignment, and the due-date digest (§7.8) delivered to a linked account, in that member's locale |
| In | Create an item from a message, comment, and change state — the same three actions as the app, no more |
| Never | Telegram is a **surface**, never the record. Nothing exists only in Telegram; every inbound action produces the same event through the same service (§8) |

**Identity linking is the whole security story.** A Telegram account is bound to one workspace member by a
short-lived token the member generates in the app. An unlinked chat can do nothing — not create, not read.
Group chats resolve the *sender*, never the group, so a member's permissions travel with them and a shared
group never becomes a shared identity.

### 19.6 MCP server — one per company, scoped like a member

Companies increasingly want their own AI client — Claude, or anything else speaking MCP — pointed at their
own workspace. The shape that is safe is the one the rest of this plan already forces:

- **A token is minted by an Owner or Admin in Settings**, bound to `(workspace, member, scopes)`. It
  resolves through the same token-based `resolveActorContext` as a session, so RLS and §10 apply unchanged
  and the token can never see more than the member it belongs to. **There is no platform-wide MCP
  credential**, and the operator role (§18-12) is not reachable from MCP at all.
- **Read tools first** — search, list items through the §9 filter DSL, read an item with its comments,
  project and cycle overview. Write tools arrive later, and only behind scopes granted explicitly at mint
  time.
- **Every call is an event and an audit row** (§18-11), `actor_kind = 'integration'`, with the token's
  member in `on_behalf_of_user_id`. Settings shows scope, last-used, and a revoke button; revocation is
  immediate, not on expiry.
- **Tools are a thin layer over the existing services.** An MCP tool that re-implements the list query is a
  second implementation that drifts from the first — the §9 builder is called, not copied.
- **Rejected shape:** an MCP server holding the owner or operator connection and taking a workspace ID as a
  parameter. It is cross-tenant by construction, one bad parameter away from a breach, and it is the same
  session-variable bypass §18-12 already refused.

Sequenced last for a reason: it is effectively the public API from §4's nice-to-have list wearing a
different protocol, and it should ship on services that chat and the assistant have already exercised.

### 19.7 What v1 must not foreclose, and what is still open

Nothing here changes slices 0–16. What it does is name the five properties that must stay true — all of
which are true today:

1. Events stay the **single fan-out point**, and the registry stays exhaustive over the event union.
2. `resolveActorContext` stays **token-based** and free of `next/headers`, so a WebSocket and an MCP request
   can both call it.
3. `actor_kind` stays an enum that can **gain values** — `assistant`, `integration` — without changing what
   the existing ones mean.
4. Services take an `ActorContext`, never a request object, so one service serves a form post, a bot, and a
   tool call.
5. `en.json` / `km.json` parity holds for every string this section adds. Chat and assistant UI roughly
   double the string count, and the §13 rule does not bend for volume.

Open, and deliberately **not** added to §18 — none of it blocks the build:

- **Model provider, and where inference runs.** Tied to §18-6 residency; a Cambodian customer with a
  residency requirement may constrain this before it constrains hosting.
- **Chat scope at launch** — project channels only, or DMs as well. DMs are the larger moderation and export
  surface for a company that later needs records.
- **Whether the assistant ever writes autonomously**, and under what confirmation. The first release does
  not, and that answer should come from watching a pilot (§18-7), not from a design document.
- **MCP write scopes** — which actions are ever grantable to a token, and whether destructive ones are
  simply never on the list.

---

> **Approved for build, 31 August 2026.** Slices 1 and 2 — schema, RLS and `withActor`, then the §10 policy
> module — are implemented. §14 lists what follows.
