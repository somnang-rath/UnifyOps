-- =============================================================================
-- Slice 22 hardening: the two halves of "a template is a root page, and nothing
-- hangs off one" (§21.7).
--
-- **No `FORCE ROW LEVEL SECURITY` line, for the first time since 0002** — and
-- the absence is the point rather than an omission. Every even-numbered
-- migration has opened with one because every odd-numbered one added a table;
-- this slice adds a *column*, `wiki_page.is_template`, and `wiki_page` has
-- FORCEd its own policies since 0032. `invariants.test.ts` is the gate for that
-- and would fail if this were wrong, which is why the check is a test rather
-- than a habit.
--
-- Grants need no line either. `bootstrap.sql` grants privileges on the *table*,
-- and a table-level grant covers a column added afterwards — the alternative
-- (column-level grants) is what would have made this a migration, and nothing in
-- this schema uses them.
-- =============================================================================

-- --- A template is a root page -----------------------------------------------
-- §21.7: "A template is an ordinary page with a flag — living in the space it
-- belongs to and **hidden from the tree**."
--
-- Hidden from the tree and *inside* the tree are contradictory, and the
-- contradiction is not cosmetic. `deletePage` reparents a page's children onto
-- its parent, `subtreeIds` walks a subtree to move it, and `buildPageTree`
-- assembles the sidebar from `parent_id` — a template nested under the handbook
-- would be an invisible node that all three of those have to reason about, and
-- the first screen to meet it would draw a tree with a hole in it.
--
-- Here rather than only in `setPageTemplate` for the reason slice 5 put
-- `root_id` in 0008, slice 10 the value CHECK in 0018, slice 11 the date range
-- in 0020, slice 15 the working-day bound in 0028, slice 18 the page invariants
-- in 0032, slice 19 the verification pair in 0034 and slice 20 the icon floor in
-- 0036: a row written by a seed script, §21.8's own Markdown importer or a Phase
-- 2 MCP tool has to be as correct as one written by the service. That argument
-- has more force this slice than in any of the seven before it, because the
-- importer is no longer hypothetical — it is in this slice, it writes pages in a
-- loop, and it is the caller most likely to get a tree wrong.
ALTER TABLE "wiki_page"
  ADD CONSTRAINT "wiki_page_template_is_root"
  CHECK (NOT "is_template" OR "parent_id" IS NULL);--> statement-breakpoint

-- --- Nothing hangs off a template --------------------------------------------
-- The other half of the same rule, and it cannot be a CHECK: whether a page's
-- parent is a template is a fact about a *different row*, which is precisely
-- what a row constraint cannot see.
--
-- **0032's `tenancy.wiki_page_hierarchy` is replaced rather than joined by a
-- second trigger**, and the replacement is deliberate. That function is already
-- the one place that answers "is this parent/child relationship legal" — it
-- checks self-parenting, the parent's existence, the space match, the cycle and
-- the depth cap — and a fourth rule about parents living somewhere else would be
-- the beginning of two places to look. It also already has the parent row in
-- hand, so this costs one more column on a SELECT that was happening anyway
-- rather than a second probe on every insert.
--
-- The body below is 0032's, unchanged apart from `parent_is_template` and the
-- block that raises on it. 0032 stays the history of what the rule was; this is
-- what it is.
CREATE OR REPLACE FUNCTION tenancy.wiki_page_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  parent_root uuid;
  parent_depth integer;
  parent_space uuid;
  parent_is_template boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NEW.id;
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a wiki page cannot be its own parent'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT root_id, depth, space_id, is_template
    INTO parent_root, parent_depth, parent_space, parent_is_template
  FROM public.wiki_page WHERE id = NEW.parent_id;

  IF parent_root IS NULL THEN
    RAISE EXCEPTION 'parent wiki page % not found', NEW.parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A page's parent is in its own space, always. §20.5 makes the space the unit
  -- of access, so a child in a different space from its parent would be a page
  -- whose permissions and whose position in the tree disagreed — and the sidebar
  -- would show a page somebody may not open.
  IF parent_space <> NEW.space_id THEN
    RAISE EXCEPTION 'a wiki page and its parent must be in the same space'
      USING ERRCODE = 'check_violation';
  END IF;

  -- §21.7, slice 22. A template is hidden from the tree, so a page whose parent
  -- is one would be reachable only through a node the sidebar never draws.
  IF parent_is_template THEN
    RAISE EXCEPTION 'a wiki page cannot be nested under a template (§21.7)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A cycle is only reachable by re-parenting onto a descendant, so the check is
  -- needed on UPDATE alone — and the branch is nested rather than and-ed,
  -- because OLD is an unassigned record on INSERT and a single SQL expression
  -- mentioning it would fail there rather than short-circuit. 0008's note.
  IF TG_OP = 'UPDATE' THEN
    IF parent_root = OLD.root_id AND EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id FROM public.wiki_page WHERE parent_id = OLD.id
        UNION ALL
        SELECT w.id FROM public.wiki_page w JOIN descendants d ON w.parent_id = d.id
      )
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    ) THEN
      RAISE EXCEPTION 'a wiki page cannot be moved under its own descendant'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.root_id := parent_root;
  NEW.depth := parent_depth + 1;

  IF NEW.depth > 3 THEN
    RAISE EXCEPTION 'wiki pages are capped at three levels within a space (§20.4)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

-- --- Becoming a template is also a move --------------------------------------
-- The trigger above fires on INSERT and on an UPDATE of `parent_id` or
-- `space_id`, which is everything that could newly nest a page under a template
-- — except one thing this slice introduces: a page that *already has children*
-- being flagged as a template. Nothing about its own parent changed, so the
-- hierarchy trigger never runs, and the CHECK above only looks at its own
-- `parent_id`.
--
-- `setPageTemplate` refuses it in words, which is what the writer sees. This is
-- the layer underneath, and it exists for the same reason as everything else in
-- this file: the importer is a loop.
CREATE OR REPLACE FUNCTION tenancy.wiki_page_template_leaf()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.is_template AND EXISTS (
    SELECT 1 FROM public.wiki_page
    WHERE parent_id = NEW.id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a wiki page with children cannot become a template (§21.7)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER wiki_page_template_leaf_trg
BEFORE UPDATE OF is_template ON "wiki_page"
FOR EACH ROW WHEN (NEW.is_template)
EXECUTE FUNCTION tenancy.wiki_page_template_leaf();--> statement-breakpoint

-- --- No grants to unifyops_identity ------------------------------------------
-- For the reason 0010 through 0038 all give: the pre-tenancy handshake is the
-- moment before a workspace is known, and it has no business reading one word of
-- what a company has written down. That role's grant list is asserted *exactly*
-- in invariants.test.ts, so this omission is checked rather than trusted.
