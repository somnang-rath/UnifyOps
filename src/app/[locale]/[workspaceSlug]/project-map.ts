import type { getTranslations } from 'next-intl/server';
import type { RowProject } from '@/components/views/cross-project-rows';
import type { ResolvedActor } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listProjects, type ProjectSummary } from '@/server/services/projects';
import { listWorkflowStatesFor } from '@/server/services/workflow-states';
import { displayName } from '@/lib/seeded-name';

/**
 * The scope every cross-project surface in slice 13 works from.
 *
 * §7.3's My Work and §7.4's Workload and Needs Attention all need the same two
 * things before they can draw a row: **which projects am I allowed to see**, and
 * **what are that project's states called**. Resolved once, here, because the
 * team page asks both questions on one render and a second copy of this would be
 * the first place the two screens started disagreeing about visibility.
 *
 * The project list is also the §16 **anchor**. §9's invariant refuses a
 * workspace-wide scan, and neither of these screens is one — a manager is
 * looking at an enumerated set of projects resolved before the query is built,
 * exactly as the List view is looking at one. That is what makes "unassigned
 * work" answerable at all: the `none` sentinel anchors nothing on its own (the
 * same rule slice 11 wrote for a cycle's `none`), so without this the row would
 * be the scan §16 exists to refuse.
 */

export type WorkspaceScope = {
  /** Every project this actor can see, in `listProjects` order. */
  projects: ProjectSummary[];
  /** Their ids — the anchor handed to the §9 builder. */
  projectIds: string[];
  /** What a cross-project row needs, by project id. */
  rowProjects: Map<string, RowProject>;
};

export async function resolveWorkspaceScope(
  resolved: ResolvedActor,
  t: Awaited<ReturnType<typeof getTranslations>>,
  options: { teamId?: string } = {},
): Promise<WorkspaceScope> {
  /**
   * Archived projects are left out, and this is the one caller for which that is
   * not merely the §9 default.
   *
   * §4 makes an archived project read-only — "no new items, no edits, no state
   * changes" — so its work is not work anybody can act on. My Work exists to
   * answer "what do I do today" and Needs Attention to answer "what is going
   * wrong"; neither question has an honest answer that includes a project
   * somebody deliberately closed.
   */
  const all = await listProjects(resolved);

  // §4's team filter. A team the actor cannot see any project of yields an empty
  // scope, which every surface below renders as its empty state rather than an
  // error — the same treatment a link naming a deleted filter gets (§9).
  const projects =
    options.teamId === undefined
      ? all
      : all.filter((project) => project.teamId === options.teamId);

  const projectIds = projects.map((project) => project.id);
  const states = await listWorkflowStatesFor(resolved.context, projectIds);

  const rowProjects = new Map<string, RowProject>(
    projects.map((project) => [
      project.id,
      {
        id: project.id,
        slug: project.slug,
        // §13's awkward middle: a seeded state renders translated until somebody
        // renames it, and `displayName` is the only place that rule is applied.
        // A screen reading `state.name` directly shows a Khmer workspace the
        // English word "Done".
        states: (states.get(project.id) ?? []).map((state) => ({
          id: state.id,
          name: displayName(state, t),
          color: state.color,
        })),
        canEdit: can(resolved.actor, 'work_item.edit', {
          id: project.id,
          workspaceId: resolved.workspace.id,
          visibility: project.visibility,
        }),
      },
    ]),
  );

  return { projects, projectIds, rowProjects };
}
