-- Slice 13 hardening: what drizzle-kit cannot express, plus the fourth and last
-- of §9's working-day functions.
--
-- No new table, so no `FORCE ROW LEVEL SECURITY` line and no policies: slice 13
-- adds two columns to `workspace_member`, which has carried `tenantPolicies()`
-- since slice 1 and is already forced. `invariants.test.ts` is the gate that
-- says so rather than this comment.

-- --- Availability is two columns that live or die together (§4, §17-25) ------
-- A reason without a date is a sentence about nothing: it renders as "on leave"
-- with no end, and there is no screen that could show it honestly. The pairing
-- is enforced here rather than only in the service for the reason slice 5 put
-- `root_id` in 0008, slice 10 the value CHECK in 0018 and slice 11 the period
-- bounds in 0020 — a row written by a seed script, a CSV importer or a Phase 2
-- MCP tool has to be as correct as one `setAvailability` wrote.
--
-- The other direction is deliberately allowed: a date with no reason is
-- somebody who is away and did not say why, which is their business (§4 makes
-- the reason optional in as many words).
ALTER TABLE "workspace_member"
  ADD CONSTRAINT "workspace_member_availability_pairing"
  CHECK ("unavailable_reason" IS NULL OR "unavailable_until" IS NOT NULL);--> statement-breakpoint

-- A reason is a line on a workload column, not a document. Capped in characters
-- rather than graphemes because that is the only unit SQL has — the service
-- caps by grapheme at 120 (§13: one Khmer syllable is routinely three or four
-- code points), and this is the backstop underneath it, loose enough that the
-- grapheme cap is always the one a person meets.
ALTER TABLE "workspace_member"
  ADD CONSTRAINT "workspace_member_availability_reason_length"
  CHECK ("unavailable_reason" IS NULL OR char_length("unavailable_reason") <= 600);--> statement-breakpoint

-- --- Staleness: §9's third caller, and its fourth function ------------------
-- §9 puts one SQL function behind working days so that "staleness, the reminder
-- digest, and cycle progress" cannot disagree about whether Friday counted.
-- Slice 9 built the first three functions and named its three callers; the
-- digest was the first, cycle progress the second, and **this is the third**.
--
-- It is a fourth function rather than a call to `business_days_between` per row,
-- and that is the whole reason it exists. "Has this item gone N working days
-- without an update" asked row by row is a STABLE function containing a
-- `generate_series` and a holiday probe, evaluated once per candidate row — on
-- the one screen (§7.4's Needs Attention) that looks at every open item in a
-- team's projects. Asked once, it is a *cutoff instant*, and the comparison
-- against it is an ordinary index-usable predicate on `updated_at`.
--
-- It is still the same arithmetic: this is built on `is_working_day`, exactly as
-- `business_days_between` is, so the two cannot drift. What changes is that the
-- calendar is walked once instead of once per row.
--
-- Returning `timestamptz` rather than a date is the other half of the point.
-- `updated_at` is an instant and "which day it fell on" is a question only a
-- zone answers (§17-13) — an item touched at 8pm in Phnom Penh is the next day
-- in UTC, and a staleness rule computed in the server's zone flags work that was
-- updated this morning. The workspace's own timezone is one column away, so the
-- conversion happens here and no caller can forget it.
--
-- The result is the first instant that is **not** stale: an item is stale when
-- `updated_at < stale_before(...)`. With p_days = 1 and a Monday today, the
-- cutoff is midnight at the end of the previous working day, so "stale" means
-- untouched for at least one whole working day. Today itself never counts —
-- it is not over.
--
-- STABLE and SECURITY INVOKER, like its three siblings: it reads
-- `workspace_holiday` and `workspace` under the caller's own RLS, so a workspace
-- can only ever be asked about its own calendar.
--
-- NULL when the company has no working day in the past year, which is a
-- calendar mistake rather than a state to model. Every caller reads NULL as
-- "nothing is stale", which is the safe direction to fail in: a surface that
-- silently lists everything is worse than one that silently lists nothing.
CREATE OR REPLACE FUNCTION stale_before(p_workspace uuid, p_today date, p_days integer)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT ((cutoff.day + 1)::timestamp AT TIME ZONE w.timezone)
  FROM workspace w
  CROSS JOIN LATERAL (
    SELECT d::date AS day
    FROM generate_series(p_today - 1, p_today - 400, interval '-1 day') AS d
    WHERE is_working_day(p_workspace, d::date)
    ORDER BY d DESC
    OFFSET greatest(p_days, 1) - 1
    LIMIT 1
  ) cutoff
  WHERE w.id = p_workspace;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION stale_before(uuid, date, integer) TO unifyops_app;--> statement-breakpoint

-- The operator reads (§18-12), and this function only reads.
GRANT EXECUTE ON FUNCTION stale_before(uuid, date, integer) TO unifyops_operator;
