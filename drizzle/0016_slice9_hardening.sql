-- =============================================================================
-- Slice 9 hardening: FORCE RLS on the four new tables, the append-only revoke
-- the outbox needs, and the one working-days function §9 puts three surfaces
-- behind.
--
-- The same first job as 0002, 0004, 0006, 0008, 0010, 0012 and 0014: every
-- table here is owned by unifyops_owner, and a table owner is exempt from its
-- own row-level security unless the table FORCEs it. drizzle-kit emits ENABLE
-- and nothing else, so without these lines the migration role could read across
-- every workspace — and invariants.test.ts fails any table in `public` that is
-- missing one.
-- =============================================================================

ALTER TABLE "outbox_message" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preference" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_holiday" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- The outbox is append-and-mark-only -------------------------------------
-- Its policies grant SELECT, INSERT and UPDATE and no DELETE, but the default
-- privileges in bootstrap.sql hand the app role all four on every new table —
-- so the missing policy is the only thing standing between a bug and a deleted
-- outbox row. 0010 made the same argument for `activity`; here the loss would
-- be a notification that never arrives and leaves no trace of not having.
--
-- Retention is deliberately not solved by granting this back. Pruning delivered
-- rows is a maintenance job that will run as the owner, the way pruning any log
-- does, and a request has no business deleting one.

REVOKE DELETE ON "outbox_message" FROM unifyops_app;--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010 and 0012 give: the pre-tenancy handshake is the moment
-- before a workspace is known, and every table here is about what is happening
-- inside one. That role's grant list is asserted exactly in invariants.test.ts,
-- so this omission is checked rather than trusted.

-- --- Working days and holidays (§9, §17-18) ----------------------------------
-- §9 puts one function behind this question — "Staleness, the reminder digest,
-- and cycle progress all call it — three surfaces that must never disagree
-- about whether Friday counted." Slice 9 is the first caller (§7.8's digest
-- "moves to the last working evening before"), and slices 11 and 13 are the
-- other two.
--
-- In SQL rather than TypeScript, and that is the point of §9's sentence. A
-- working-day calculation done in the application is done again, differently,
-- by whoever writes the next query that needs one — and the two disagree about
-- a Saturday in a way nobody notices until a burndown and a digest tell one
-- person two different things.
--
-- STABLE, not IMMUTABLE: the answer depends on rows in workspace_holiday, which
-- a company edits. SECURITY INVOKER (the default) is deliberate — these run
-- with the caller's RLS in force, so a workspace can only ever be asked about
-- its own calendar.

-- Is this date one the company works?
--
-- `isodow` is 1 (Monday) through 7 (Sunday), and working_days is a seven-bit
-- mask with bit 0 = Monday, so the shift is `isodow - 1`. A holiday overrides
-- the mask: a company that works Saturdays still closes on Khmer New Year.
CREATE OR REPLACE FUNCTION is_working_day(p_workspace uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    (w.working_days >> (EXTRACT(isodow FROM p_date)::int - 1) & 1) = 1
    AND NOT EXISTS (
      SELECT 1 FROM workspace_holiday h
      WHERE h.workspace_id = p_workspace
        AND h.date = p_date
        AND h.deleted_at IS NULL
    )
  FROM workspace w
  WHERE w.id = p_workspace;
$$;--> statement-breakpoint

-- The next day the company works, strictly after p_date.
--
-- Bounded at 14 days: two full weeks with no working day means either a
-- workspace that has switched everything off or a calendar mistake, and a
-- function that loops until it finds one would hang instead of returning. NULL
-- says "there isn't one", which every caller can act on.
CREATE OR REPLACE FUNCTION next_working_day(p_workspace uuid, p_date date)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT d::date
  FROM generate_series(p_date + 1, p_date + 14, interval '1 day') AS d
  WHERE is_working_day(p_workspace, d::date)
  ORDER BY d
  LIMIT 1;
$$;--> statement-breakpoint

-- The §9 function itself: working days in [p_from, p_to).
--
-- Half-open, so `business_days_between(w, due, today)` is "how many working
-- days late" and is zero on the due date itself rather than one. Negative when
-- p_to precedes p_from, which is what lets one call answer both "how overdue"
-- and "how long left" without the caller checking the sign first.
CREATE OR REPLACE FUNCTION business_days_between(p_workspace uuid, p_from date, p_to date)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_to = p_from THEN 0
    WHEN p_to > p_from THEN (
      SELECT count(*)::int
      FROM generate_series(p_from, p_to - 1, interval '1 day') AS d
      WHERE is_working_day(p_workspace, d::date)
    )
    ELSE -(
      SELECT count(*)::int
      FROM generate_series(p_to, p_from - 1, interval '1 day') AS d
      WHERE is_working_day(p_workspace, d::date)
    )
  END;
$$;--> statement-breakpoint

-- The app role runs all three. The default privileges in bootstrap.sql already
-- GRANT EXECUTE ON FUNCTIONS, but naming them is what makes the grant visible
-- to whoever reads this file looking for what the worker is allowed to do.
GRANT EXECUTE ON FUNCTION is_working_day(uuid, date) TO unifyops_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION next_working_day(uuid, date) TO unifyops_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION business_days_between(uuid, date, date) TO unifyops_app;--> statement-breakpoint

-- The operator reads; §18-12 is read-only and these functions only read.
GRANT EXECUTE ON FUNCTION is_working_day(uuid, date) TO unifyops_operator;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION next_working_day(uuid, date) TO unifyops_operator;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION business_days_between(uuid, date, date) TO unifyops_operator;
