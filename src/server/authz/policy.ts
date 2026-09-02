import {
  atLeastProjectRole,
  highestProjectRole,
  type ProjectRole,
  type WorkspaceRole,
} from './roles';

/**
 * The §10 permission matrix, in one place.
 *
 * One central module rather than a check at each call site, because a matrix
 * scattered across route handlers is a matrix nobody can read back — and §10's
 * whole point is that a non-technical owner can be shown what the product
 * enforces. `rules` below is that table, in the same order, one entry per row.
 *
 * Pure by construction: no `next/headers`, no database handle, no clock. It
 * answers questions about an already-resolved actor, which is what makes the
 * full matrix unit-testable with no HTTP and no Postgres (§14, slice 2).
 *
 * It is authorization, not tenancy. Tenancy is RLS (§9): if this module were
 * bypassed entirely, a cross-workspace read still returns zero rows. The
 * workspace check here is the second layer, not the first.
 */

/** Whether a project is visible to the whole workspace or only to its members (§6). */
export type ProjectVisibility = 'workspace' | 'private';

/**
 * Everything the matrix needs about who is acting, resolved once per request.
 *
 * The companion of the database `ActorContext` (`src/server/db/tenant.ts`) and
 * resolved beside it: same `userId`, same `readOnly`. During view-as both
 * resolve to the *target* member, which is what makes view-as a real actor
 * context rather than a UI filter (§7.13) — the owner sees what the member
 * sees because the same table is being consulted with the member's roles.
 */
export type Actor = {
  workspaceId: string;
  /** The member whose permissions apply — the view-as target while view-as is active. */
  userId: string;
  workspaceRole: WorkspaceRole;
  /**
   * Explicit project memberships only. Implicit roles (§10 composition) are
   * derived here, never pre-baked into this map, so the composition rule has
   * exactly one implementation.
   */
  projectRoles: ReadonlyMap<string, ProjectRole>;
  /** True while view-as is active. Every mutation is refused (§7.13). */
  readOnly: boolean;
};

/** The project an action is being attempted in. Work items and comments resolve to theirs. */
export type ProjectResource = {
  id: string;
  workspaceId: string;
  visibility: ProjectVisibility;
};

/**
 * Every action the product checks, and what it needs to know to answer.
 *
 * `null` means the action is workspace-wide. Adding an action here without
 * adding its rule below is a compile error — a check cannot be forgotten by
 * omission, which is the §10 implementation note.
 */
type ResourceMap = {
  'workspace.delete': null;
  'workspace.manage_billing': null;
  'workspace.settings': null;
  'workspace.manage_members': null;
  'workspace.view_as_member': null;
  'project.create': null;
  'project.view': ProjectResource;
  'project.settings': ProjectResource;
  'work_item.create': ProjectResource;
  'work_item.edit': ProjectResource;
  'comment.create': ProjectResource;
  'comment.delete_others': ProjectResource;
};

export type Action = keyof ResourceMap;

/** `can(actor, 'project.create')` but `can(actor, 'project.view', project)` — enforced by the type. */
type ResourceArgs<A extends Action> = ResourceMap[A] extends null ? [] : [resource: ResourceMap[A]];

type Rule<A extends Action> = {
  /**
   * Mutations are refused outright while view-as is active. Marking it per
   * action rather than inferring it from the name means a new read-only action
   * cannot be accidentally blocked, and a new mutation cannot silently slip
   * through a view-as session.
   */
  mutation: boolean;
  allow: (actor: Actor, resource: ResourceMap[A]) => boolean;
};

const isOwner = (actor: Actor) => actor.workspaceRole === 'owner';
const isAdminOrAbove = (actor: Actor) =>
  actor.workspaceRole === 'owner' || actor.workspaceRole === 'admin';

/**
 * §10 composition, and the only place it is implemented.
 *
 * - Owner and Admin are implicit Leads everywhere.
 * - A workspace-visible project grants Members an implicit Viewer.
 * - **Guests get nothing implicitly** — only projects they are explicitly
 *   added to. That single line is what makes Guest safe to hand a contractor,
 *   so it is a rule here rather than a convention at call sites.
 *
 * An explicit membership composes with the implicit one rather than replacing
 * it: a Member explicitly added as Lead is a Lead, and a Member explicitly
 * added as Viewer to a workspace-visible project is still a Viewer.
 */
export function effectiveProjectRole(actor: Actor, project: ProjectResource): ProjectRole | null {
  if (project.workspaceId !== actor.workspaceId) return null;

  const explicit = actor.projectRoles.get(project.id) ?? null;

  if (isAdminOrAbove(actor)) return 'lead';

  const implicit: ProjectRole | null =
    actor.workspaceRole === 'member' && project.visibility === 'workspace' ? 'viewer' : null;

  return highestProjectRole(implicit, explicit);
}

/**
 * The §10 table, row for row.
 *
 * Exhaustive over `Action` by construction: this is a mapped type, so an
 * action without a rule does not compile.
 */
const rules: { [A in Action]: Rule<A> } = {
  // | Delete workspace, manage billing | Y | - | - | - |
  'workspace.delete': { mutation: true, allow: isOwner },
  'workspace.manage_billing': { mutation: true, allow: isOwner },

  // | Workspace settings, branding, teams | Y | Y | - | - |
  'workspace.settings': { mutation: true, allow: isAdminOrAbove },

  // | Invite / remove members, change roles | Y | Y | - | - |
  'workspace.manage_members': { mutation: true, allow: isAdminOrAbove },

  // | View as a member (read-only) | Y | Y | - | - |
  // A mutation despite being a read-only session: starting one is logged
  // against the viewer (§7.13), and nesting view-as inside view-as is not a
  // thing an owner ever means to do.
  'workspace.view_as_member': { mutation: true, allow: isAdminOrAbove },

  // | Create project | Y | Y | Y | - |
  'project.create': {
    mutation: true,
    allow: (actor) => actor.workspaceRole !== 'guest',
  },

  // | See workspace-visible projects | Y | Y | Y | - |
  // | See private project | Y | Y | if member | if member |
  // Both rows are the same question once composition has been applied.
  'project.view': {
    mutation: false,
    allow: (actor, project) => effectiveProjectRole(actor, project) !== null,
  },

  // | Project settings, states, custom fields | Y | Y | if Lead | - |
  // The Guest column is a cap, not a shorthand: a Guest made project Lead
  // still cannot change project settings.
  'project.settings': {
    mutation: true,
    allow: (actor, project) =>
      actor.workspaceRole !== 'guest' &&
      atLeastProjectRole(effectiveProjectRole(actor, project), 'lead'),
  },

  // | Create / edit work items | Y | Y | if Member+ | if Member+ |
  'work_item.create': {
    mutation: true,
    allow: (actor, project) => atLeastProjectRole(effectiveProjectRole(actor, project), 'member'),
  },
  'work_item.edit': {
    mutation: true,
    allow: (actor, project) => atLeastProjectRole(effectiveProjectRole(actor, project), 'member'),
  },

  // | Comment | Y | Y | if Member+ | if Member+ |
  'comment.create': {
    mutation: true,
    allow: (actor, project) => atLeastProjectRole(effectiveProjectRole(actor, project), 'member'),
  },

  // | Delete others' comments | Y | Y | if Lead | - |
  'comment.delete_others': {
    mutation: true,
    allow: (actor, project) =>
      actor.workspaceRole !== 'guest' &&
      atLeastProjectRole(effectiveProjectRole(actor, project), 'lead'),
  },
};

/**
 * Every action, at runtime.
 *
 * The type is the gate that stops an action from being added without a rule;
 * this is what lets a settings screen — or a test — walk the whole matrix
 * rather than a list someone remembered to keep current.
 */
export const ACTIONS = Object.freeze(Object.keys(rules) as Action[]);

/** Whether an action is refused outright while view-as is active (§7.13). */
export function isMutation(action: Action): boolean {
  return rules[action].mutation;
}

/**
 * Why an action was refused, or `null` when it was allowed.
 *
 * A reason rather than a bare `false` because §11 asks a rejected drag to
 * animate back *with a toast explaining why*, and "you are in view-as" and
 * "you are not a Lead" are different sentences. These are identifiers; the
 * sentences themselves come from the message catalogues, in both languages.
 */
export type Denial = 'read_only' | 'wrong_workspace' | 'insufficient_role';

export function why<A extends Action>(
  actor: Actor,
  action: A,
  ...args: ResourceArgs<A>
): Denial | null {
  // The action-to-resource correspondence is exact by construction above, but
  // TypeScript cannot narrow `action` and `rule` together through an index
  // signature, so this is the one place the correlation is asserted.
  const rule = rules[action] as Rule<Action>;
  const resource = (args[0] ?? null) as ResourceMap[Action];

  if (rule.mutation && actor.readOnly) return 'read_only';

  // Defence in depth. RLS already makes a cross-workspace resource unreachable;
  // reaching this branch means something upstream handed us a row it should
  // never have had, and answering "allowed" would be the worse failure.
  if (resource !== null && resource.workspaceId !== actor.workspaceId) return 'wrong_workspace';

  return rule.allow(actor, resource) ? null : 'insufficient_role';
}

/** The §10 entry point. `can(ctx, action, resource)`. */
export function can<A extends Action>(actor: Actor, action: A, ...args: ResourceArgs<A>): boolean {
  return why(actor, action, ...args) === null;
}

export class ForbiddenError extends Error {
  constructor(
    readonly action: Action,
    readonly denial: Denial,
  ) {
    super(`${action} refused: ${denial}`);
    this.name = 'ForbiddenError';
  }
}

/**
 * `can`, for the call sites that should not continue when the answer is no.
 *
 * The message is developer-facing and never rendered to a user — user-visible
 * refusals are translated, and an English string from the server would be the
 * one place Khmer degrades (§13).
 */
export function assertCan<A extends Action>(
  actor: Actor,
  action: A,
  ...args: ResourceArgs<A>
): void {
  const denial = why(actor, action, ...args);
  if (denial !== null) throw new ForbiddenError(action, denial);
}
