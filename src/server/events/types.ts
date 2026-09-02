/**
 * The domain event union.
 *
 * Every entry in this union must appear in the registry (src/server/events/registry.ts)
 * — the registry is a mapped type over `DomainEvent['type']`, so adding a
 * member here without deciding its handling is a compile error rather than a
 * silently unaudited, unprojected change.
 *
 * Slice 1 carried only the events the tenancy foundation itself can emit; slice
 * 3 adds the membership lifecycle — invitations, teams, joining and leaving.
 * Slice 4 adds projects and their workflow states.
 * Later slices extend the union; the compile error is the point.
 */
export type DomainEvent =
  | { type: 'workspace.created'; workspaceId: string; slug: string; name: string }
  | { type: 'workspace.renamed'; workspaceId: string; from: string; to: string }
  | {
      type: 'workspace_member.added';
      workspaceId: string;
      memberId: string;
      userId: string;
      role: string;
    }
  | {
      type: 'workspace_member.role_changed';
      workspaceId: string;
      memberId: string;
      from: string;
      to: string;
    }
  | { type: 'workspace_member.removed'; workspaceId: string; memberId: string; userId: string }
  | { type: 'team.created'; workspaceId: string; teamId: string; slug: string; name: string }
  | { type: 'team.renamed'; workspaceId: string; teamId: string; from: string; to: string }
  | { type: 'team.deleted'; workspaceId: string; teamId: string; name: string }
  | { type: 'team.member_added'; workspaceId: string; teamId: string; memberId: string }
  | { type: 'team.member_removed'; workspaceId: string; teamId: string; memberId: string }
  | {
      type: 'invitation.sent';
      workspaceId: string;
      invitationId: string;
      email: string;
      role: string;
    }
  | { type: 'invitation.resent'; workspaceId: string; invitationId: string; email: string }
  | { type: 'invitation.revoked'; workspaceId: string; invitationId: string; email: string }
  | {
      type: 'project.created';
      workspaceId: string;
      projectId: string;
      teamId: string;
      slug: string;
      key: string;
      name: string;
      visibility: string;
    }
  | { type: 'project.renamed'; workspaceId: string; projectId: string; from: string; to: string }
  | {
      type: 'project.visibility_changed';
      workspaceId: string;
      projectId: string;
      from: string;
      to: string;
    }
  | { type: 'project.archived'; workspaceId: string; projectId: string; name: string }
  | { type: 'project.unarchived'; workspaceId: string; projectId: string; name: string }
  | {
      type: 'project.member_added';
      workspaceId: string;
      projectId: string;
      memberId: string;
      role: string;
    }
  | {
      type: 'project.member_role_changed';
      workspaceId: string;
      projectId: string;
      memberId: string;
      from: string;
      to: string;
    }
  | { type: 'project.member_removed'; workspaceId: string; projectId: string; memberId: string }
  | {
      type: 'workflow_state.created';
      workspaceId: string;
      projectId: string;
      stateId: string;
      name: string;
      group: string;
    }
  | {
      type: 'workflow_state.updated';
      workspaceId: string;
      projectId: string;
      stateId: string;
      name: string;
      group: string;
      color: string;
      /** Set only when this update was a rename, so the log can show both. */
      previousName: string | null;
    }
  | {
      type: 'workflow_state.reordered';
      workspaceId: string;
      projectId: string;
      /** State ids, in their new left-to-right order. */
      order: readonly string[];
    }
  | {
      type: 'workflow_state.deleted';
      workspaceId: string;
      projectId: string;
      stateId: string;
      name: string;
      /** Where the items went. Null only when the state held none. */
      migratedToStateId: string | null;
    }
  | {
      type: 'invitation.accepted';
      workspaceId: string;
      invitationId: string;
      email: string;
      userId: string;
      memberId: string;
    };

export type EventType = DomainEvent['type'];

export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;
