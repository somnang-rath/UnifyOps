/**
 * The two closed role enums of §10, and the only place their values are
 * written down.
 *
 * Deliberately dependency-free — the schema imports these to build its
 * `pgEnum`s, not the other way round, so the policy module stays pure and the
 * database cannot drift from the matrix it is supposed to enforce.
 *
 * These are identifiers, never labels. Display names live in the message
 * catalogues; no translation key ever reaches the database (§13).
 */

/** §10. Ordered most to least privileged, which is also the display order. */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** §10. A role held *within* one project, independent of the workspace role. */
export const PROJECT_ROLES = ['lead', 'member', 'viewer'] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * Project roles are a ladder; workspace roles are not.
 *
 * "if Member+" in the §10 table is a comparison, so the ladder has to be
 * expressed once rather than re-spelled as `role === 'member' || role ===
 * 'lead'` at each of the four call sites that need it.
 */
const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  member: 2,
  lead: 3,
};

/** True when `role` is at least `minimum` on the project-role ladder. */
export function atLeastProjectRole(role: ProjectRole | null, minimum: ProjectRole): boolean {
  if (role === null) return false;
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[minimum];
}

/** The more privileged of two project roles. Used to compose implicit with explicit. */
export function highestProjectRole(a: ProjectRole | null, b: ProjectRole | null): ProjectRole | null {
  if (a === null) return b;
  if (b === null) return a;
  return PROJECT_ROLE_RANK[a] >= PROJECT_ROLE_RANK[b] ? a : b;
}
