-- =============================================================================
-- Tenancy primitives.
--
-- These must exist before the first policy, because every policy calls them.
-- They read the transaction-local settings that src/server/db/tenant.ts sets
-- inside withActor.
--
-- Unset returns NULL, not an error. A NULL tenant key makes every policy
-- predicate false, so a query issued outside withActor returns nothing —
-- which is the failure mode §9 asks for. Raising instead would be louder but
-- would fire from inside the planner in places that have nothing to do with a
-- request; the branded TenantDb type is what catches the mistake at compile
-- time, and this is the runtime backstop.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS tenancy;
--> statement-breakpoint

GRANT USAGE ON SCHEMA tenancy TO unifyops_app;
--> statement-breakpoint

GRANT USAGE ON SCHEMA tenancy TO unifyops_operator;
--> statement-breakpoint

-- The current workspace. The tenant key every policy compares against.
CREATE OR REPLACE FUNCTION tenancy.workspace_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('unifyops.workspace_id', true), '')::uuid
$$;
--> statement-breakpoint

-- The member whose scope applies. During view-as this is the target member,
-- not the person at the keyboard — that is the point of view-as.
CREATE OR REPLACE FUNCTION tenancy.user_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('unifyops.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- The authenticated principal. Equals tenancy.user_id() unless view-as is
-- active. Recorded on every audit row so a view-as session is visible.
CREATE OR REPLACE FUNCTION tenancy.actor_user_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('unifyops.actor_user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Defaults to false when unset: an unscoped connection is already returning
-- zero rows, and defaulting this to true would make "forgot withActor" look
-- like a permissions problem instead of a tenancy one.
CREATE OR REPLACE FUNCTION tenancy.is_read_only() RETURNS boolean
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT coalesce(nullif(current_setting('unifyops.read_only', true), '')::boolean, false)
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION tenancy.workspace_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.user_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.actor_user_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenancy.is_read_only() FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION tenancy.workspace_id() TO unifyops_app, unifyops_operator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.user_id() TO unifyops_app, unifyops_operator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.actor_user_id() TO unifyops_app, unifyops_operator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenancy.is_read_only() TO unifyops_app, unifyops_operator;
