-- =============================================================================
-- Slice 5 hardening: FORCE RLS on the tables 0007 adds, plus the three triggers
-- that hold the work-item invariants the application must not be trusted with.
--
-- Same first job as 0002, 0004 and 0006, and the same absences for the same
-- reasons:
--
--   * No grants to unifyops_app or unifyops_operator. bootstrap.sql's default
--     privileges already gave the app role CRUD and the operator SELECT on
--     every table the owner creates, which is exactly right for tenant tables.
--
--   * No grants to unifyops_identity. The handshake role exists for the moment
--     before a workspace is known; a work item is the furthest thing there is
--     from that. bootstrap.sql gives it no default privileges precisely so a
--     slice like this has to opt in by name, and invariants.test.ts asserts the
--     grant list exactly — so the omission is checked rather than trusted.
--
--   * No owner "provisioning" policy. A work item is created by a member of the
--     workspace it belongs to, so it goes through withActor on the app role.
--
-- What is new here is the trigger layer. Three invariants live in the database
-- rather than in `src/server/services/work-items.ts`, and each one is there
-- because a row written by anything other than that service — a seed script, a
-- future importer, a Phase 2 MCP tool — must still be correct:
--
--   1. `root_id` / `depth`, maintained across inserts and re-parenting, capped
--      at three levels (§4, §9).
--   2. `assignee_ids`, mirroring work_item_assignee (§9).
--   3. `label_ids`, mirroring work_item_label (§9).
--
-- The arrays are what let "assigned to me" and "labelled client" be GIN index
-- lookups instead of a join fan-out. A mirror maintained by application code is
-- a mirror that is wrong the first time somebody writes the join table directly.
-- =============================================================================

-- --- FORCE ROW LEVEL SECURITY ------------------------------------------------
-- ENABLE alone exempts the table owner from its own policies, and the owner is
-- what migrations and drizzle-kit run as. FORCE is the half that survives
-- someone running a script with the wrong connection string.

ALTER TABLE "label" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_counter" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item_assignee" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item_label" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- --- The rank column sorts by bytes, not by language -------------------------
-- §9's fractional index is a string whose *lexicographic* order is the board's
-- order. Postgres compares text under the database collation, and every
-- collation but "C" applies language rules — so which of two keys sorts first
-- would depend on the locale the cluster happened to be initialised with, and a
-- board could silently reorder itself on a restore into a different one.
--
-- src/lib/rank.ts narrows the alphabet to lowercase base-36 so the two layers
-- cannot disagree even if this line is ever lost; this is the other half of the
-- same guarantee. Retyping the column rebuilds the index 0007 created on it,
-- which is what makes the index agree with the comparison.

ALTER TABLE "work_item" ALTER COLUMN "rank" TYPE text COLLATE "C";--> statement-breakpoint

-- --- Hierarchy: root_id, depth, and the cap ----------------------------------
-- §4 caps sub-items at three levels; §9 chooses an adjacency list plus a
-- trigger-maintained root_id/depth over a closure table, so "all descendants"
-- is one indexed equality rather than a second table with write amplification.
--
-- `depth` is zero-based, so three levels means a maximum of 2.
--
-- Deliberately not SECURITY DEFINER: the trigger reads work_item as whoever is
-- writing, under the same RLS policies. A parent in another workspace is
-- invisible, so re-parenting across a tenant boundary fails as "parent not
-- found" rather than succeeding — the composite foreign key would refuse it
-- anyway, and this is the layer that gives the refusal an honest message.

CREATE OR REPLACE FUNCTION tenancy.work_item_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_root uuid;
  parent_depth integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NEW.id;
    NEW.depth := 0;
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a work item cannot be its own parent'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT root_id, depth INTO parent_root, parent_depth
  FROM public.work_item WHERE id = NEW.parent_id;

  IF parent_root IS NULL THEN
    RAISE EXCEPTION 'parent work item % not found', NEW.parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A cycle is only reachable by re-parenting onto a descendant, so the check
  -- is needed on UPDATE alone — and the branch is nested rather than and-ed,
  -- because OLD is an unassigned record on INSERT and a single SQL expression
  -- mentioning it would fail there rather than short-circuit.
  IF TG_OP = 'UPDATE' THEN
    IF parent_root = OLD.root_id AND EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id FROM public.work_item WHERE parent_id = OLD.id
        UNION ALL
        SELECT w.id FROM public.work_item w JOIN descendants d ON w.parent_id = d.id
      )
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    ) THEN
      RAISE EXCEPTION 'a work item cannot be moved under its own descendant'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.root_id := parent_root;
  NEW.depth := parent_depth + 1;

  IF NEW.depth > 2 THEN
    RAISE EXCEPTION 'sub-items are capped at three levels (§4)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER work_item_hierarchy_trg
BEFORE INSERT OR UPDATE OF parent_id ON "work_item"
FOR EACH ROW EXECUTE FUNCTION tenancy.work_item_hierarchy();--> statement-breakpoint

-- Re-parenting moves a whole subtree, so the descendants' root_id and depth are
-- rewritten after the row itself settles. Without this, moving a parent leaves
-- its children claiming the old root — and "all descendants" silently returns
-- the wrong set, which is the failure mode a closure table was rejected to
-- avoid rather than to trade for.

CREATE OR REPLACE FUNCTION tenancy.work_item_subtree_moved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  deepest integer;
BEGIN
  WITH RECURSIVE descendants AS (
    SELECT id, NEW.root_id AS root_id, NEW.depth + 1 AS depth
    FROM public.work_item WHERE parent_id = NEW.id
    UNION ALL
    SELECT w.id, d.root_id, d.depth + 1
    FROM public.work_item w JOIN descendants d ON w.parent_id = d.id
  )
  UPDATE public.work_item w
  SET root_id = d.root_id, depth = d.depth
  FROM descendants d
  WHERE w.id = d.id;

  SELECT max(depth) INTO deepest FROM public.work_item WHERE root_id = NEW.root_id;

  IF deepest > 2 THEN
    RAISE EXCEPTION 'that move would nest sub-items more than three levels deep (§4)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER work_item_subtree_moved_trg
AFTER UPDATE OF parent_id ON "work_item"
FOR EACH ROW
WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
EXECUTE FUNCTION tenancy.work_item_subtree_moved();--> statement-breakpoint

-- --- The denormalized arrays -------------------------------------------------
-- §9: "join tables stay the source of truth, arrays are trigger-maintained".
-- Sorted, so two items with the same assignees hold identical arrays and a
-- test can compare them without normalizing first.

CREATE OR REPLACE FUNCTION tenancy.work_item_assignees_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target uuid;
BEGIN
  -- Branched rather than COALESCE'd: on DELETE, NEW is an unassigned record and
  -- reading a field off it raises before the COALESCE ever runs.
  IF TG_OP = 'DELETE' THEN target := OLD.work_item_id; ELSE target := NEW.work_item_id; END IF;

  UPDATE public.work_item SET assignee_ids = COALESCE((
    SELECT array_agg(a.workspace_member_id ORDER BY a.workspace_member_id)
    FROM public.work_item_assignee a WHERE a.work_item_id = target
  ), '{}'::uuid[])
  WHERE id = target;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER work_item_assignees_sync_trg
AFTER INSERT OR DELETE ON "work_item_assignee"
FOR EACH ROW EXECUTE FUNCTION tenancy.work_item_assignees_sync();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenancy.work_item_labels_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD.work_item_id; ELSE target := NEW.work_item_id; END IF;

  UPDATE public.work_item SET label_ids = COALESCE((
    SELECT array_agg(l.label_id ORDER BY l.label_id)
    FROM public.work_item_label l WHERE l.work_item_id = target
  ), '{}'::uuid[])
  WHERE id = target;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER work_item_labels_sync_trg
AFTER INSERT OR DELETE ON "work_item_label"
FOR EACH ROW EXECUTE FUNCTION tenancy.work_item_labels_sync();
