import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  appRole,
  operatorRole,
  primaryId,
  tenantPolicies,
  timestamps,
  workspaceIdColumn,
} from './_shared';
import { project } from './project';
import { label, workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * The wiki — spaces, pages, revisions and links (§20.4 — slice 18).
 *
 * **A page is the company's record; a note is one person's thinking** (§20.1).
 * These four tables are the public half of §20's two nouns, and every decision
 * below follows from refusing to merge them with `note`. The two share
 * `documents.ts` — one body format, one parser, one renderer — and no table, no
 * query and no predicate.
 *
 * Four tables where a first sketch has two, and the extra pair earn their keep:
 * `wiki_page_revision` is what makes an edit safe to make (§20.15's "a wiki
 * nobody trusts to edit"), and `wiki_page_link` is what makes a page get read
 * rather than written once.
 */

/**
 * The two kinds of space, and there is no third (§20.2).
 *
 * An enum rather than a boolean because §20.16 leaves open "whether the company
 * space is one space or several" and records that "the migration from one to
 * several is a `kind` value plus a parent". A boolean would have made that a
 * migration over every row; an enum makes it a new value.
 *
 * `src/lib/wiki.ts` holds the same list as `SPACE_KINDS`, which is the rule
 * `roles.ts` set in slice 2: one source of truth for a closed enum, and the
 * `pgEnum` built from it rather than beside it.
 */
export const wikiSpaceKind = pgEnum('wiki_space_kind', ['company', 'project']);

/**
 * A space — the unit of access (§20.5).
 *
 * "The unit of access is the **space**, which is a noun somebody can hold in
 * their head." Per-page permissions are refused for the reason §6-2 defers
 * per-field permissions: a per-object ACL is a second permission system that
 * has to be joined into every list query, shown in every UI, and explained to
 * the non-technical owner of §2.3.
 *
 * **Reading follows the container and needs no §10 row at all.** A project
 * space is readable by whoever can see the project — `project.view`, already
 * written, already composed by `effectiveProjectRole`. The company space is
 * readable by every workspace member and not by Guests, which is the line §10
 * already draws at *See workspace-visible projects*. Only *writing* needed new
 * rows, and it needed exactly two.
 */
export const wikiSpace = pgTable(
  'wiki_space',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    kind: wikiSpaceKind('kind').notNull(),

    /**
     * The project this space documents, and null exactly when `kind` is
     * `company`.
     *
     * Migration 0032 carries the CHECK that pins the correspondence —
     * `num_nonnulls`, the device 0018 already uses for custom field values —
     * because a project space with no project is a space nothing can resolve a
     * permission for, and a company space *with* one is a space whose
     * permission answer depends on which column somebody read.
     */
    projectId: uuid('project_id'),

    /** User content once somebody renames it — never translated, never a key (§13). */
    name: text('name').notNull(),

    /**
     * The seeded name's message key, cleared on rename (§13's awkward middle).
     *
     * The company space is seeded at signup and has to render as "Company" in
     * an English workspace and its Khmer equivalent in a Khmer one, until
     * somebody renames it — after which their literal wins for good. This is
     * exactly `workflow_state.name_key` and `team.name_key`, and
     * `src/lib/seeded-name.ts` is the one place the rule is applied. A screen
     * reading `row.name` directly shows a Khmer workspace the English word.
     *
     * A project space takes the project's own name and carries no key, because
     * the name it is derived from is already the company's own word.
     */
    nameKey: text('name_key'),

    slug: text('slug').notNull(),

    /**
     * The review cycle new pages in this space inherit, in days — or null for
     * *Never*, which is the default default (§21.3 — slice 19).
     *
     * **One column, applied at page creation and overridable per page**, so a
     * space of policies does not depend on somebody remembering on every page.
     * "A company space of policies wants 180 days; a project space of scratch
     * notes wants Never."
     *
     * A number here and a resolved *date* on the page, which is the split §21.3
     * asks for: this is a standing preference later pages inherit, and
     * `wiki_page.verification_expires_at` is a fact about one assertion somebody
     * made on one afternoon. Storing the number on the page instead would make
     * every reader recompute the date, and the first screen to forget the
     * arithmetic would draw a badge that never expires.
     *
     * Bounded in migration 0034 rather than enumerated, for the reason 0028
     * declined to enumerate the locales: `VERIFICATION_DAYS` is a fact about
     * `src/lib/wiki.ts`, and a CHECK listing it would have to be migrated in
     * step with adding a period.
     */
    defaultVerificationDays: integer('default_verification_days'),

    ...timestamps,
  },
  (t) => [
    /** The space list, and the lookup behind `/{slug}/wiki/{spaceSlug}`. */
    unique('wiki_space_slug_key').on(t.workspaceId, t.slug),

    /** The target a child's composite foreign key needs (§9). */
    unique('wiki_space_id_workspace_key').on(t.id, t.workspaceId),

    /**
     * One space per project, and one company space per workspace.
     *
     * A partial unique index expresses the second half and drizzle-kit cannot,
     * so it is in migration 0032 with the CHECK. This one covers the first:
     * `project_id` is null for the company space, and Postgres does not treat
     * two nulls as equal — which is precisely the behaviour wanted here.
     */
    unique('wiki_space_project_key').on(t.workspaceId, t.projectId),

    /**
     * `cascade`. A project space documents its project, so a project that is
     * gone takes its documentation with it — unlike the company space, which
     * has no project to lose.
     *
     * §4 makes project deletion itself a rare, guarded operation; archiving is
     * the ordinary path and archives the space's writability along with it,
     * through the same service check every other archived-project mutation
     * makes.
     */
    foreignKey({
      name: 'wiki_space_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    ...tenantPolicies(),
  ],
);

/**
 * A page (§20.4).
 *
 * The body lives here rather than only in the revision table, which is a
 * denormalization and a deliberate one: every read of a page is a read of its
 * current body, and resolving that through "the revision with the highest
 * number" would put a sort on the hot path of every render and every search
 * index update. The revision table is the *history*; this column is the page.
 */
export const wikiPage = pgTable(
  'wiki_page',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    spaceId: uuid('space_id').notNull(),

    /**
     * The parent page, or null for a root page in the space.
     *
     * `restrict`, and it is §20.3.6's rule made physical: "Children are
     * reparented to the deleted page's parent, never deleted with it — the rule
     * `deleteCycle` follows and `work_item_state_fk` enforces: deleting a
     * container must never decide the fate of what is inside it." A page is only
     * ever *soft*-deleted, so the service reparents and this constraint is the
     * second layer, exactly as slice 11 arranged it for a cycle's items.
     */
    parentId: uuid('parent_id'),

    /**
     * The root of this page's subtree, and how deep it sits — **maintained in
     * the database** (§20.4).
     *
     * The same pair `work_item` has carried since migration 0008, for the same
     * reason and with the same trigger shape in 0032: "a row written by a seed
     * script, a Markdown importer or a Phase 2 MCP tool has to be as correct as
     * one the service wrote". `depth` is 1-based and capped at 3, and the
     * trigger propagates a move through the whole subtree rather than trusting
     * the caller to.
     */
    rootId: uuid('root_id').notNull(),
    depth: integer('depth').notNull().default(1),

    /**
     * Sibling order, rewritten as a block (§20.4).
     *
     * "This is `workflow_state`'s call (slice 4), not the board's (slice 6), and
     * for the same reason: fractional ranking exists because several people drag
     * cards on one board at once, and a documentation sidebar reordered by one
     * person is not that. `rank.ts` stays a work-item concern."
     */
    position: integer('position').notNull().default(0),

    slug: text('slug').notNull(),
    /** User content — never translated, never a key (§13). */
    title: text('title').notNull(),

    /**
     * One emoji, or nothing — the page's icon (§21.2, slice 20).
     *
     * **A grapheme in a `text` column, not an icon name and not an upload.** An
     * icon *set* would be a name resolving to a component, which is a second
     * vocabulary to build, translate and explain; an uploaded image would be a
     * second `attachment` shape for a 16px square, and slice 15 already refused
     * that trade for the workspace logo at a far larger size. An emoji is text
     * the writer's own keyboard produces, it renders in both scripts with no
     * asset, and it survives §21.8's export as itself.
     *
     * Nullable, because a page with no icon is the overwhelming default and must
     * not be a page with a *chosen* blank — the distinction slice 15 drew for
     * the workspace accent, where storing "unchosen" as a default made the
     * default unrecoverable.
     *
     * **The one-grapheme rule is enforced in two places that do different
     * amounts of work, and the difference is stated rather than blurred.**
     * `normalizePageIcon` counts with `Intl.Segmenter` and is exact — a flag or
     * a skin-toned emoji is several code points that render as one character,
     * and counting the other way would refuse icons that fit (§13). Postgres has
     * no grapheme segmentation, so 0036's CHECK is a *floor*: no whitespace, and
     * at most 16 code points, which is longer than any single emoji sequence and
     * far shorter than a sentence. That is the honest division — the database
     * refuses what is obviously not an icon, for the reason every other
     * invariant here is in the database (a row written by §21.8's importer has
     * to be as correct as one the service wrote), and the service refuses what
     * only a grapheme segmenter can see.
     */
    icon: text('icon'),

    /**
     * Markdown, in a `text` column (§20.7), parsed by `src/lib/documents.ts` —
     * the same format and the same parser a note's body uses.
     *
     * Text rather than a document tree for §20.7's four reasons, of which the
     * one that decides it is that "revisions compare as text, search indexes it
     * as text, and slice 14's `search_text` recipe works on it unchanged. A
     * ProseMirror or Lexical document is JSON whose schema belongs to the
     * editor, so changing editors becomes a migration over every revision ever
     * written."
     *
     * Not null with an empty default, because §20.11 says an empty page "reads
     * as empty, not as broken" — a page created as a placeholder is a real page.
     */
    body: text('body').notNull().default(''),

    /**
     * The concurrency token (§20.3.3, §20.4).
     *
     * "**`revision_no` is the concurrency token, it lives on the page, and it is
     * not derived.** A save takes the number it was based on and updates
     * conditionally; a mismatch is the refusal at §20.3.3. Derived from the
     * revision table it would be a second query inside the hot path of every
     * save, and the answer could change between the two statements."
     *
     * This is the rule the board deliberately does **not** follow, and the
     * contrast is the point (§20.3.3): a stale drag lands correctly relative to
     * present state, because a card's position is small and recoverable and
     * re-deriving it is what the human meant. A document body is neither.
     * Last-write-wins on a paragraph somebody spent twenty minutes on destroys
     * work with no trace, and a three-way merge of prose produces a sentence
     * neither person wrote. So the thing that can be re-derived is re-derived,
     * and the thing that cannot is refused out loud.
     */
    revisionNo: integer('revision_no').notNull().default(1),

    /**
     * The person answerable for this page being true (§21.3 — slice 19).
     *
     * **Not its author, and not necessarily its last editor.** Those two are
     * already recorded, completely and append-only, in `wiki_page_revision`;
     * this is a different fact, and the one that decides whether the wiki
     * survives its second year. §21.3: the risk that matters by then is "a wiki
     * everybody writes in and nobody can trust, where the onboarding page
     * describes a process that changed in March and the new hire follows it
     * anyway".
     *
     * Nullable, and *owned by nobody* is a real and visible state rather than a
     * gap — it is one of the All-pages view's filters precisely so somebody can
     * find them. A page nobody has claimed is the honest starting point for
     * every page ever written.
     *
     * `restrict`, joining `wiki_page_revision_author_fk` on the surviving half
     * of §20.5's asymmetry — and it is never actually exercised, because
     * offboarding *soft*-deletes a membership. §7.12's removal nulls this column
     * explicitly inside `removeMember`'s own transaction (§21.3: "the removal
     * nulls the column rather than deleting anything"), which is also why this
     * is not `set null`: on a composite key `SET NULL` nulls **every** column,
     * `workspace_id` included — the trap slice 11 documented on the cycle key.
     */
    ownerMemberId: uuid('owner_member_id'),

    /**
     * When somebody last asserted this page is accurate, and who (§21.3).
     *
     * **Both are set and cleared together, under a CHECK in migration 0034,
     * because half of this pair is not a fact.** A `verified_at` with no author
     * is an assertion nobody made; an author with no timestamp is an assertion
     * with no date, and a verification whose date is unknown is exactly as
     * useful as no verification. `num_nonnulls(...) IN (0, 2)` — 0018's device,
     * pointed at a pair rather than at a value column.
     *
     * `restrict` on the author for `wiki_page_revision`'s reason: who vouched
     * for the company's record is part of the company's record.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByMemberId: uuid('verified_by_member_id'),

    /**
     * When the assertion lapses, or null for *no review cycle* (§21.3).
     *
     * **Null is the default and must stay it** — "which is right for most pages
     * and must stay the default". A product that put every page on a review
     * calendar would be handing §2.3's non-technical owner an obligation, which
     * is the failure §21.0 quotes from the survey's own limitations table:
     * "with no imposed structure, undisciplined workspaces become sprawling and
     * unfindable. Governance is on you."
     *
     * A `date` rather than a `timestamptz`, unlike `verified_at` beside it, and
     * the difference is not an oversight. *When somebody clicked verify* is an
     * instant. *When this lapses* is a calendar day, compared against the
     * **workspace's** today (§17-13) by `verificationStatus` — the same shape
     * and the same comparison `cycle.start_date` and `end_date` have carried
     * since slice 11, and for the same reason: a shared deadline has to mean one
     * thing in two timezones.
     */
    verificationExpiresAt: date('verification_expires_at'),

    /**
     * §13's two-index search recipe, on the same generated column slice 14
     * built for `work_item` (0025) and slice 17 for `note` (0029).
     *
     * **One column feeding both routes is the §13 requirement, not an
     * optimisation** (§20.8): "If each corpus detected script its own way, a
     * mixed-script query would find items and miss pages, and the bug report
     * would be a Khmer page nobody could find." Generated rather than
     * trigger-maintained, so nothing can write a row that is unsearchable.
     *
     * The title is concatenated ahead of the body because a page is usually
     * found by its name, and `coalesce` rather than `concat_ws`, which is STABLE
     * and which a generated column will not take.
     */
    searchText: text('search_text').generatedAlwaysAs(
      sql`btrim(lower(translate(title || ' ' || coalesce(body, ''), U&'\\200B\\200C\\200D\\FEFF', '')))`,
    ),

    /**
     * Soft delete, with §4's 30-day recovery window (§20.3.6).
     *
     * A page is a company record and a deleted one is recoverable on the screen
     * items already use. It is also why a reference to a deleted page renders as
     * "a deleted page" rather than breaking — the row is still there to be named.
     */
    ...timestamps,
  },
  (t) => [
    /** The sidebar: one space's tree, in sibling order. */
    index('wiki_page_space_idx').on(t.spaceId, t.parentId, t.position),

    /** `/{slug}/wiki/{spaceSlug}/{pageSlug}`. Unique per space, not per workspace. */
    unique('wiki_page_slug_key').on(t.spaceId, t.slug),

    /**
     * The target a child's composite foreign key needs (§9) — and this table has
     * four children: its own `parent_id`, the revision, the link, and (since
     * §20.9) an attachment.
     */
    unique('wiki_page_id_workspace_key').on(t.id, t.workspaceId),

    /** The subtree read behind a move and a delete. */
    index('wiki_page_root_idx').on(t.rootId),

    /**
     * The digest's question, asked once an evening per workspace: *which pages
     * does this person own that lapse soon* (§21.3).
     *
     * Partial on the owner, because the overwhelming majority of pages have none
     * and an index over those is an index of nulls. The expiry rides along so
     * the horizon comparison is served by the same scan rather than by a filter
     * on top of it.
     */
    index('wiki_page_owner_idx')
      .on(t.ownerMemberId, t.verificationExpiresAt)
      .where(sql`${t.ownerMemberId} is not null and ${t.deletedAt} is null`),

    /**
     * The All-pages view, and the standing count in the space header.
     *
     * Keyed on the space first because §21.3 makes that view "one query over one
     * space" — anchored by the space exactly as every other page query is, which
     * is what keeps it outside §9's builder without being outside §16's rule.
     */
    index('wiki_page_verification_idx').on(t.spaceId, t.verificationExpiresAt),

    foreignKey({
      name: 'wiki_page_space_fk',
      columns: [t.spaceId, t.workspaceId],
      foreignColumns: [wikiSpace.id, wikiSpace.workspaceId],
    }).onDelete('cascade'),

    /**
     * `restrict` — §20.3.6's rule, and the same call `work_item_state_fk` and
     * slice 11's cycle key make. Deleting a container must never decide the fate
     * of what is in it.
     */
    foreignKey({
      name: 'wiki_page_parent_fk',
      columns: [t.parentId, t.workspaceId],
      foreignColumns: [t.id, t.workspaceId],
    }).onDelete('restrict'),

    /**
     * Both member references are `restrict`, and neither is ever exercised by an
     * offboarding — §7.12 soft-deletes a membership, so the row stays and the
     * service nulls `owner_member_id` itself. What these refuse is a *hard*
     * delete of a member who owned or vouched for a page, which is the same
     * thing `wiki_page_revision_author_fk` refuses and for the same reason
     * (§20.5): a page is the company's record and stays attributed.
     */
    foreignKey({
      name: 'wiki_page_owner_fk',
      columns: [t.ownerMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    foreignKey({
      name: 'wiki_page_verifier_fk',
      columns: [t.verifiedByMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    ...tenantPolicies(),
  ],
);

/**
 * A revision — the whole body, every save (§20.2, §20.4).
 *
 * **Append-only, and it writes its policies by hand** rather than calling
 * `tenantPolicies()`, joining `audit_record` and `activity` for the reason §20.4
 * states in one sentence: "A revision that can be edited is not a history."
 * No `UPDATE` policy, no `DELETE` policy, and migration 0032 revokes the
 * matching privileges from the app role so the absence is enforced twice.
 *
 * **A revision holds the whole body, not a diff** (§20.4). "A diff chain that
 * loses one link loses everything after it, and every read of an old version
 * becomes a replay. A page body is kilobytes; a company writing a thousand pages
 * and revising each fifty times is tens of megabytes, which is not a problem
 * worth a reconstruction algorithm." `diffLines` in `src/lib/wiki.ts` computes a
 * comparison at read time from two whole bodies, which is the cheap direction.
 *
 * **Restore writes a new revision whose body is an old one.** Nothing is ever
 * removed from the history, which is what makes the history worth having — and
 * what makes §20.15's "the cost of a bad edit has to be visibly one click" true.
 */
export const wikiPageRevision = pgTable(
  'wiki_page_revision',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    pageId: uuid('page_id').notNull(),

    /** Matches `wiki_page.revision_no` at the moment this revision was current. */
    revisionNo: integer('revision_no').notNull(),

    /** The title as well as the body: a rename is a change to the page worth seeing. */
    title: text('title').notNull(),
    body: text('body').notNull(),

    /**
     * Who wrote it — the member, like everything else that records who did
     * something inside a workspace.
     *
     * `restrict`, and this is the half of §20.5's asymmetry that survives:
     * "Pages are the company's record and survive, attributed, exactly as
     * activity does. Notes are destroyed with the membership." So this key
     * refuses where `note_owner_fk` cascades, and the two constraints beside
     * each other are the asymmetry made physical.
     */
    authorMemberId: uuid('author_member_id').notNull(),

    ...timestamps,
  },
  (t) => [
    /** The history screen: one page's revisions, newest first. */
    index('wiki_page_revision_page_idx').on(t.pageId, t.revisionNo),

    /**
     * Two revisions cannot claim one number.
     *
     * The conditional update on `wiki_page.revision_no` is what actually
     * serialises concurrent saves (§20.3.3); this is the constraint that makes a
     * bug in that logic a failed transaction rather than a history with two
     * versions of revision 4 and no way to say which is which.
     */
    unique('wiki_page_revision_no_key').on(t.pageId, t.revisionNo),

    foreignKey({
      name: 'wiki_page_revision_page_fk',
      columns: [t.pageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'wiki_page_revision_author_fk',
      columns: [t.authorMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    /**
     * The append-only set, written by hand (§20.4).
     *
     * `tenantPolicies()` grants all five; these are three. The absent `UPDATE`
     * and `DELETE` are the whole point, and 0032 revokes the privileges as well
     * so a policy added carelessly later still cannot open the table.
     *
     * `INSERT` carries `not tenancy.is_read_only()` — unlike `audit_record`,
     * which is the one table whose insert policy does not, because a view-as
     * session refuses mutations but must still be recorded. A revision is the
     * opposite: a view-as session must write nothing into the company's record.
     */
    pgPolicy('tenant_select', {
      for: 'select',
      to: appRole,
      using: sql`"workspace_id" = tenancy.workspace_id()`,
    }),
    pgPolicy('tenant_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`"workspace_id" = tenancy.workspace_id() and not tenancy.is_read_only()`,
    }),
    pgPolicy('operator_select', { for: 'select', to: operatorRole, using: sql`true` }),
  ],
);

/**
 * A page ↔ work item link (§20.2, §20.6).
 *
 * "A page links to work items and an item lists its pages — the thing that
 * makes a wiki get read rather than written once." §20.15 names it as half the
 * mitigation for the feature's biggest risk, the other half being the note as an
 * on-ramp: "a page reached from work is a page that gets read".
 *
 * A join table rather than a column on either side, because the relation is
 * many-to-many by nature — an architecture page is linked from every task that
 * touches it — and because `wiki_page.linked` is the one wiki event that
 * projects into a *work item's* activity feed (§20.6), which needs a row with
 * both ids and an author.
 */
export const wikiPageLink = pgTable(
  'wiki_page_link',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    pageId: uuid('page_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),

    /** Who made the connection, for the feed line the item gets. */
    createdByMemberId: uuid('created_by_member_id').notNull(),

    ...timestamps,
  },
  (t) => [
    /**
     * One link, not a bag (§20.4: "`(page_id, work_item_id)`, unique").
     *
     * `parsePageIds` already de-duplicates within a body for the matching
     * reason; this is what makes linking the same page from two places one row
     * rather than two identical ones nobody can tell apart.
     */
    unique('wiki_page_link_key').on(t.pageId, t.workItemId),

    /** The item page's "related pages" panel, read the other way round. */
    index('wiki_page_link_item_idx').on(t.workItemId),

    /**
     * `cascade` on both sides, and it is the right answer here where it was
     * wrong for a cycle: a link is not a thing in its own right. A link to a
     * page that no longer exists is not a record of anything — unlike a note,
     * whose pin survives its item because the *note* is still the person's.
     */
    foreignKey({
      name: 'wiki_page_link_page_fk',
      columns: [t.pageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'wiki_page_link_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    /** `restrict`: who linked it is part of the item's history (§7.12). */
    foreignKey({
      name: 'wiki_page_link_author_fk',
      columns: [t.createdByMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    ...tenantPolicies(),
  ],
);

/**
 * A page ↔ label link (§21.3 — slice 19).
 *
 * **Tags are `label`, not a second vocabulary**, and that is the whole of this
 * table's justification. §21.3: "Slice 5 made labels workspace vocabulary
 * managed under `workspace.settings`, with `LABEL_COLORS` and `LabelChip`
 * already built and already bilingual. A second tagging system for pages would
 * be a second settings screen, a second colour set and a second thing to explain
 * to §2.3's owner."
 *
 * So this is `work_item_label` with one column renamed — deliberately, down to
 * the constraint names, because the day somebody wants "everything tagged
 * *security*" across both nouns the two halves have to be the same shape. What
 * it costs is one join table; what it saves is a settings screen, a palette and
 * a paragraph of explanation.
 *
 * **No §10 row, the thirteenth time that decision has gone the same way** —
 * after labels, attachments, notifications, custom fields, cycles, saved views,
 * availability, search, the holiday calendar, settings, password reset and
 * notes. Applying a label to a page is *writing in that space*, which §20.5's
 * two rows already govern, exactly as applying one to a work item has been
 * `work_item.edit` since slice 5. An Owner decides what tags exist; anyone who
 * can write can apply one.
 */
export const wikiPageLabel = pgTable(
  'wiki_page_label',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').notNull(),
    labelId: uuid('label_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('wiki_page_label_key').on(t.pageId, t.labelId),

    /** "Every page tagged *policy*" — the read that makes tagging worth doing. */
    index('wiki_page_label_label_idx').on(t.labelId),

    /**
     * `cascade` on both sides, for `wiki_page_link`'s reason: a tag on a page
     * that no longer exists is not a record of anything, and deleting a label
     * from the workspace's vocabulary should take its applications with it —
     * which is exactly what `work_item_label` already does, and what makes
     * §7.11's "renaming preserves values" true for the label case too.
     */
    foreignKey({
      name: 'wiki_page_label_page_fk',
      columns: [t.pageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'wiki_page_label_label_fk',
      columns: [t.labelId, t.workspaceId],
      foreignColumns: [label.id, label.workspaceId],
    }).onDelete('cascade'),

    ...tenantPolicies(),
  ],
);

/**
 * A page → page reference, **derived from the body** (§21.4 — slice 20).
 *
 * "`wiki_page_ref (from_page_id, to_page_id, workspace_id)`, unique on the pair,
 * composite tenant keys on both sides. It is derived and rebuilt on every save
 * from the `#[uuid]` tokens in the body — the same diff `saveWikiPage` already
 * performs for mentions, in the same transaction, against the body the
 * conditional update has just proved was current."
 *
 * **Two kinds of edge, and this is the derived one.** §20.0 found the
 * distinction the hard way and §21.4 states it: `wiki_page_link` is *authored* —
 * somebody attached a page to a work item, it has an author, it emits an event,
 * it appears in the item's activity feed, and removing the sentence that
 * mentioned the item does **not** remove it. This table is the opposite in every
 * one of those: it is a projection of the body, it has no author, it emits
 * nothing, and it disappears when the sentence does. Merging the two would mean
 * either an edit silently detaching a link somebody made on purpose, or a
 * reference outliving the paragraph that made it.
 *
 * **It is rebuilt, never appended to**, which is §21.15's mitigation and
 * §21.13's definition of done for this slice. Because it is a projection it can
 * be regenerated from the bodies if it is ever wrong — a property worth keeping
 * deliberately, and the reason there is no `created_by_member_id` here: nobody
 * *made* these rows, a save computed them.
 *
 * **No `created_at`, and that is the same argument.** A derived row has no date
 * worth recording: it was written by the last save of the source page, whose
 * timestamp is on the page and in its revision history. Storing one would invite
 * a screen to say "linked on 3 March", which would be a fact about a rebuild.
 *
 * **No §10 row — the fourteenth time that decision has gone the same way**,
 * after labels, attachments, notifications, custom fields, cycles, saved views,
 * availability, search, the holiday calendar, settings, password reset, notes
 * and slice 19's verification. Writing a reference is *writing in that space*,
 * which §20.5's two rows already govern; reading one back is bounded by the
 * spaces the reader can already see, which `readableSpaceIds` resolves before
 * any backlink query is built.
 */
export const wikiPageRef = pgTable(
  'wiki_page_ref',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /** The page whose body contains the token. */
    fromPageId: uuid('from_page_id').notNull(),
    /** The page the token names. */
    toPageId: uuid('to_page_id').notNull(),
  },
  (t) => [
    /**
     * One edge, not a bag. `parsePageIds` already de-duplicates within a body
     * for the matching reason, so referencing one page from three paragraphs is
     * one row — and "what links here" lists a page once however many times it
     * mentioned this one.
     */
    unique('wiki_page_ref_key').on(t.fromPageId, t.toPageId),

    /**
     * **The backlink index, and the reason this table exists at all.** §21.4's
     * "what links here" reads the pair the other way round, which is the
     * direction no body can answer without scanning every body in the workspace.
     */
    index('wiki_page_ref_to_idx').on(t.toPageId),

    /**
     * `cascade` on both sides, for `wiki_page_link`'s reason: an edge to or from
     * a page that no longer exists is not a record of anything.
     *
     * This only ever fires on a *hard* delete, which pages do not normally have
     * — §20.3.6 makes deletion soft with a 30-day window. A soft-deleted page
     * keeps its edges, which is what lets §21.4's "a deleted page's references
     * render as 'a deleted page'" be true, and what makes a restore restore the
     * backlinks with it rather than needing every referring page re-saved.
     */
    foreignKey({
      name: 'wiki_page_ref_from_fk',
      columns: [t.fromPageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'wiki_page_ref_to_fk',
      columns: [t.toPageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
    }).onDelete('cascade'),

    ...tenantPolicies(),
  ],
);
