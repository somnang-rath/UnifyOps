-- =============================================================================
-- Slice 11 hardening: FORCE RLS on `cycle`, and the two invariants a cycle's
-- date range has to satisfy no matter who writes the row.
--
-- The same first job as 0002, 0004, 0006, 0008, 0010, 0012, 0014, 0016 and
-- 0018: every table here is owned by unifyops_owner, and a table owner is
-- exempt from its own row-level security unless the table FORCEs it.
-- drizzle-kit emits ENABLE and nothing else, so without this line the migration
-- role could read across every workspace — and invariants.test.ts fails any
-- table in `public` that is missing one.
-- =============================================================================

ALTER TABLE "cycle" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- The date range (§7.6) ---------------------------------------------------
-- `validatePeriod` in src/lib/cycles.ts checks both of these, and both are here
-- anyway, for the reason slice 5 put `root_id`/`depth` in 0008 and slice 10 put
-- the value CHECK in 0018: a row written by a seed script, a CSV importer or a
-- Phase 2 MCP tool has to be as correct as one written by the service. A cycle
-- is the only row in this product whose *shape* the burndown depends on, and a
-- backwards range is not a rendering problem — `generate_series` over it
-- returns nothing, so the chart silently draws an empty cycle.
--
-- Inclusive of a single-day cycle, which is legitimate: a one-day push before a
-- release is a cycle, and refusing it would be an opinion about how teams work
-- rather than a constraint the data needs.

ALTER TABLE "cycle"
  ADD CONSTRAINT "cycle_range_ordered"
  CHECK ("end_date" >= "start_date");--> statement-breakpoint

-- The bound the burndown query needs. It is one row per calendar day of the
-- range, so an end date mistyped as 2126 is a query returning thirty-six
-- thousand rows and a page that never renders. 366 days is a year including a
-- leap one — past any range anybody plans and short of anything that hurts.
--
-- The number is duplicated from MAX_CYCLE_DAYS in src/lib/cycles.ts, and that
-- duplication is deliberate rather than avoidable: this file is applied once by
-- a migration and read by nothing at runtime, so it cannot import the constant.
-- The unit test pins the TypeScript side; this pins everything else.

ALTER TABLE "cycle"
  ADD CONSTRAINT "cycle_range_bounded"
  CHECK ("end_date" - "start_date" < 366);--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010, 0012, 0014, 0016 and 0018 give: the pre-tenancy
-- handshake is the moment before a workspace is known, and a cycle is about
-- what is happening inside one. That role's grant list is asserted exactly in
-- invariants.test.ts, so this omission is checked rather than trusted.

-- --- Nothing new for working days --------------------------------------------
-- §9's `is_working_day`, `next_working_day` and `business_days_between` were
-- created in 0016 and are already granted to unifyops_app and
-- unifyops_operator. Slice 11's burndown is their second caller — the one §9
-- named when it said "staleness, the reminder digest, and cycle progress all
-- call it — three surfaces that must never disagree about whether Friday
-- counted". This slice deliberately adds no fourth function and re-implements
-- none of the three.
