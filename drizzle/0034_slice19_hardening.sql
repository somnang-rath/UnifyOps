-- =============================================================================
-- Slice 19 hardening: FORCE RLS on the new join table, the CHECK that makes a
-- verification a whole fact rather than half of one, the bound that keeps a
-- review cycle recoverable, and the fifth member of §9's working-day family.
--
-- The same first job as every even-numbered migration since 0002: every table
-- here is owned by unifyops_owner, and a table owner is exempt from its own
-- row-level security unless the table FORCEs it. drizzle-kit emits ENABLE and
-- nothing else, so without this line the migration role could read across every
-- workspace — and invariants.test.ts fails any table in `public` that is missing
-- one.
-- =============================================================================

ALTER TABLE "wiki_page_label" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- A verification is a whole fact, or it is not one ------------------------
-- §21.3: "Both are set and cleared together, under a CHECK, because half of this
-- pair is not a fact."
--
-- A `verified_at` with no author is an assertion nobody made. An author with no
-- timestamp is an assertion with no date, and a verification whose date is
-- unknown is exactly as useful as no verification at all — the badge would still
-- draw, and `verificationStatus` would still call it verified, on the strength of
-- a row that cannot say when.
--
-- `num_nonnulls(...) IN (0, 2)` is 0018's device pointed at a *pair* rather than
-- at a set of typed value columns, and it is here rather than only in
-- `verifyPage` for the reason slice 5 put `root_id` in 0008, slice 10 the value
-- CHECK in 0018, slice 11 the date range in 0020, slice 15 the working-day bound
-- in 0028 and slice 18 the page invariants in 0032: a row written by a seed
-- script, a Markdown importer or a Phase 2 MCP tool has to be as correct as one
-- written by the service.
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_verification_pair"
  CHECK (num_nonnulls("verified_at", "verified_by_member_id") IN (0, 2));--> statement-breakpoint

-- An expiry with no verification is a lapse date for an assertion nobody made.
-- The reverse is legitimate and is the common case: §21.3 makes *Never* the
-- default, so a verified page with a null expiry is a standing claim with no
-- review cycle, which is "right for most pages and must stay the default".
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_expiry_needs_verification"
  CHECK ("verification_expires_at" IS NULL OR "verified_at" IS NOT NULL);--> statement-breakpoint

-- --- A review cycle a company can always get out of --------------------------
-- §6's second half, the rule 0028 states as "no setting can put a workspace in
-- an unrecoverable state". A space default of zero or a negative number would
-- resolve every new page's expiry to today or to the past, so every page created
-- in that space would be born expired — a wiki that reports its whole contents
-- as untrustworthy on the morning it is created, with nothing on screen
-- explaining why.
--
-- **Bounded, deliberately not enumerated.** `VERIFICATION_DAYS` is 90 · 180 ·
-- 365 today, and it is a fact about `src/lib/wiki.ts` rather than about the
-- database — a CHECK listing those three would have to be migrated in step with
-- adding a fourth period. That is exactly the call 0028 made when it declined to
-- enumerate the locales the product ships. The upper bound is ten years, which
-- is not an opinion about review cycles but the same defence 0020's year bound
-- gives the burndown: it is what stops a mistyped 3650000 resolving to a date
-- Postgres cannot represent.
ALTER TABLE "wiki_space"
  ADD CONSTRAINT "wiki_space_verification_days"
  CHECK ("default_verification_days" IS NULL
         OR ("default_verification_days" BETWEEN 1 AND 3650));--> statement-breakpoint

-- --- The fifth working-day function (§9, §21.3) ------------------------------
-- §9 put one SQL function behind working days so "staleness, the reminder
-- digest, and cycle progress" cannot disagree, and every slice since has added
-- its caller rather than its own arithmetic. This is the fifth function and the
-- same discipline: `is_working_day` (0016), `next_working_day` (0016),
-- `business_days_between` (0016), `stale_before` (0024), and now this.
--
-- **Why it is a function and not a per-row calculation.** §21.3's warning is
-- "expire within the next seven working days", and asked per candidate row that
-- would be a `generate_series` and a holiday probe *per page* — the shape slice
-- 13 rejected for staleness, in that case on the one screen that looks at every
-- open item in a team. Asked once it is a single date, and the comparison
-- against `verification_expires_at` is an ordinary index-usable predicate that
-- `wiki_page_owner_idx` serves directly.
--
-- **Why working days rather than calendar days.** The number is lead time to
-- *act* on a page, and nobody rewrites a leave policy on a Sunday. A company on
-- the schema's default Monday-to-Saturday mask (63, §2.5) gets seven working
-- days of warning across eight calendar days; one that has closed for Khmer New
-- Year (§17-18) gets its warning before the holiday rather than during it, which
-- is the whole point of consulting the calendar at all.
--
-- Mirrors `stale_before` exactly, pointed forwards instead of backwards: walk
-- days from tomorrow, keep only the working ones, and take the p_days'th. The
-- 400-day ceiling is 0024's and for its reason — a company whose calendar leaves
-- no working days at all must terminate rather than loop, and 0028's
-- `working_days BETWEEN 1 AND 127` is what makes that unreachable in practice.
CREATE OR REPLACE FUNCTION working_days_ahead(p_workspace uuid, p_from date, p_days integer)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT horizon.day
  FROM generate_series(p_from + 1, p_from + 400, interval '1 day') AS d
  CROSS JOIN LATERAL (SELECT d::date AS day) horizon
  WHERE is_working_day(p_workspace, d::date)
  ORDER BY d
  OFFSET greatest(p_days, 1) - 1
  LIMIT 1;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION working_days_ahead(uuid, date, integer) TO unifyops_app;--> statement-breakpoint

-- The operator reads (§18-12), and this function only reads. The digest's
-- enumeration half runs on that role, exactly as slice 9 arranged it.
GRANT EXECUTE ON FUNCTION working_days_ahead(uuid, date, integer) TO unifyops_operator;--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010 through 0032 all give: the pre-tenancy handshake is the
-- moment before a workspace is known, and it has no business reading one word of
-- what a company has written down — still less which of it somebody has vouched
-- for. That role's grant list is asserted *exactly* in invariants.test.ts, so
-- this omission is checked rather than trusted.
