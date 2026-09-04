-- =============================================================================
-- Slice 12 hardening: FORCE RLS on `saved_view`, and the two bounds a saved
-- view's stored query has to satisfy no matter who wrote the row.
--
-- The same first job as 0002, 0004, 0006, 0008, 0010, 0012, 0014, 0016, 0018
-- and 0020: every table here is owned by unifyops_owner, and a table owner is
-- exempt from its own row-level security unless the table FORCEs it.
-- drizzle-kit emits ENABLE and nothing else, so without this line the migration
-- role could read across every workspace — and invariants.test.ts fails any
-- table in `public` that is missing one.
-- =============================================================================

ALTER TABLE "saved_view" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- The stored query (§4, §5) -----------------------------------------------
-- `validateSavedView` in src/lib/saved-views.ts checks both of these, and both
-- are here anyway, for the reason slice 5 put `root_id`/`depth` in 0008, slice
-- 10 put the value CHECK in 0018 and slice 11 put the date range in 0020: a row
-- written by a seed script, a CSV importer or a Phase 2 MCP tool has to be as
-- correct as one written by the service.
--
-- A name is trimmed by the service before it arrives; this refuses the row that
-- got past it. An untitled view is not a smaller problem than a bad one — it is
-- a row in a picker with nothing to click on.

ALTER TABLE "saved_view"
  ADD CONSTRAINT "saved_view_name_present"
  CHECK (length(btrim("name")) > 0);--> statement-breakpoint

-- The bound `MAX_VIEW_QUERY_LENGTH` states in TypeScript. A query string is a
-- URL somebody meant to share, and one that no client will carry is not one —
-- but the reason it is *enforced* is narrower than that: this column is read
-- back into `parseWorkItemQuery` on every render of the views bar, and an
-- unbounded blob there is unbounded parsing on a hot path.
--
-- The number is duplicated from src/lib/saved-views.ts, and that duplication is
-- deliberate rather than avoidable, exactly as 0020's 366 is: this file is
-- applied once by a migration and read by nothing at runtime, so it cannot
-- import the constant. The unit test pins the TypeScript side; this pins
-- everything else.

ALTER TABLE "saved_view"
  ADD CONSTRAINT "saved_view_query_bounded"
  CHECK (length("query") <= 2048);--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010, 0012, 0014, 0016, 0018 and 0020 give: the pre-tenancy
-- handshake is the moment before a workspace is known, and a saved view is one
-- person's description of what they look at inside one. That role's grant list
-- is asserted exactly in invariants.test.ts, so this omission is checked rather
-- than trusted.

-- --- Nothing new for the calendar --------------------------------------------
-- Slice 12's calendar reads a month of due dates, which is a range scan on
-- `work_item_workspace_due_idx` — created in 0007 and already the index the
-- `overdue`, `today` and `week` windows use. The month predicate is written as
-- two bounds rather than `date_trunc('month', due_date) = ...` precisely so it
-- can use that index: a function over the column would not be sargable, and the
-- one screen that reads a whole month is the one that must not scan for it.
-- No new index, and deliberately so.
