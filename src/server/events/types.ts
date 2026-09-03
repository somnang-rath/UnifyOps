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
 * Slice 4 adds projects and their workflow states. Slice 5 adds work items and
 * the workspace's labels. Slice 8 adds comments, the mentions in them, and attachments.
 * Later slices extend the union; the compile error is the point.
 *
 * **Slice 9 added `assigneeIds` to the six events that can notify somebody**,
 * and it is carried rather than looked up for the reason `attachment.added`
 * already carries its `commentId`: the registry is pure. §7.8's rule — "on any
 * item change, every assignee except the person who made the change" — has to
 * be answerable from the event alone, or the third sink stops being a decision
 * table and becomes a thing that queries the database on every mutation.
 *
 * These are **member** ids, like `mentioned` and like `work_item.assignee_ids`
 * itself. They are the item's assignees *at the moment of the change*, which is
 * the list §7.8 means — not whoever happens to be assigned when a worker picks
 * the message up some seconds later.
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
  | { type: 'label.created'; workspaceId: string; labelId: string; name: string; color: string }
  | {
      type: 'label.updated';
      workspaceId: string;
      labelId: string;
      name: string;
      color: string;
      /** Set only when this update was a rename, so the log can show both. */
      previousName: string | null;
    }
  | {
      type: 'label.deleted';
      workspaceId: string;
      labelId: string;
      name: string;
      /** How many items lost the label. The reason this one is audited. */
      detachedFrom: number;
    }
  | {
      type: 'work_item.created';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      number: number;
      title: string;
      stateId: string;
      parentId: string | null;
      assigneeIds: readonly string[];
    }
  | {
      type: 'work_item.updated';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      /** Which fields changed. The activity feed (slice 7) renders one line per name. */
      fields: readonly string[];
      assigneeIds: readonly string[];
    }
  | {
      type: 'work_item.state_changed';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      from: string;
      to: string;
      /** True when the new state's group closes the item — §4 derives this from the group. */
      completed: boolean;
      assigneeIds: readonly string[];
    }
  | {
      /**
       * A drag that changed only the item's position within its own column.
       *
       * Separate from `state_changed` so exactly one event describes a drag: a
       * cross-column drag emits `state_changed`, which slice 7's feed and slice
       * 9's notifications already understand, and never both. A drag that
       * crosses no boundary is this.
       */
      type: 'work_item.moved';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      stateId: string;
    }
  | {
      type: 'work_item.assigned';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      /** §4: notifications reach every assignee except the actor, and unassignment notifies the person removed. */
      added: readonly string[];
      removed: readonly string[];
    }
  | {
      type: 'work_item.labelled';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      added: readonly string[];
      removed: readonly string[];
    }
  | {
      type: 'work_item.blocked_changed';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      blocked: boolean;
      reason: string | null;
      assigneeIds: readonly string[];
    }
  | {
      type: 'work_item.deleted';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      /** The human identifier, which is never reused (§4) — so the log can still name it. */
      number: number;
      title: string;
    }
  | {
      /**
       * Somebody wrote a comment (§7.7).
       *
       * `mentioned` carries member ids because slice 9's notifications are the
       * event stream's consumer, and §7.8's rule — every assignee except the
       * actor, plus anyone mentioned — needs the mention list at the moment the
       * comment was written, not as re-parsed from a body that may since have
       * been deleted.
       */
      type: 'comment.created';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      commentId: string;
      mentioned: readonly string[];
      assigneeIds: readonly string[];
    }
  | {
      type: 'comment.deleted';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      commentId: string;
      /**
       * False when a Lead, Admin or Owner removed somebody else's comment —
       * the §10 row that makes this event worth auditing at all.
       */
      byAuthor: boolean;
    }
  | {
      /**
       * A file became visible on an item (§7.7, §2.4).
       *
       * Emitted when the attachment becomes *readable*, not when it was asked
       * for: a ticket writes a `pending` row that nothing renders, and only the
       * step that makes the file visible — confirming an item attachment, or
       * posting the comment a file was pasted into — emits this. An event for
       * an upload that was abandoned halfway would tell slice 9 to notify
       * people about a file that does not exist.
       *
       * `commentId` is what the projectors branch on, and it is carried rather
       * than looked up because the registry is pure.
       */
      type: 'attachment.added';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      attachmentId: string;
      /** Null when the file hangs on the item itself rather than on a comment. */
      commentId: string | null;
      filename: string;
      assigneeIds: readonly string[];
    }
  | {
      type: 'attachment.removed';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      attachmentId: string;
      commentId: string | null;
      filename: string;
      /**
       * False when a Lead, Admin or Owner removed somebody else's file — the
       * same distinction `comment.deleted` carries, and for the same reason.
       */
      byUploader: boolean;
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
