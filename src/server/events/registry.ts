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

/**
 * How an event becomes rows in a work item's activity feed (§8, slice 7).
 *
 * A *list*, not a single row, because one event is sometimes several lines: an
 * edit that moved three fields reads as three changes, and assigning two people
 * while unassigning a third is three things that happened, not one. The event
 * stays the unit of intent; the feed is the unit of reading.
 *
 * `false` is a decision with the same weight as `audit: false`. Activity is
 * per item (§9 hangs it under WorkItem), so everything that is not about a work
 * item projects to nothing — and two events that *are* about one still project
 * to nothing, for reasons written at their entries.
 */
export type ActivitySpec<T extends EventType> = (event: EventOf<T>) => ActivityDraft[];

export type RegistryEntry<T extends EventType> = {
  audit: AuditSpec<T> | false;
  /**
   * The activity projector (§8, §14 slice 7). A second field on this same entry
   * for the same reason `audit` is one: the registry is exhaustive over the
   * event union, so a new event type cannot be added without deciding how it
   * renders in the feed.
   */
  activity: ActivitySpec<T> | false;
};

/**
 * One line of a feed, before the actor and the workspace are attached.
 *
 * `action` is the event type rather than a phrasing: §13 keeps translation keys
 * out of the database, so what is stored is the closed identifier and the
 * renderer owns the sentence. `data` carries ids and values for it to resolve —
 * never a name, which would freeze at the moment of writing and read as English
 * in a Khmer workspace.
 */
export type ActivityDraft = {
  workItemId: string;
  projectId: string;
  action: EventType;
  data: Record<string, unknown>;
};

/** Nothing about a work item happened, so nothing lands in any item's feed. */
const noActivity = false as const;

/**
 * One feed line for an event that already names its item and project.
 *
 * Every work-item event carries both, so the projectors below differ only in
 * what they put in `data` — which is the part worth reading.
 */
const onItem = (
  event: { type: EventType; workItemId: string; projectId: string },
  data: Record<string, unknown> = {},
): ActivityDraft => ({
  workItemId: event.workItemId,
  projectId: event.projectId,
  action: event.type,
  data,
});

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
    activity: noActivity,
  },
  'workspace.renamed': {
    audit: {
      subjectType: 'workspace',
      subject: (e) => e.workspaceId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
    activity: noActivity,
  },
  'workspace_member.added': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ userId: e.userId, role: e.role }),
    },
    activity: noActivity,
  },
  'workspace_member.role_changed': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
    activity: noActivity,
  },
  'workspace_member.removed': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ userId: e.userId }),
    },
    activity: noActivity,
  },
  'team.created': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ slug: e.slug, name: e.name }),
    },
    activity: noActivity,
  },
  'team.renamed': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
    activity: noActivity,
  },
  'team.deleted': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ name: e.name }),
    },
    activity: noActivity,
  },
  // Team composition changes are ordinary collaboration, visible in the team's
  // own screens. They are activity, not audit.
  'team.member_added': { audit: false, activity: noActivity },
  'team.member_removed': { audit: false, activity: noActivity },

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
    activity: noActivity,
  },
  'invitation.resent': {
    audit: {
      subjectType: 'invitation',
      subject: (e) => e.invitationId,
      data: (e) => ({ email: e.email }),
    },
    activity: noActivity,
  },
  'invitation.revoked': {
    audit: {
      subjectType: 'invitation',
      subject: (e) => e.invitationId,
      data: (e) => ({ email: e.email }),
    },
    activity: noActivity,
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
    activity: noActivity,
  },
  'project.renamed': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
    activity: noActivity,
  },
  'project.visibility_changed': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
    activity: noActivity,
  },
  'project.archived': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ name: e.name }),
    },
    activity: noActivity,
  },
  'project.unarchived': {
    audit: {
      subjectType: 'project',
      subject: (e) => e.projectId,
      data: (e) => ({ name: e.name }),
    },
    activity: noActivity,
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
    activity: noActivity,
  },
  'project.member_role_changed': {
    audit: {
      subjectType: 'project_member',
      subject: (e) => e.memberId,
      data: (e) => ({ projectId: e.projectId, from: e.from, to: e.to }),
    },
    activity: noActivity,
  },
  'project.member_removed': {
    audit: {
      subjectType: 'project_member',
      subject: (e) => e.memberId,
      data: (e) => ({ projectId: e.projectId }),
    },
    activity: noActivity,
  },

  // Configuring a board is ordinary work a Lead does in the open, and it is
  // frequent — three columns renamed while setting a project up would bury the
  // membership changes the audit log exists for. Activity, not audit (slice 7).
  'workflow_state.created': { audit: false, activity: noActivity },
  'workflow_state.updated': { audit: false, activity: noActivity },
  'workflow_state.reordered': { audit: false, activity: noActivity },

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
    activity: noActivity,
  },

  // Labels are workspace vocabulary an Owner or Admin maintains. Creating and
  // renaming one is ordinary upkeep; deleting one is not, because it strips the
  // label from every item carrying it — a change to a body of work made by
  // somebody who was looking at a settings screen, which is exactly the shape
  // of thing the log exists to explain later.
  'label.created': { audit: false, activity: noActivity },
  'label.updated': { audit: false, activity: noActivity },
  'label.deleted': {
    audit: {
      subjectType: 'label',
      subject: (e) => e.labelId,
      data: (e) => ({ name: e.name, detachedFrom: e.detachedFrom }),
    },
    activity: noActivity,
  },

  // The whole point of §18-11 is that `audit_record` stays readable. Work items
  // change constantly — a title edited, a card dragged, an assignee swapped —
  // and routing that stream into the log an owner opens to ask "who removed
  // Sophea's access" would bury the answer under a day's ordinary work. All of
  // it is activity (slice 7), which is per-item, translated, and where somebody
  // actually goes looking for it.
  'work_item.created': {
    audit: false,
    // The line every feed opens with. No payload: the item's own header already
    // says what it is called and where it sits, and repeating the title here
    // would be the one copy that does not update when somebody renames it.
    activity: (e) => [onItem(e)],
  },
  'work_item.updated': {
    audit: false,
    // One line per field, not one line saying "edited". A feed that reads
    // "changed the due date" answers the question somebody opened it with;
    // "edited this item" makes them go and compare two screens.
    activity: (e) => e.fields.map((field) => onItem(e, { field })),
  },
  'work_item.state_changed': {
    audit: false,
    // State ids rather than names, because a state that is renamed after the
    // fact should read under its new name — and because a name written here in
    // 2026 would be English forever in a Khmer workspace (§13). `completed` is
    // carried so the feed can mark the transition that finished the work
    // without re-deriving a state's group months later, by which time the state
    // may not exist.
    activity: (e) => [onItem(e, { from: e.from, to: e.to, completed: e.completed })],
  },

  // Reordering a backlog is not a consequential act, and a log that records
  // every drag is a log nobody reads when it matters. The event exists for
  // slice 7's feed, which will also choose to say nothing about it.
  'work_item.moved': {
    audit: false,
    // Neither log wants this one. Reordering a backlog is not consequential
    // enough for audit, and in a feed it is worse than useless: a card nudged
    // three places up a column would push the state change somebody is actually
    // looking for off the screen. The event still exists — slice 9's outbox and
    // the board's own revalidation both read the stream, not the projections.
    activity: noActivity,
  },

  'work_item.assigned': {
    audit: false,
    // Assignment is a set operation but a *narrative* of individual changes:
    // adding two people and dropping a third is three things that happened to
    // three people, and §4 already treats them separately for notifications.
    activity: (e) => [
      ...e.added.map((memberId) => onItem(e, { memberId, assigned: true })),
      ...e.removed.map((memberId) => onItem(e, { memberId, assigned: false })),
    ],
  },
  'work_item.labelled': {
    audit: false,
    activity: (e) => [
      ...e.added.map((labelId) => onItem(e, { labelId, applied: true })),
      ...e.removed.map((labelId) => onItem(e, { labelId, applied: false })),
    ],
  },
  'work_item.blocked_changed': {
    audit: false,
    // The reason is carried, unlike every other name and value here, because it
    // is free text a person typed about this moment. It is not a reference to a
    // row that could be renamed, and the current reason on the item is the
    // *current* one — the feed is where "why was this stuck in March" is asked.
    activity: (e) => [onItem(e, { blocked: e.blocked, reason: e.reason })],
  },

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
    activity: noActivity,
  },

  // A comment is ordinary collaboration and the highest-volume thing a person
  // does on an item, so it is not audit (§18-11) — and it is not activity
  // either, which is the one entry here whose `false` is about the *screen*
  // rather than about the log. The thread sits directly above the feed on the
  // same page. A feed line reading "Sophea commented", an inch below Sophea's
  // comment, is the redundancy that teaches people the feed is noise.
  //
  // The event still matters: slice 9's notifications read the stream, not the
  // projections, and `mentioned` is how §7.8 reaches the people named in it.
  'comment.created': { audit: false, activity: noActivity },

  // The exception, for the reason `work_item.deleted` is one: this destroys
  // something a person wrote rather than changing it. §10 gives Owners, Admins
  // and project Leads the power to delete somebody *else's* comment, and
  // `byAuthor` is what separates that act from a person retracting their own —
  // "who removed the client's complaint" is exactly the question this log
  // exists to answer, and the deleted comment's own thread cannot answer it.
  'comment.deleted': {
    audit: {
      subjectType: 'comment',
      subject: (e) => e.commentId,
      // The body is deliberately not carried. An audit row is Owner- and
      // Admin-visible and never expires; copying the text of a comment into it
      // would make the log a second, permanent home for something a person may
      // have deleted precisely because it should not have been written.
      data: (e) => ({ workItemId: e.workItemId, projectId: e.projectId, byAuthor: e.byAuthor }),
    },
    activity: noActivity,
  },

  // A file arriving is ordinary collaboration, so it is not audit — but unlike
  // a comment it *is* activity, on one condition. A file pasted into a comment
  // is already rendered an inch above the feed, inside the comment that carries
  // it, and a line saying so would be the same redundancy `comment.created`
  // refuses. A file dropped on the item itself has nothing else announcing it,
  // and "when did the signed contract appear on this" is exactly what somebody
  // opens a feed to answer.
  'attachment.added': {
    audit: false,
    // The filename is carried, which is the same exception `blocked_changed`
    // makes for its reason: it is not a reference to a row that could be
    // renamed later, it is a string describing this moment. It also has to
    // survive the file being removed, or the line reads "attached a file" with
    // no way left to find out which.
    activity: (e) =>
      e.commentId === null ? [onItem(e, { attachmentId: e.attachmentId, filename: e.filename })] : [],
  },

  // The exception, and the third member of the family `work_item.deleted` and
  // `comment.deleted` belong to: this destroys something a person contributed
  // rather than changing it, and §10's Lead power reaches other people's files
  // exactly as it reaches their comments. `byUploader` is what separates a
  // person removing their own screenshot from a Lead removing somebody else's
  // document — the second is the question the log exists to answer.
  //
  // The filename is carried here where `comment.deleted` withholds the body,
  // and the difference is not inconsistency: a body is the content, and copying
  // it into a permanent Owner-visible log would give a retracted comment a
  // second home. A filename is the *identifier* of the thing removed, and a log
  // that cannot say which file was deleted records nothing worth keeping.
  'attachment.removed': {
    audit: {
      subjectType: 'attachment',
      subject: (e) => e.attachmentId,
      data: (e) => ({
        workItemId: e.workItemId,
        projectId: e.projectId,
        filename: e.filename,
        byUploader: e.byUploader,
      }),
    },
    // Mirrors `added`, so a panel's history does not show a file arriving and
    // then silently stop mentioning it.
    activity: (e) =>
      e.commentId === null ? [onItem(e, { attachmentId: e.attachmentId, filename: e.filename })] : [],
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
    activity: noActivity,
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

/**
 * The activity rows an event produces — empty when the registry says it
 * projects to nothing.
 *
 * A list rather than a nullable row, so "this event is not activity" and "this
 * edit changed no fields" are the same answer at the call site: nothing to
 * write. `flush` then has one branch instead of two.
 */
export function activityRowsFor(event: DomainEvent): ActivityDraft[] {
  // Same narrowing limitation as `auditRowFor`: the union-to-entry
  // correspondence is exact by construction, but TypeScript cannot follow
  // `event` and `entry` through an index signature together.
  const entry = eventRegistry[event.type] as RegistryEntry<EventType>;
  const spec = entry.activity as ActivitySpec<EventType> | false;
  if (!spec) return [];

  return spec(event);
}
