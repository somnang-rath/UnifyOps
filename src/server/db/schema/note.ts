import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { wikiPage } from './wiki';
import { workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * A note — one person's thinking (§20.1, §20.4 — slice 17).
 *
 * **This is a separate table from the wiki page slice 18 adds, and the
 * separation is the whole design.** §20.1: they "look like one table with a
 * `visibility` column, and that shape is wrong in the way this plan has already
 * refused twice. Merged, every query that touches either has to read *the §10
 * project rule **or** `owner_member_id = me`*, and the first query written that
 * forgets the second half shows a colleague somebody's private notes." RLS
 * cannot catch that, because both people are in one workspace. So the
 * separation is structural: two tables, two predicates, one editor.
 *
 * Four consequences follow from that and are visible here rather than only in
 * the plan:
 *
 * - **No §10 row, and there can never be one** (§20.5). What stops one person
 *   reaching another's note is `owner_member_id` in every predicate, underneath
 *   the RLS that has already scoped the row to the workspace. Nothing about a
 *   note is a question of role, so `notes.test.ts` asserts the owner predicate
 *   *directly* — a test that only counted returned rows would still pass with
 *   the predicate deleted.
 * - **No events at all** (§20.6). Not audit, not activity, not notification. An
 *   Owner-visible, permanent, append-only record of what somebody privately
 *   jotted down is surveillance rather than governance. This is `saved_view`'s
 *   call from slice 12, taken further and for a stronger reason.
 * - **A note dies with the membership** (§20.5), which is why the owner key
 *   below is the one `cascade` where `comment` and `activity` are `restrict`.
 *   Those preserve the company's record; this is the opposite promise.
 * - **Ordinary `tenantPolicies()`, all five.** A note is something a person
 *   wrote and may edit or retract, not a projection of an event — the same
 *   reasoning `comment` uses for taking the full set where `activity` writes
 *   its own append-only ones.
 */
export const note = pgTable(
  'note',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /**
     * Whose note this is — the member, not the user, like everything else that
     * records who did something inside a workspace.
     *
     * Every predicate in `queries/notes.ts` carries this column. It is the
     * access control, and there is no second one.
     */
    ownerMemberId: uuid('owner_member_id').notNull(),

    /**
     * Nullable, and null is the ordinary case (§20.4).
     *
     * "A note's `title` is nullable and the display title is derived — the first
     * line, truncated by grapheme. Stored, it would be a copy of a string the
     * body already holds, and the two would disagree the first time somebody
     * edited the opening line." `noteTitle` in `src/lib/notes.ts` is the one
     * place that derivation happens.
     */
    title: text('title'),

    /**
     * Markdown, in a `text` column (§20.7) — the same format a wiki page's body
     * will be, parsed by the same `src/lib/documents.ts`. Notes are where that
     * format gets exercised before there is a corpus written in it, which is
     * §20.13's whole reason for putting slice 17 first.
     */
    body: text('body').notNull(),

    /**
     * §20.3.1's `[!]`: a note captured while looking at an item can be pinned to
     * it.
     *
     * **A pin, not a parent** (§20.4), and it is the one place in this schema
     * where `ON DELETE SET NULL` is right: a note whose item was deleted is
     * still the person's note. That is the opposite of slice 11's cycle key,
     * which refuses — deleting a container must not decide the fate of what is
     * in it, and a cycle *holds* work where an item merely happens to be what a
     * note was about. The single-column key is what makes `SET NULL` safe here,
     * which it was not there: a composite key would null `project_id` and
     * `workspace_id` along with it.
     *
     * The trade is §9's composite-key device, which is what normally makes it
     * physically impossible to reference a parent in another workspace. What
     * replaces it is narrower but real: the pin is only ever written by
     * `pinNote`, which reads the item through `withActor` first — so RLS has
     * already refused an item outside the workspace before the id reaches this
     * column. Stated here rather than discovered later, because this is the one
     * tenant column in the schema not held honest by a key.
     */
    workItemId: uuid('work_item_id').references(() => workItem.id, { onDelete: 'set null' }),

    /**
     * What this note became, if it became something (§20.3.4).
     *
     * **Promotion is a copy, never a move**, and this column is the only trace
     * it leaves. §20.1 is explicit about why: a move "would be the one operation
     * that silently changes who can read something, and it would do it from the
     * one screen whose whole promise is that nobody else can". So the note stays
     * where it was and remembers what came out of it.
     *
     * One column rather than a history table, and it holds the most recent
     * promotion. A note may be promoted twice — it is a copy, nothing stops it —
     * and recording every one would be an append-only table whose only reader is
     * a single line of courtesy text. Slice 18 adds the page column beside this
     * one; a note can become either.
     *
     * `set null` for the reason the pin is: the item this note became may be
     * deleted later, and the note is still the note.
     */
    promotedWorkItemId: uuid('promoted_work_item_id').references(() => workItem.id, {
      onDelete: 'set null',
    }),

    /**
     * The page this note became, if it became one (§20.3.4) — the column slice
     * 17's comment above promised slice 18 would add beside its sibling.
     *
     * Same rule, same reason: **promotion is a copy, never a move**, so this is
     * a memory rather than a relocation, and `set null` because the page may be
     * deleted later and the note is still the note.
     *
     * Two columns rather than one polymorphic pair, for the reason the
     * notification subject is two columns: a polymorphic id cannot carry a
     * foreign key, and a dangling promotion pointer would render as a link to
     * nothing. A note may be promoted to both — it is a copy, nothing stops it —
     * and both are then true at once, which is why there is no CHECK here where
     * the notification subject has one.
     */
    promotedPageId: uuid('promoted_page_id'),

    /**
     * §13's two-index search recipe, on the same generated column slice 14
     * built for `work_item` (migration 0025).
     *
     * **One column feeding both routes is the §13 requirement, not an
     * optimisation**: if the Latin and Khmer routes read different text the two
     * languages would be searching different corpora, and the first bug report
     * would be a Khmer note nobody could find. Generated rather than maintained
     * by a trigger, for the reason `work_item.search_text` is: no seed script,
     * importer or Phase 2 MCP tool can write a row that is unsearchable.
     *
     * The title is included though it is usually null, because a note *with* a
     * set title is one somebody named deliberately and would expect to find by
     * that name. `coalesce` rather than `concat_ws`, which is STABLE and which a
     * generated column will not take.
     */
    searchText: text('search_text').generatedAlwaysAs(
      sql`btrim(lower(translate(coalesce(title, '') || ' ' || body, U&'\\200B\\200C\\200D\\FEFF', '')))`,
    ),

    /**
     * Soft delete, and duller than `comment`'s: nothing renders a tombstone for
     * a note, because nobody else was in the conversation. It is here because
     * `deleted_at` is on every table through `timestamps`, and because §4's
     * 30-day recovery window is a promise about a company's data that a note is
     * not excluded from.
     */
    ...timestamps,
  },
  (t) => [
    /**
     * The one read there is: this person's notes, newest first.
     *
     * Keyed on the owner because every query is, and the id breaks ties in
     * insert order because a UUIDv7 does — the same construction the comment
     * thread uses, pointed the other way round because a note list is read
     * backwards from now.
     */
    index('note_owner_idx').on(t.ownerMemberId, t.createdAt, t.id),

    /** §20.3.1's `[!]` read the other way: the notes pinned to this item. */
    index('note_item_idx').on(t.workItemId),

    /**
     * `cascade`, and it is the one place in the schema where an offboarding
     * cascade is the *right* answer (§20.5).
     *
     * §7.12 promises activity history is "preserved and attributed", which is
     * why `comment` and `comment_mention` are `restrict`. That promise is about
     * the company's record. A note is the opposite: "handing a departing
     * member's private thinking to their manager on the day they leave is the
     * opposite of what the word *private* promised them."
     *
     * Offboarding soft-deletes the membership rather than deleting the row, so
     * this constraint is the backstop and `offboardMember` does the destroying
     * explicitly — and the dialog says so before the click, because "their notes
     * will be deleted" is a fact somebody may want to act on first.
     */
    /**
     * §9's composite device, where the pin above could not have it: a promoted
     * page is written by `promoteNoteToPage`, and the key holds the workspace
     * honest as well.
     */
    foreignKey({
      name: 'note_promoted_page_fk',
      columns: [t.promotedPageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
    }).onDelete('set null'),

    foreignKey({
      name: 'note_owner_fk',
      columns: [t.ownerMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),

    ...tenantPolicies(),
  ],
);
