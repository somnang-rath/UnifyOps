import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  assertCan,
  can,
  effectiveProjectRole,
  ForbiddenError,
  isMutation,
  why,
  type Action,
  type Actor,
  type Denial,
  type ProjectResource,
} from './policy';
import { WORKSPACE_ROLES, type ProjectRole, type WorkspaceRole } from './roles';

/**
 * The §10 matrix, asserted row for row.
 *
 * Written as tables rather than as prose assertions so that the test reads
 * back as the specification does — the failure message names the row of §10
 * that the code no longer implements. This is the whole of slice 2's
 * demonstrable outcome: the full permission matrix, no HTTP involved (§14).
 */

const WORKSPACE = 'w-acme';
const OTHER_WORKSPACE = 'w-other';

/** Visible to the whole workspace: the row that grants Members implicit Viewer. */
const visible: ProjectResource = {
  id: 'p-visible',
  workspaceId: WORKSPACE,
  visibility: 'workspace',
};

/** Private: nothing is implicit here for anyone below Admin. */
const secret: ProjectResource = {
  id: 'p-secret',
  workspaceId: WORKSPACE,
  visibility: 'private',
};

function actor(
  workspaceRole: WorkspaceRole,
  projectRoles: Record<string, ProjectRole> = {},
  readOnly = false,
): Actor {
  return {
    workspaceId: WORKSPACE,
    userId: 'u-1',
    workspaceRole,
    projectRoles: new Map(Object.entries(projectRoles)),
    readOnly,
  };
}

/**
 * One attempt per action, exhaustive over `Action` by construction.
 *
 * A mapped type rather than an array, for the same reason the event registry
 * is one: an action added without a rule fails to compile, and an action added
 * without a test fails here.
 */
const attempt: { [A in Action]: (a: Actor) => Denial | null } = {
  'workspace.delete': (a) => why(a, 'workspace.delete'),
  'workspace.manage_billing': (a) => why(a, 'workspace.manage_billing'),
  'workspace.settings': (a) => why(a, 'workspace.settings'),
  'workspace.manage_members': (a) => why(a, 'workspace.manage_members'),
  'workspace.view_as_member': (a) => why(a, 'workspace.view_as_member'),
  'project.create': (a) => why(a, 'project.create'),
  'project.view': (a) => why(a, 'project.view', visible),
  'project.settings': (a) => why(a, 'project.settings', visible),
  'work_item.create': (a) => why(a, 'work_item.create', visible),
  'work_item.edit': (a) => why(a, 'work_item.edit', visible),
  'comment.create': (a) => why(a, 'comment.create', visible),
  'comment.delete_others': (a) => why(a, 'comment.delete_others', visible),
};

type MatrixRow = {
  /** The §10 row, verbatim, so a failure points at the specification. */
  row: string;
  attempt: (a: Actor) => boolean;
  owner: boolean;
  admin: boolean;
  member: boolean;
  guest: boolean;
};

/**
 * The default scenario: no explicit project membership, and where a project is
 * needed it is the workspace-visible one. The conditional cells — "if member",
 * "if Lead", "if Member+" — get their own describes below.
 */
const matrix: MatrixRow[] = [
  {
    row: 'Delete workspace',
    attempt: (a) => can(a, 'workspace.delete'),
    owner: true,
    admin: false,
    member: false,
    guest: false,
  },
  {
    row: 'Manage billing',
    attempt: (a) => can(a, 'workspace.manage_billing'),
    owner: true,
    admin: false,
    member: false,
    guest: false,
  },
  {
    row: 'Workspace settings, branding, teams',
    attempt: (a) => can(a, 'workspace.settings'),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: 'Invite / remove members, change roles',
    attempt: (a) => can(a, 'workspace.manage_members'),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: 'Create project',
    attempt: (a) => can(a, 'project.create'),
    owner: true,
    admin: true,
    member: true,
    guest: false,
  },
  {
    row: 'See workspace-visible projects',
    attempt: (a) => can(a, 'project.view', visible),
    owner: true,
    admin: true,
    member: true,
    guest: false,
  },
  {
    row: 'See private project (not a member of it)',
    attempt: (a) => can(a, 'project.view', secret),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: 'Project settings, states, custom fields',
    attempt: (a) => can(a, 'project.settings', visible),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: 'Create / edit work items',
    attempt: (a) => can(a, 'work_item.create', visible) && can(a, 'work_item.edit', visible),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: 'Comment',
    attempt: (a) => can(a, 'comment.create', visible),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: "Delete others' comments",
    attempt: (a) => can(a, 'comment.delete_others', visible),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
  {
    row: 'View as a member (read-only)',
    attempt: (a) => can(a, 'workspace.view_as_member'),
    owner: true,
    admin: true,
    member: false,
    guest: false,
  },
];

describe('the §10 matrix', () => {
  for (const { row, attempt: run, ...expected } of matrix) {
    it(row, () => {
      for (const role of WORKSPACE_ROLES) {
        expect(run(actor(role)), `${row} — ${role}`).toBe(expected[role]);
      }
    });
  }

  it('covers every action the module defines', () => {
    // The compile-time gate is `attempt` being a mapped type over Action; this
    // catches the reverse — an action removed from the map at runtime.
    expect(Object.keys(attempt).sort()).toEqual([...ACTIONS].sort());
  });
});

describe('composition (§10)', () => {
  it('makes Owner and Admin implicit Leads everywhere, including private projects', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(effectiveProjectRole(actor(role), secret), role).toBe('lead');
      expect(effectiveProjectRole(actor(role), visible), role).toBe('lead');
    }
  });

  it('grants a Member implicit Viewer on a workspace-visible project, and nothing on a private one', () => {
    expect(effectiveProjectRole(actor('member'), visible)).toBe('viewer');
    expect(effectiveProjectRole(actor('member'), secret)).toBeNull();
  });

  it('grants a Guest nothing implicitly — not even on a workspace-visible project', () => {
    // The rule that makes Guest safe to hand a contractor.
    expect(effectiveProjectRole(actor('guest'), visible)).toBeNull();
    expect(effectiveProjectRole(actor('guest'), secret)).toBeNull();
  });

  it('lets an explicit role raise the implicit one, never lower it', () => {
    const lead = actor('member', { [visible.id]: 'lead' });
    expect(effectiveProjectRole(lead, visible)).toBe('lead');

    // An Admin explicitly added as Viewer is still an Admin.
    const demoted = actor('admin', { [visible.id]: 'viewer' });
    expect(effectiveProjectRole(demoted, visible)).toBe('lead');
  });

  it('ignores a project membership from another workspace', () => {
    const foreign: ProjectResource = { ...secret, workspaceId: OTHER_WORKSPACE };
    expect(effectiveProjectRole(actor('owner', { [foreign.id]: 'lead' }), foreign)).toBeNull();
  });
});

describe('"if member" — a private project', () => {
  const cases: Array<{ role: WorkspaceRole; projectRole: ProjectRole }> = [
    { role: 'member', projectRole: 'viewer' },
    { role: 'guest', projectRole: 'viewer' },
  ];

  for (const { role, projectRole } of cases) {
    it(`lets a ${role} added as ${projectRole} see it, but not write in it`, () => {
      const a = actor(role, { [secret.id]: projectRole });
      expect(can(a, 'project.view', secret)).toBe(true);
      expect(can(a, 'work_item.create', secret)).toBe(false);
      expect(can(a, 'comment.create', secret)).toBe(false);
    });
  }
});

describe('"if Member+" — write access follows the project role, for Members and Guests alike', () => {
  for (const role of ['member', 'guest'] as const) {
    it(`a ${role} explicitly added as project Member can create, edit and comment`, () => {
      const a = actor(role, { [secret.id]: 'member' });
      expect(can(a, 'work_item.create', secret)).toBe(true);
      expect(can(a, 'work_item.edit', secret)).toBe(true);
      expect(can(a, 'comment.create', secret)).toBe(true);
    });

    it(`a ${role} who is only a project Viewer cannot`, () => {
      const a = actor(role, { [secret.id]: 'viewer' });
      expect(can(a, 'work_item.create', secret)).toBe(false);
      expect(can(a, 'comment.create', secret)).toBe(false);
    });
  }
});

describe('"if Lead" — and the Guest column is a cap, not a shorthand', () => {
  it('lets a Member who leads the project change its settings and delete comments', () => {
    const a = actor('member', { [secret.id]: 'lead' });
    expect(can(a, 'project.settings', secret)).toBe(true);
    expect(can(a, 'comment.delete_others', secret)).toBe(true);
  });

  it('refuses both to a Guest even when the Guest is the project Lead', () => {
    // §10 gives Guest "—" on both rows, with no "if Lead" escape. A Guest
    // holding Lead still writes work items; they do not administer anything.
    const a = actor('guest', { [secret.id]: 'lead' });
    expect(can(a, 'project.settings', secret)).toBe(false);
    expect(can(a, 'comment.delete_others', secret)).toBe(false);
    expect(can(a, 'work_item.edit', secret)).toBe(true);
  });
});

describe('view-as (§7.13)', () => {
  const viewing = actor('owner', {}, true);

  it('refuses every mutation, and gives read_only as the reason', () => {
    for (const action of ACTIONS) {
      if (!isMutation(action)) continue;
      expect(attempt[action](viewing), action).toBe('read_only');
    }
  });

  it('still answers reads normally', () => {
    for (const action of ACTIONS) {
      if (isMutation(action)) continue;
      expect(attempt[action](viewing), action).toBeNull();
    }
  });

  it('refuses starting a nested view-as session', () => {
    expect(can(viewing, 'workspace.view_as_member')).toBe(false);
  });

  it('resolves the target member’s roles, not the viewer’s', () => {
    // The context resolves to the person being viewed, so an owner viewing as
    // a Guest sees a Guest's answers — which is the question the screen exists
    // to answer. A UI filter would have shown the owner's answers instead.
    const asGuest = actor('guest', {}, true);
    expect(can(asGuest, 'project.view', visible)).toBe(false);
    expect(can(actor('owner', {}, true), 'project.view', visible)).toBe(true);
  });
});

describe('workspace scoping', () => {
  it('refuses a resource from another workspace outright', () => {
    const foreign: ProjectResource = { ...visible, workspaceId: OTHER_WORKSPACE };
    // RLS is what makes this unreachable; the policy module is the second
    // layer, and it must not answer "allowed" for a row it should never see.
    expect(why(actor('owner'), 'project.view', foreign)).toBe('wrong_workspace');
    expect(can(actor('owner'), 'work_item.edit', foreign)).toBe(false);
  });
});

describe('assertCan', () => {
  it('passes silently when the answer is yes', () => {
    expect(() => assertCan(actor('owner'), 'workspace.settings')).not.toThrow();
  });

  it('throws a ForbiddenError carrying the action and the reason', () => {
    try {
      assertCan(actor('guest'), 'project.create');
      expect.unreachable('expected a ForbiddenError');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      const forbidden = error as ForbiddenError;
      expect(forbidden.action).toBe('project.create');
      expect(forbidden.denial).toBe('insufficient_role');
    }
  });

  it('distinguishes a view-as refusal from a role refusal', () => {
    try {
      assertCan(actor('owner', {}, true), 'workspace.settings');
      expect.unreachable('expected a ForbiddenError');
    } catch (error) {
      expect((error as ForbiddenError).denial).toBe('read_only');
    }
  });
});
