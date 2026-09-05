import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
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
import { workItem } from './work-item';
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
