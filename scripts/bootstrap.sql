-- =============================================================================
-- UnifyOps — database bootstrap
--
-- Run ONCE, as a superuser, before the first migration:
--
--   node scripts/db-setup.mjs
--
-- That reads the two role passwords out of .env and passes them in as psql
-- variables, so no secret is ever written into this file or into shell
-- history. psql prompts for the SUPERUSER password interactively.
--
-- To run it by hand instead:
--
--   psql -U postgres -h localhost -d postgres \
--        -v owner_password=... -v app_password=... -f scripts/bootstrap.sql
--
-- The two roles are the foundation of §9 tenancy and are NOT interchangeable:
--
--   DATABASE_URL_OWNER -> unifyops_owner  migrations and drizzle-kit only
--   DATABASE_URL       -> unifyops_app    the running app, RLS forced
--
-- The app role is deliberately not the owner, because Postgres exempts a
-- table's owner from its own RLS policies unless FORCE is set — and relying on
-- remembering FORCE on every future table is exactly the failure this split
-- removes. See PLAN.en.md §9 "Tenancy".
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

SELECT format('CREATE ROLE unifyops_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unifyops_owner')
\gexec

SELECT format('CREATE ROLE unifyops_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unifyops_app')
\gexec

SELECT format('ALTER ROLE unifyops_owner PASSWORD %L', :'owner_password')
\gexec

SELECT format('ALTER ROLE unifyops_app PASSWORD %L', :'app_password')
\gexec

-- Neither role may bypass RLS. BYPASSRLS on the app role would silently defeat
-- every policy in the schema; on the owner role it would hide leaks in tests.
ALTER ROLE unifyops_owner NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
ALTER ROLE unifyops_app   NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

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

-- No CREATE for the app role: it must never be able to own a table, because a
-- table's owner is exempt from RLS unless FORCE is set on that table.
REVOKE CREATE ON SCHEMA public FROM unifyops_app;

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

-- --- Verification ------------------------------------------------------------

\echo ''
\echo 'Roles — both must show f for superuser and bypassrls:'
SELECT rolname, rolsuper AS superuser, rolbypassrls AS bypassrls, rolcanlogin AS login
FROM pg_roles
WHERE rolname IN ('unifyops_owner', 'unifyops_app')
ORDER BY rolname;

\echo ''
\echo 'Extensions:'
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gist');

\echo ''
\echo 'Bootstrap complete. Next: set DATABASE_URL_OWNER and DATABASE_URL in .env,'
\echo 'then run pnpm db:migrate once slice 1 has landed the schema.'
