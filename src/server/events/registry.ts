import type { DomainEvent, EventOf, EventType } from './types';

/**
 * How an audited event becomes an audit row (§18-11).
 *
 * `audit: false` is an explicit decision, not an omission — an ordinary title
 * edit does not belong in a workspace-scoped, append-only, never-translated
 * log, and saying so here is what keeps the log readable.
 *
 * `data` exists so the payload written to the log is chosen rather than
 * inherited. Events carry whatever their caller needed; an audit row should
 * carry what an owner reading it six months later needs, and nothing they
 * should not see.
 */
export type AuditSpec<T extends EventType> = {
  subjectType: string;
  subject: (event: EventOf<T>) => string | null;
  data?: (event: EventOf<T>) => Record<string, unknown>;
};

export type RegistryEntry<T extends EventType> = {
  audit: AuditSpec<T> | false;
  /**
   * The activity projector lands in slice 7 (§8, §14). It is a second field on
   * this same entry for the same reason `audit` is one: exhaustive over the
   * event union, so a new event type cannot be added without deciding how it
   * renders in the feed.
   */
};

/**
 * Exhaustive over `DomainEvent` by construction. Adding a member to the union
 * without adding it here does not compile.
 */
export const eventRegistry: { [T in EventType]: RegistryEntry<T> } = {
  'workspace.created': {
    audit: {
      subjectType: 'workspace',
      subject: (e) => e.workspaceId,
      data: (e) => ({ slug: e.slug, name: e.name }),
    },
  },
  'workspace.renamed': {
    audit: {
      subjectType: 'workspace',
      subject: (e) => e.workspaceId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'workspace_member.added': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ userId: e.userId, role: e.role }),
    },
  },
  'workspace_member.role_changed': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'workspace_member.removed': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ userId: e.userId }),
    },
  },
  'team.created': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ slug: e.slug, name: e.name }),
    },
  },
  'team.renamed': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'team.deleted': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ name: e.name }),
    },
  },
  // Team composition changes are ordinary collaboration, visible in the team's
  // own screens. They are activity, not audit.
  'team.member_added': { audit: false },
  'team.member_removed': { audit: false },

  // Who was invited, by whom, in what role — and who actually walked through
  // the door. This is the sequence an owner reconstructs when they find an
  // account they do not recognise, so all four are audited even though only two
  // change anything a member would notice.
  'invitation.sent': {
    audit: {
      subjectType: 'invitation',
      subject: (e) => e.invitationId,
      data: (e) => ({ email: e.email, role: e.role }),
    },
  },
  'invitation.resent': {
    audit: {
      subjectType: 'invitation',
      subject: (e) => e.invitationId,
      data: (e) => ({ email: e.email }),
    },
  },
  'invitation.revoked': {
    audit: {
      subjectType: 'invitation',
      subject: (e) => e.invitationId,
      data: (e) => ({ email: e.email }),
    },
  },
  // A project is where work lives and who can see it, so its lifecycle is
  // audited: created, renamed, archived (which makes it read-only), and above
  // all made private or workspace-visible — the one setting that changes who
  // can read a body of work without anyone being added or removed.
  'project.created': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ slug: e.slug, key: e.key, name: e.name, teamId: e.teamId, visibility: e.visibility }),
    },
  },
  'project.renamed': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'project.visibility_changed': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'project.archived': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ name: e.name }),
    },
  },
  'project.unarchived': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ name: e.name }),
    },
  },

  // Project membership is an access grant — it is how a Guest reaches a private
  // project at all — so unlike team composition it belongs in the log an owner
  // reads to reconstruct how someone got to something.
  'project.member_added': {
    audit: {
      subjectType: 'project_member',
      subject: (e) => e.memberId,
      data: (e) => ({ projectId: e.projectId, role: e.role }),
    },
  },
  'project.member_role_changed': {
    audit: {
      subjectType: 'project_member',
      subject: (e) => e.memberId,
      data: (e) => ({ projectId: e.projectId, from: e.from, to: e.to }),
    },
  },
  'project.member_removed': {
    audit: {
      subjectType: 'project_member',
      subject: (e) => e.memberId,
      data: (e) => ({ projectId: e.projectId }),
    },
  },

  // Configuring a board is ordinary work a Lead does in the open, and it is
  // frequent — three columns renamed while setting a project up would bury the
  // membership changes the audit log exists for. Activity, not audit (slice 7).
  'workflow_state.created': { audit: false },
  'workflow_state.updated': { audit: false },
  'workflow_state.reordered': { audit: false },

  // The exception, and §4 says why: deleting a state that holds items forces a
  // choice about where they go, and that choice moves work nobody else agreed
  // to move. The row records both the state and where its items went.
  'workflow_state.deleted': {
    audit: {
      subjectType: 'workflow_state',
      subject: (e) => e.stateId,
      data: (e) => ({
        projectId: e.projectId,
        name: e.name,
        migratedToStateId: e.migratedToStateId,
      }),
    },
  },

  // Labels are workspace vocabulary an Owner or Admin maintains. Creating and
  // renaming one is ordinary upkeep; deleting one is not, because it strips the
  // label from every item carrying it — a change to a body of work made by
  // somebody who was looking at a settings screen, which is exactly the shape
  // of thing the log exists to explain later.
  'label.created': { audit: false },
  'label.updated': { audit: false },
  'label.deleted': {
    audit: {
      subjectType: 'label',
      subject: (e) => e.labelId,
      data: (e) => ({ name: e.name, detachedFrom: e.detachedFrom }),
    },
  },

  // The whole point of §18-11 is that `audit_record` stays readable. Work items
  // change constantly — a title edited, a card dragged, an assignee swapped —
  // and routing that stream into the log an owner opens to ask "who removed
  // Sophea's access" would bury the answer under a day's ordinary work. All of
  // it is activity (slice 7), which is per-item, translated, and where somebody
  // actually goes looking for it.
  'work_item.created': { audit: false },
  'work_item.updated': { audit: false },
  'work_item.state_changed': { audit: false },

  // Reordering a backlog is not a consequential act, and a log that records
  // every drag is a log nobody reads when it matters. The event exists for
  // slice 7's feed, which will also choose to say nothing about it.
  'work_item.moved': { audit: false },

  'work_item.assigned': { audit: false },
  'work_item.labelled': { audit: false },
  'work_item.blocked_changed': { audit: false },

  // The exception, for the reason `workflow_state.deleted` is one: this is the
  // only work-item action that destroys work rather than changing it, and the
  // item's own activity feed disappears along with it — so the record has to
  // live somewhere the item does not.
  'work_item.deleted': {
    audit: {
      subjectType: 'work_item',
      subject: (e) => e.workItemId,
      data: (e) => ({ projectId: e.projectId, number: e.number, title: e.title }),
    },
  },

  'invitation.accepted': {
    audit: {
      subjectType: 'invitation',
      subject: (e) => e.invitationId,
      // The user id as well as the address: an invitation can be accepted by
      // an account whose address differs from the one invited — the link is
      // the credential — and the log is where that becomes visible.
      data: (e) => ({ email: e.email, userId: e.userId, memberId: e.memberId }),
    },
  },
};

export type AuditDraft = {
  action: EventType;
  subjectType: string;
  subjectId: string | null;
  data: Record<string, unknown>;
};

/** The audit row an event produces, or null when the registry says it is not auditable. */
export function auditRowFor(event: DomainEvent): AuditDraft | null {
  // The union-to-entry correspondence is exact by construction above, but
  // TypeScript cannot narrow `event` and `entry` together through an index
  // signature, so this is the one place the correlation is asserted.
  const entry = eventRegistry[event.type] as RegistryEntry<EventType>;
  const spec = entry.audit as AuditSpec<EventType> | false;
  if (!spec) return null;

  return {
    action: event.type,
    subjectType: spec.subjectType,
    subjectId: spec.subject(event),
    data: spec.data?.(event) ?? {},
  };
}
