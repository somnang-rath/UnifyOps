-- =============================================================================
-- Slice 17 hardening: FORCE RLS on `note`, the bounds a note has to satisfy
-- however it was written, and §13's two-index search recipe applied to a second
-- corpus.
--
-- The same first job as 0002, 0004, 0006, 0008, 0010, 0012, 0014, 0016, 0018,
-- 0020, 0022, 0024, 0026 and 0028: every table here is owned by unifyops_owner,
-- and a table owner is exempt from its own row-level security unless the table
-- FORCEs it. drizzle-kit emits ENABLE and nothing else, so without this line the
-- migration role could read across every workspace — and invariants.test.ts
-- fails any table in `public` that is missing one.
--
-- Worth stating once, here, because it is the thing about this table somebody
-- will look for: **RLS is not what makes a note private.** RLS scopes rows to a
-- workspace, and the person a note must be hidden from is a colleague *in* that
-- workspace. What makes it private is `owner_member_id` in every predicate
-- (§20.5), asserted directly by the tenancy suite rather than inferred from a
-- row count. FORCE RLS is still required and still does its own job — it is
-- simply not this table's headline.
-- =============================================================================

ALTER TABLE "note" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- The bounds a note has to satisfy ----------------------------------------
-- `validateNote` in src/lib/notes.ts checks both of these, and both are here
-- anyway, for the reason slice 5 put `root_id`/`depth` in 0008, slice 10 the
-- value CHECK in 0018, slice 11 the date range in 0020 and slice 12 the query
-- bound in 0022: a row written by a seed script, a Markdown importer or a Phase
-- 2 MCP tool has to be as correct as one written by the service.

-- §20.3.1 gives a note no title field, no folder and no project — the body is
-- the whole of what a note is. An empty one is not something somebody wrote; it
-- is a composer somebody opened and left, and it would render in the list as a
-- row with nothing on it and no way to tell what it was for.
ALTER TABLE "note"
  ADD CONSTRAINT "note_body_present"
  CHECK (length(btrim("body")) > 0);--> statement-breakpoint

-- `MAX_NOTE_LENGTH`, in code points rather than in graphemes, and the gap is
-- deliberate. The service counts graphemes because that is the number a person
-- experiences (§13); Postgres has no grapheme function without an extension we
-- are not adding for a bound. So this is a *ceiling above* the real cap —
-- generous enough that no body the service would accept can hit it, tight
-- enough that no single row can be unbounded. A Khmer syllable is at most a
-- handful of code points, so four times the grapheme cap clears every script
-- this product ships in.
--
-- The number is duplicated from src/lib/notes.ts for the reason 0020's 366 and
-- 0022's 2048 are: this file is applied once by a migration and imports
-- nothing. The unit test pins the TypeScript side; this pins everything else.
ALTER TABLE "note"
  ADD CONSTRAINT "note_body_bounded"
  CHECK (length("body") <= 80000);--> statement-breakpoint

-- --- §13's search, on a second corpus ----------------------------------------
-- The same two indexes migration 0026 created for `work_item`, over the same
-- generated `search_text` column, because §20.8 is explicit that pages and
-- notes "reuse everything *above* the query" rather than inventing a second
-- recipe: `searchRoute`, `hasKhmer`, `toTsQuery`, `toLikePattern` and
-- `MIN_QUERY_LENGTH` all stay the only place those decisions are made.
--
-- "One routing rule, three corpora. If each corpus detected script its own way,
-- a mixed-script query would find items and miss notes, and the bug report would
-- be a Khmer note nobody could find."

-- The Latin route. `simple` and not `english`, for 0026's reason: a stemmer
-- drops "no" and "off" as stopwords, and "No build off master" is exactly the
-- line somebody jots down. The query must use this exact expression or the
-- planner will not reach for the index.
CREATE INDEX "note_search_fts_idx"
  ON "note" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint

-- The Khmer route. Khmer has no inter-word spaces, so `to_tsvector` sees one
-- enormous token and only that whole string could ever match it; a trigram
-- substring match is the one thing that finds a word inside it (§13).
--
-- On the column rather than on an expression, because the predicate is
-- `search_text LIKE '%…%'` and `gin_trgm_ops` can only serve a LIKE against the
-- indexed value. The column is generated `lower(...)` precisely so this can be
-- LIKE rather than ILIKE.
CREATE INDEX "note_search_trgm_idx"
  ON "note" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint

-- --- The index that would be wrong here --------------------------------------
-- There is no index on `(owner_member_id, search_text)` and there cannot
-- usefully be one: a GIN index takes the text, and the owner predicate is an
-- equality Postgres applies as a filter over the far smaller candidate set the
-- GIN index returns. `note_owner_idx` (0029) serves the list; these two serve
-- the search; the planner combines them. Written down because the obvious
-- reaction to "every note query carries the owner" is to add a composite index
-- that a GIN access method will not build.

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010 through 0028 all give: the pre-tenancy handshake is the
-- moment before a workspace is known, and a note is the most private thing a
-- person writes inside one. That role's grant list is asserted *exactly* in
-- invariants.test.ts, so this omission is checked rather than trusted.

-- --- Nothing revoked from unifyops_app ---------------------------------------
-- Unlike `audit_record`, `activity` and `wiki_page_revision` (slice 18), a note
-- is not append-only: it is something a person wrote and may edit or retract, so
-- it takes all five `tenantPolicies()` and keeps UPDATE and DELETE. This is
-- `comment`'s call from slice 8, and the line is the same one — a projection of
-- an event is history, and a thing somebody typed is theirs.
