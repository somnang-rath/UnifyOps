-- Slice 14 hardening: the two indexes §9's search routing rests on, and the one
-- it deliberately does not create.
--
-- No new table, so no `FORCE ROW LEVEL SECURITY` line and no policies: slice 14
-- adds one generated column to `work_item`, which has carried
-- `tenantPolicies()` since slice 5 and is already forced. `invariants.test.ts`
-- is the gate that says so rather than this comment.
--
-- Everything here is an index. That is not a small slice hiding — it is what
-- §9's one line about search actually costs once the *text* is one generated
-- column (migration 0025): "tsvector('simple') for Latin, pg_trgm for Khmer,
-- routed by script detection" is two indexes over one string, and the routing
-- is a `CASE` in TypeScript rather than anything in the schema.

-- --- The Latin route (§9, §13) ---------------------------------------------
-- `simple` and not `english`, and the choice is bilingual rather than lazy. The
-- `english` configuration stems and drops stopwords by English rules: it would
-- reduce "running" to "run" (useful) and also discard "it", "no" and "off" from
-- a title like "no build off master" (not useful), and it has nothing sensible
-- to say about a Khmer word that happens to land in a Latin-routed query. A
-- workspace that mixes scripts in one sentence — which is the normal case here,
-- not the exotic one — is better served by exact lexemes plus the `:*` prefix
-- the palette appends to the last term (`toTsQuery`), which is what makes a
-- search feel live before the word is finished.
--
-- An **expression** index rather than a second stored `tsvector` column. The
-- column would double the storage of every description a second time, on top of
-- the copy `search_text` already is, to buy `ts_rank` — and this product does
-- not rank by `ts_rank`: see the ordering note in `src/server/queries/search.ts`.
-- The query must use this exact expression or the planner will not reach for it.
CREATE INDEX "work_item_search_fts_idx"
  ON "work_item" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint

-- --- The Khmer route (§9, §13) ---------------------------------------------
-- Khmer has no inter-word spaces, so `to_tsvector` sees one enormous token and
-- the only query that could ever match it is that same whole string. A trigram
-- substring match is the one thing that finds a word inside it — which is why
-- §13 lists this as a *trap with a fix* rather than a preference.
--
-- On the column itself rather than on an expression, because the predicate is
-- `search_text LIKE '%…%'` and a `gin_trgm_ops` index can only serve a LIKE
-- against the indexed value. `search_text` is generated `lower(...)` precisely
-- so this can be `LIKE` rather than `ILIKE`: `ILIKE` against a raw column is not
-- servable by this index, and folding 50,000 descriptions per keystroke is the
-- §16 failure this slice exists to avoid.
--
-- pg_trgm is already installed — `scripts/bootstrap.sql` creates it and
-- `provision.ts` does the same for the test harnesses, both since slice 0,
-- because §13 named this need before any of it was built.
CREATE INDEX "work_item_search_trgm_idx"
  ON "work_item" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint

-- --- Projects, which are searched the same way in both scripts --------------
-- §7.9's second section. One index rather than two, and the asymmetry with
-- `work_item` above is deliberate: a project name is a handful of words, so
-- there is no Latin case where lexeme matching beats a substring — "eng" should
-- find "Engineering", and full-text will not do that without the same `:*`
-- machinery for a table holding tens of rows.
--
-- `lower()` in the expression and `lower()` in the query, for the reason the
-- generated column exists: `ILIKE` cannot use this index.
CREATE INDEX "project_name_trgm_idx"
  ON "project" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint

-- --- The index that is deliberately absent ----------------------------------
-- §7.9's third section is People, and `app_user` gets no trigram index.
--
-- Not an oversight and not a deferral. `app_user`'s `user_select` policy already
-- restricts every read to people who share a workspace with the reader (widened
-- in migration 0009 to include those who have since left, so activity stays
-- attributed), and the people query joins through `workspace_member` anyway. So
-- the scan is over one company's members — tens, or low hundreds — and an index
-- on a table that is *never* read unbounded would be write amplification bought
-- for nothing. If a workspace ever holds enough people for this to matter, the
-- fix is this same index, added then, against a measurement.
--
-- Nothing to grant. An index is not a grantable object, and the app and operator
-- roles already hold the SELECT on the tables above that these accelerate.
