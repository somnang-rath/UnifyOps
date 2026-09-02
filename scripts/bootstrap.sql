-- =============================================================================
-- UnifyOps — database bootstrap
--
-- Run ONCE, as a superuser, before the first migration:
--
--   node scripts/db-setup.mjs
--
-- That reads the four role passwords out of .env and passes them in as psql
-- variables, so no secret is ever written into this file or into shell
-- history. psql prompts for the SUPERUSER password interactively.
--
-- To run it by hand instead:
--
--   psql -U postgres -h localhost -d postgres \
--        -v owner_password=... -v app_password=... \
--        -v operator_password=... -v identity_password=... \
--        -f scripts/bootstrap.sql
--
-- The four roles are the foundation of §9 tenancy and are NOT interchangeable:
--
--   DATABASE_URL_OWNER    -> unifyops_owner     migrations and drizzle-kit only
--   DATABASE_URL          -> unifyops_app       the running app, RLS forced
--   DATABASE_URL_OPERATOR -> unifyops_operator  platform support, cross-tenant SELECT only
--   DATABASE_URL_IDENTITY -> unifyops_identity  the pre-tenancy handshake (slice 3)
--
-- The app role is deliberately not the owner, because Postgres exempts a
-- table's owner from its own RLS policies unless FORCE is set — and relying on
-- remembering FORCE on every future table is exactly the failure this split
-- removes. See PLAN.en.md §9 "Tenancy".
--
-- WHY A FOURTH ROLE (slice 3).
-- Authentication happens before a workspace is known. Signing in means reading
-- app_user by email with no tenant scope set, and every app-role policy on that
-- table is false when tenancy.workspace_id() is NULL — correctly so. The same
-- is true of the two other pre-tenancy handshakes: creating an account, and
-- exchanging an invitation token for the workspace it names.
--
-- 0002 originally sanctioned doing that as the owner. That would put a role
-- which owns every table — and can therefore DROP any of them — into the
-- running web process, which is precisely what the two-role split exists to
-- prevent. unifyops_identity is that path instead, and its boundary is
-- statable: it reaches the identity and handshake tables (app_user, workspace,
-- auth_*, invitation) and NOTHING that says what a company is doing. It cannot
-- read workspace_member, team, audit_record, or any tenant table added later,
-- and it has no CREATE anywhere.
-- =============================================================================

\set ON_ERROR_STOP on

-- --- Roles -------------------------------------------------------------------
-- Passwords arrive as psql variables from scripts/db-setup.mjs, which reads
-- them from .env. Re-running is safe: an existing role has its password reset
-- to whatever .env currently holds, so the two never drift apart.

\if :{?owner_password}
\else
  \echo 'ERROR: owner_password not set. Run: node scripts/db-setup.mjs'
  \quit 1
\endif

\if :{?app_password}
\else
  \echo 'ERROR: app_password not set. Run: node scripts/db-setup.mjs'
  \quit 1
\endif

\if :{?operator_password}
\else
  \echo 'ERROR: operator_password not set. Run: node scripts/db-setup.mjs'
  \quit 1
\endif

\if :{?identity_password}
\else
  \echo 'ERROR: identity_password not set. Run: node scripts/db-setup.mjs'
  \quit 1
\endif

SELECT format('CREATE ROLE unifyops_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unifyops_owner')
\gexec

SELECT format('CREATE ROLE unifyops_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unifyops_app')
\gexec

-- The platform operator (PLAN.en.md §18-12). A separate role behind its own auth
-- boundary, granted cross-tenant SELECT and nothing else. Deliberately not a
-- session-variable bypass on the app connection: that puts the escape hatch on
-- the connection the app already holds, one SET away from any bug that can
-- influence session state.
SELECT format('CREATE ROLE unifyops_operator LOGIN PASSWORD %L', :'operator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unifyops_operator')
\gexec

-- The pre-tenancy handshake role. See the header for why it exists and what it
-- deliberately cannot reach; migration 0004 grants it its narrow table list.
SELECT format('CREATE ROLE unifyops_identity LOGIN PASSWORD %L', :'identity_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unifyops_identity')
\gexec

SELECT format('ALTER ROLE unifyops_owner PASSWORD %L', :'owner_password')
\gexec

SELECT format('ALTER ROLE unifyops_app PASSWORD %L', :'app_password')
\gexec

SELECT format('ALTER ROLE unifyops_operator PASSWORD %L', :'operator_password')
\gexec

SELECT format('ALTER ROLE unifyops_identity PASSWORD %L', :'identity_password')
\gexec

-- No role may bypass RLS. BYPASSRLS on the app role would silently defeat every
-- policy in the schema; on the owner role it would hide leaks in tests; on the
-- operator role it would make §18-12's read-only boundary decorative; on the
-- identity role it would turn the pre-tenancy handshake into a tenant-wide read.
ALTER ROLE unifyops_owner    NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
ALTER ROLE unifyops_app      NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
ALTER ROLE unifyops_operator NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
ALTER ROLE unifyops_identity NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

-- --- Database ----------------------------------------------------------------

SELECT 'CREATE DATABASE unifyops OWNER unifyops_owner ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'unifyops')
\gexec

\connect unifyops

-- --- Extensions --------------------------------------------------------------
-- pg_trgm carries Khmer search: Khmer has no inter-word spaces, so word-based
-- full-text search fails on it and trigram matching is the routed fallback.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --- Schema ownership --------------------------------------------------------
-- The owner creates objects; the app only ever uses them.

ALTER SCHEMA public OWNER TO unifyops_owner;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO unifyops_app;
GRANT USAGE ON SCHEMA public TO unifyops_operator;
GRANT USAGE ON SCHEMA public TO unifyops_identity;

-- No CREATE for the app role: it must never be able to own a table, because a
-- table's owner is exempt from RLS unless FORCE is set on that table. The same
-- reasoning applies to the operator and identity roles.
REVOKE CREATE ON SCHEMA public FROM unifyops_app;
REVOKE CREATE ON SCHEMA public FROM unifyops_operator;
REVOKE CREATE ON SCHEMA public FROM unifyops_identity;

-- --- Default privileges ------------------------------------------------------
-- Applied to everything the owner creates from here on, so a new table in a
-- future migration is usable by the app without a follow-up GRANT — and, more
-- importantly, without anyone being tempted to run the app as the owner.

ALTER DEFAULT PRIVILEGES FOR ROLE unifyops_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO unifyops_app;

ALTER DEFAULT PRIVILEGES FOR ROLE unifyops_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO unifyops_app;

ALTER DEFAULT PRIVILEGES FOR ROLE unifyops_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO unifyops_app;

-- The operator reads and never writes. SELECT is the whole grant.
--
-- Note this is a DEFAULT privilege: it lands on every future table, including
-- ones the operator must not see. Migration 0004 revokes it back off the auth
-- tables, because a support role does not read password hashes or live session
-- tokens, and invariants.test.ts asserts that revoke held.
ALTER DEFAULT PRIVILEGES FOR ROLE unifyops_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO unifyops_operator;

-- Nothing by default for the identity role. Its table list is short, explicit,
-- and granted by name in migration 0004 — a default privilege here would hand
-- it every tenant table a future slice adds, which is the one thing it must
-- never have.

-- --- Verification ------------------------------------------------------------

\echo ''
\echo 'Roles — all four must show f for superuser and bypassrls:'
SELECT rolname, rolsuper AS superuser, rolbypassrls AS bypassrls, rolcanlogin AS login
FROM pg_roles
WHERE rolname IN ('unifyops_owner', 'unifyops_app', 'unifyops_operator', 'unifyops_identity')
ORDER BY rolname;

\echo ''
\echo 'Extensions:'
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gist');

\echo ''
\echo 'Bootstrap complete. Next: pnpm db:migrate to apply the schema,'
\echo 'then pnpm db:seed for two workspaces to click around in.'
