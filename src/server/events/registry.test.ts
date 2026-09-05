import { describe, expect, it } from 'vitest';
import { activityRowsFor, auditRowFor, eventRegistry, notifyDraftsFor } from './registry';
import type { DomainEvent, EventType } from './types';

/**
 * The registry's real guarantee is a compile error, not a test: it is a mapped
 * type over the event union, so adding an event without deciding whether it is
 * auditable does not build. These tests cover what the type cannot — that the
 * decision, once made, is actually carried out.
 */

const sample: { [T in EventType]: Extract<DomainEvent, { type: T }> } = {
  'workspace.created': {
    type: 'workspace.created',
    workspaceId: 'w1',
    slug: 'acme',
    name: 'Acme',
  },
  'workspace.renamed': { type: 'workspace.renamed', workspaceId: 'w1', from: 'Acme', to: 'Acme Co' },
  'workspace.slug_changed': {
    type: 'workspace.slug_changed',
    workspaceId: 'w1',
    from: 'acme',
    to: 'acme-co',
  },
  'workspace.settings_changed': {
    type: 'workspace.settings_changed',
    workspaceId: 'w1',
    changed: ['timezone'],
    timezone: 'Asia/Phnom_Penh',
    workingDays: 63,
    weekStart: 0,
    defaultLocale: 'km',
  },
  'workspace.branding_changed': {
    type: 'workspace.branding_changed',
    workspaceId: 'w1',
    changed: ['accent'],
    accent: 'sky',
    hasLogo: false,
  },
  'workspace.holidays_changed': {
    type: 'workspace.holidays_changed',
    workspaceId: 'w1',
    added: 10,
    removed: 0,
    years: [2026],
  },
  'workspace.view_as_started': {
    type: 'workspace.view_as_started',
    workspaceId: 'w1',
    targetMemberId: 'm2',
    targetUserId: 'u2',
  },
  'workspace.view_as_ended': {
    type: 'workspace.view_as_ended',
    workspaceId: 'w1',
    targetMemberId: 'm2',
    targetUserId: 'u2',
  },
  'workspace.notification_defaults_changed': {
    type: 'workspace.notification_defaults_changed',
    workspaceId: 'w1',
    kind: 'mention',
    channels: ['in_app'],
  },
  'workspace_member.work_reassigned': {
    type: 'workspace_member.work_reassigned',
    workspaceId: 'w1',
    fromMemberId: 'm1',
    toMemberId: 'm2',
    items: [{ workItemId: 'i1', projectId: 'p1' }],
  },
  'workspace_member.added': {
    type: 'workspace_member.added',
    workspaceId: 'w1',
    memberId: 'm1',
    userId: 'u1',
    role: 'member',
  },
  'workspace_member.role_changed': {
    type: 'workspace_member.role_changed',
    workspaceId: 'w1',
    memberId: 'm1',
    from: 'member',
    to: 'admin',
  },
  'workspace_member.removed': {
    type: 'workspace_member.removed',
    workspaceId: 'w1',
    memberId: 'm1',
    userId: 'u1',
  },
  'workspace_member.availability_changed': {
    type: 'workspace_member.availability_changed',
    workspaceId: 'w1',
    memberId: 'm1',
    from: null,
    to: '2026-09-20',
  },
  'team.created': { type: 'team.created', workspaceId: 'w1', teamId: 't1', slug: 'eng', name: 'Eng' },
  'team.renamed': { type: 'team.renamed', workspaceId: 'w1', teamId: 't1', from: 'Eng', to: 'Product' },
  'team.deleted': { type: 'team.deleted', workspaceId: 'w1', teamId: 't1', name: 'Eng' },
  'team.member_added': {
    type: 'team.member_added',
    workspaceId: 'w1',
    teamId: 't1',
    memberId: 'm1',
  },
  'team.member_removed': {
    type: 'team.member_removed',
    workspaceId: 'w1',
    teamId: 't1',
    memberId: 'm1',
  },
  'invitation.sent': {
    type: 'invitation.sent',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
    role: 'member',
  },
  'invitation.resent': {
    type: 'invitation.resent',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
  },
  'invitation.revoked': {
    type: 'invitation.revoked',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
  },
  'project.created': {
    type: 'project.created',
    workspaceId: 'w1',
    projectId: 'p1',
    teamId: 't1',
    slug: 'website',
    key: 'WEB',
    name: 'Website',
    visibility: 'workspace',
  },
  'project.renamed': {
    type: 'project.renamed',
    workspaceId: 'w1',
    projectId: 'p1',
    from: 'Website',
    to: 'Web Platform',
  },
  'project.visibility_changed': {
    type: 'project.visibility_changed',
    workspaceId: 'w1',
    projectId: 'p1',
    from: 'workspace',
    to: 'private',
  },
  'project.archived': {
    type: 'project.archived',
    workspaceId: 'w1',
    projectId: 'p1',
    name: 'Website',
  },
  'project.unarchived': {
    type: 'project.unarchived',
    workspaceId: 'w1',
    projectId: 'p1',
    name: 'Website',
  },
  'project.member_added': {
    type: 'project.member_added',
    workspaceId: 'w1',
    projectId: 'p1',
    memberId: 'm1',
    role: 'lead',
  },
  'project.member_role_changed': {
    type: 'project.member_role_changed',
    workspaceId: 'w1',
    projectId: 'p1',
    memberId: 'm1',
    from: 'member',
    to: 'lead',
  },
  'project.member_removed': {
    type: 'project.member_removed',
    workspaceId: 'w1',
    projectId: 'p1',
    memberId: 'm1',
  },
  'workflow_state.created': {
    type: 'workflow_state.created',
    workspaceId: 'w1',
    projectId: 'p1',
    stateId: 's1',
    name: 'In Review',
    group: 'started',
  },
  'workflow_state.updated': {
    type: 'workflow_state.updated',
    workspaceId: 'w1',
    projectId: 'p1',
    stateId: 's1',
    name: 'Reviewing',
    group: 'started',
    color: 'warning',
    previousName: 'In Review',
  },
  'workflow_state.reordered': {
    type: 'workflow_state.reordered',
    workspaceId: 'w1',
    projectId: 'p1',
    order: ['s1', 's2'],
  },
  'workflow_state.deleted': {
    type: 'workflow_state.deleted',
    workspaceId: 'w1',
    projectId: 'p1',
    stateId: 's1',
    name: 'In Review',
    migratedToStateId: 's2',
  },
  'custom_field.created': {
    type: 'custom_field.created',
    workspaceId: 'w1',
    projectId: 'p1',
    fieldId: 'f1',
    name: 'Client',
    kind: 'select',
  },
  'custom_field.updated': {
    type: 'custom_field.updated',
    workspaceId: 'w1',
    projectId: 'p1',
    fieldId: 'f1',
    name: 'Client name',
    previousName: 'Client',
    optionId: null,
  },
  'custom_field.reordered': {
    type: 'custom_field.reordered',
    workspaceId: 'w1',
    projectId: 'p1',
    order: ['f2', 'f1'],
  },
  'custom_field.deleted': {
    type: 'custom_field.deleted',
    workspaceId: 'w1',
    projectId: 'p1',
    fieldId: 'f1',
    name: 'Client',
    kind: 'select',
    valuesDeleted: 12,
  },
  'custom_field.option_removed': {
    type: 'custom_field.option_removed',
    workspaceId: 'w1',
    projectId: 'p1',
    fieldId: 'f1',
    optionId: 'o1',
    name: 'Acme',
    clearedFrom: 3,
  },
  'cycle.created': {
    type: 'cycle.created',
    workspaceId: 'w1',
    projectId: 'p1',
    cycleId: 'cy1',
    name: 'Sprint 14',
    startDate: '2026-09-07',
    endDate: '2026-09-20',
  },
  'cycle.updated': {
    type: 'cycle.updated',
    workspaceId: 'w1',
    projectId: 'p1',
    cycleId: 'cy1',
    name: 'Sprint 14',
    previousName: null,
    startDate: '2026-09-07',
    endDate: '2026-09-21',
    datesChanged: true,
  },
  'cycle.completed': {
    type: 'cycle.completed',
    workspaceId: 'w1',
    projectId: 'p1',
    cycleId: 'cy1',
    name: 'Sprint 14',
    disposition: 'next_cycle',
    carriedOver: 3,
  },
  'cycle.deleted': {
    type: 'cycle.deleted',
    workspaceId: 'w1',
    projectId: 'p1',
    cycleId: 'cy1',
    name: 'Sprint 14',
    released: 12,
  },
  'label.created': {
    type: 'label.created',
    workspaceId: 'w1',
    labelId: 'l1',
    name: 'client',
    color: 'lilac',
  },
  'label.updated': {
    type: 'label.updated',
    workspaceId: 'w1',
    labelId: 'l1',
    name: 'client work',
    color: 'lilac',
    previousName: 'client',
  },
  'label.deleted': {
    type: 'label.deleted',
    workspaceId: 'w1',
    labelId: 'l1',
    name: 'client',
    detachedFrom: 3,
  },
  'work_item.created': {
    type: 'work_item.created',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    number: 142,
    title: 'Ship the invoice export',
    stateId: 's1',
    parentId: null,
      assigneeIds: [],
  },
  'work_item.updated': {
    type: 'work_item.updated',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    fields: ['title', 'dueDate'],
      assigneeIds: [],
  },
  'work_item.state_changed': {
    type: 'work_item.state_changed',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    from: 's1',
    to: 's2',
    completed: false,
      assigneeIds: [],
  },
  'work_item.moved': {
    type: 'work_item.moved',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    stateId: 's1',
  },
  'work_item.assigned': {
    type: 'work_item.assigned',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    added: ['m2'],
    removed: [],
  },
  'work_item.labelled': {
    type: 'work_item.labelled',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    added: ['l1'],
    removed: [],
  },
  'work_item.cycle_changed': {
    type: 'work_item.cycle_changed',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    from: null,
    to: 'cy1',
    assigneeIds: ['m2'],
  },
  'work_item.blocked_changed': {
    type: 'work_item.blocked_changed',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    blocked: true,
    reason: 'waiting on the client',
      assigneeIds: [],
  },
  'work_item.custom_field_changed': {
    type: 'work_item.custom_field_changed',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    fieldIds: ['f1', 'f2'],
    assigneeIds: ['m2'],
  },
  'work_item.deleted': {
    type: 'work_item.deleted',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    number: 142,
    title: 'Ship the invoice export',
  },
  'comment.created': {
    type: 'comment.created',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    commentId: 'c1',
    mentioned: ['m2'],
      assigneeIds: [],
  },
  'comment.deleted': {
    type: 'comment.deleted',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    commentId: 'c1',
    byAuthor: false,
  },
  'attachment.added': {
    type: 'attachment.added',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    attachmentId: 'a1',
    commentId: null,
    filename: 'contract.pdf',
      assigneeIds: [],
  },
  'attachment.removed': {
    type: 'attachment.removed',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'wi1',
    attachmentId: 'a1',
    commentId: null,
    filename: 'contract.pdf',
    byUploader: false,
  },
  'wiki_space.created': {
    type: 'wiki_space.created',
    workspaceId: 'w1',
    spaceId: 's1',
    kind: 'company',
    projectId: null,
    name: 'Company',
  },
  'wiki_space.updated': {
    type: 'wiki_space.updated',
    workspaceId: 'w1',
    spaceId: 's1',
    from: 'Company',
    to: 'Handbook',
  },
  'wiki_page.created': {
    type: 'wiki_page.created',
    workspaceId: 'w1',
    spaceId: 's1',
    pageId: 'wp1',
    title: 'Leave policy',
    mentioned: ['m2'],
  },
  'wiki_page.updated': {
    type: 'wiki_page.updated',
    workspaceId: 'w1',
    spaceId: 's1',
    pageId: 'wp1',
    revisionNo: 4,
    mentioned: ['m3'],
  },
  'wiki_page.moved': {
    type: 'wiki_page.moved',
    workspaceId: 'w1',
    pageId: 'wp1',
    fromSpaceId: 's1',
    toSpaceId: 's2',
    fromParentId: null,
    toParentId: 'wp9',
  },
  'wiki_page.deleted': {
    type: 'wiki_page.deleted',
    workspaceId: 'w1',
    spaceId: 's1',
    pageId: 'wp1',
    title: 'Leave policy',
    reparented: 2,
  },
  'wiki_page.restored': {
    type: 'wiki_page.restored',
    workspaceId: 'w1',
    spaceId: 's1',
    pageId: 'wp1',
    title: 'Leave policy',
  },
  'wiki_page.linked': {
    type: 'wiki_page.linked',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'i1',
    pageId: 'wp1',
  },
  'wiki_page.unlinked': {
    type: 'wiki_page.unlinked',
    workspaceId: 'w1',
    projectId: 'p1',
    workItemId: 'i1',
    pageId: 'wp1',
  },
  'invitation.accepted': {
    type: 'invitation.accepted',
    workspaceId: 'w1',
    invitationId: 'i1',
    email: 'sophea@example.com',
    userId: 'u2',
    memberId: 'm2',
  },
};

const everyEvent = Object.values(sample) as DomainEvent[];

describe('the event registry', () => {
  it('has an entry for every event type', () => {
    for (const event of everyEvent) {
      expect(eventRegistry[event.type], event.type).toBeDefined();
    }
    expect(Object.keys(eventRegistry).sort()).toEqual(Object.keys(sample).sort());
  });

  it('produces a row for every event it marks auditable, and none for the rest', () => {
    for (const event of everyEvent) {
      const auditable = eventRegistry[event.type].audit !== false;
      expect(auditRowFor(event) !== null, event.type).toBe(auditable);
    }
  });

  it('names the subject on every audit row', () => {
    for (const event of everyEvent) {
      const row = auditRowFor(event);
      if (!row) continue;
      expect(row.action, event.type).toBe(event.type);
      expect(row.subjectType, event.type).toBeTruthy();
      expect(row.subjectId, event.type).toBeTruthy();
    }
  });

  // Audit is workspace-scoped, Owner/Admin-visible and never translated
  // (§18-11). A payload only makes sense in that log if it reads as data.
  it('carries a plain-object payload', () => {
    for (const event of everyEvent) {
      const row = auditRowFor(event);
      if (!row) continue;
      expect(typeof row.data, event.type).toBe('object');
      expect(Array.isArray(row.data), event.type).toBe(false);
    }
  });

  it('audits membership, access and workspace changes, not composition or board setup', () => {
    const audited = everyEvent.filter((e) => auditRowFor(e) !== null).map((e) => e.type);

    expect(audited.sort()).toEqual(
      [
        /*
         * Slice 18's six, and the shape of the set is §20.6's argument.
         *
         * Spaces are audited because a space is the unit of access (§20.5), so
         * which ones exist is a governance question. A page is audited when it
         * is *created, moved, deleted or restored* — the four facts an owner
         * needs six months later — and **not** when it is saved. `wiki_page
         * .updated` is the deliberate omission: "a log with a row per save is a
         * log nobody reads when it matters", which is `work_item.moved`'s call
         * from slice 6, and the revision list is the better history anyway.
         *
         * `wiki_page.linked` and `.unlinked` are absent for the same reason a
         * save is: linking is ordinary editorial work, and the link row is
         * already the record of it.
         */
        'wiki_space.created',
        'wiki_space.updated',
        'wiki_page.created',
        'wiki_page.moved',
        'wiki_page.deleted',
        'wiki_page.restored',
        'invitation.accepted',
        'project.archived',
        'project.created',
        'project.member_added',
        'project.member_removed',
        'project.member_role_changed',
        'project.renamed',
        'project.unarchived',
        'project.visibility_changed',
        'workflow_state.deleted',
        // Slice 11's, and the sixth of the same kind: deleting a cycle destroys
        // a container somebody planned, and `released` records how much work
        // went back to the backlog with it.
        'cycle.deleted',
        // Slice 5's two, and both for the same reason the state deletion above
        // is here: they are the only actions in their families that destroy
        // something rather than change it.
        'label.deleted',
        'work_item.deleted',
        // Slice 8's two, and the third and fourth of the same kind: each
        // destroys something a person contributed, and §10 lets somebody other
        // than its author do it.
        'attachment.removed',
        'comment.deleted',
        // Slice 10's two, on the same principle: defining and renaming a field
        // are configuration, but deleting one takes every value stored in it,
        // and removing an option takes the values that named it.
        'custom_field.deleted',
        'custom_field.option_removed',
        'invitation.resent',
        'invitation.revoked',
        'invitation.sent',
        'team.created',
        'team.deleted',
        'team.renamed',
        'workspace.created',
        'workspace.renamed',
        /*
         * Slice 15's eight, and they divide into three kinds.
         *
         * **The settings that silently redefine what the product says.** A
         * timezone, a working week, a week start, a company language or a day
         * on the holiday calendar changes what "overdue", "stale" and "due
         * tomorrow" mean, for everybody, retroactively — and the fortnight
         * after somebody sets the working week to Monday–Friday is exactly when
         * somebody asks why the digest stopped arriving on Saturdays.
         */
        'workspace.settings_changed',
        'workspace.holidays_changed',
        /*
         * **The change that breaks every link anybody has pasted anywhere.**
         * Separate from `renamed` because an owner reading the log after "why
         * did all our bookmarks stop working" needs to find it, and finding it
         * inside a rename entry is finding it by luck.
         */
        'workspace.slug_changed',
        'workspace.branding_changed',
        'workspace.notification_defaults_changed',
        /*
         * **§7.13, and the whole reason `audit_record` has two actor columns.**
         * "Starting a session is logged against the viewer: this is a
         * permission an owner holds openly, not a back door." Both halves are
         * audited, because a session never recorded as ending reads in the log
         * as one that never ended.
         */
        'workspace.view_as_started',
        'workspace.view_as_ended',
        // §7.12's reassignment: somebody's open work changing hands in bulk,
        // which is the moment an offboarding is most worth being able to
        // reconstruct.
        'workspace_member.work_reassigned',
        'workspace_member.added',
        'workspace_member.availability_changed',
        'workspace_member.removed',
        'workspace_member.role_changed',
      ].sort(),
    );
  });

  // §18-11: the audit log exists so an owner can reconstruct how someone got
  // access. An invitation accepted by an account whose address differs from the
  // one invited is exactly the case that question is asked about, so the row
  // has to carry both.
  // §17-25 and §18-11 together: the log is Owner-visible and permanent, so it
  // records *that* somebody was marked away and until when, and never why. The
  // reason is not on the event at all, which is what makes this hard to undo by
  // accident — but the row is what an owner reads, so the row is what is pinned.
  it('audits an availability change without its reason', () => {
    const row = auditRowFor(sample['workspace_member.availability_changed']);
    expect(row?.data).toEqual({ from: null, to: '2026-09-20' });
    expect(JSON.stringify(row?.data)).not.toContain('reason');
  });

  it('records who accepted an invitation, not only who was invited', () => {
    const row = auditRowFor(sample['invitation.accepted']);
    expect(row?.data).toMatchObject({ email: 'sophea@example.com', userId: 'u2' });
  });
});

/**
 * The activity projectors (slice 7).
 *
 * As with `audit`, the mapped type is the real guarantee — a new event without
 * an `activity` decision does not compile. These cover the half a type cannot:
 * that the decisions made are the ones §8 and §9 describe, and that a projected
 * row can actually be written.
 */
describe('the activity projectors', () => {
  it('projects work-item events, and nothing else', () => {
    const projected = everyEvent
      .filter((e) => activityRowsFor(e).length > 0 || eventRegistry[e.type].activity !== false)
      .map((e) => e.type);

    /*
     * Activity hangs under WorkItem in §9's hierarchy, so a feed exists per item
     * and nowhere else. Everything about a workspace, a team, a project or an
     * invitation is either audit or nothing.
     *
     * **Slice 15 adds the one exception, and it proves the rule rather than
     * breaking it.** `workspace_member.work_reassigned` is named for a person
     * and carries a list of items, and it projects a line into each of them —
     * because what lands in the feed is still a change to *that item*: it
     * changed hands. It is the first entry whose projector returns many rows
     * from one event at real scale, which is what `ActivitySpec` returning a
     * list has been for since slice 7, and it is here because an item that
     * silently changed owner is the one thing offboarding must not produce.
     */
    expect(projected.sort()).toEqual(
      [
        'work_item.created',
        'work_item.updated',
        'work_item.state_changed',
        'work_item.assigned',
        'work_item.labelled',
        'work_item.blocked_changed',
        /*
         * Slice 18's two, and they are the exception that proves the same rule
         * the offboarding entry does.
         *
         * §20.6: "No wiki event projects into an item's activity feed except the
         * two about a link, and that exception is the rule working rather than
         * bending. Activity is per work item (§9 hangs it under `WorkItem`), and
         * a page is not a work item — its history is its revision list, which is
         * a better surface for a document than a feed of lines.
         * `wiki_page.linked` is the one whose subject genuinely *is* the item:
         * somebody attached the architecture page to this task belongs in that
         * task's history, and it is the line that makes the wiki get read."
         */
        'wiki_page.linked',
        'wiki_page.unlinked',
        // Slice 11's. A cycle's own events say nothing here — a container is
        // not an item — but an item joining or leaving one is a change to that
        // item, and its feed is where somebody asks why their work moved.
        'work_item.cycle_changed',
        // Slice 10's, on the same rule as `work_item.updated`: one line per
        // field, because the feed is what itemises a save.
        'work_item.custom_field_changed',
        // Slice 8's two. They have a projector rather than `false`, and it is
        // the projector — not the registry entry — that decides to stay quiet
        // about a file posted inside a comment. The test below pins that.
        // Slice 15's, and the only member of this list that is not a
        // `work_item.*` event — see the note above.
        'workspace_member.work_reassigned',
        'attachment.added',
        'attachment.removed',
      ].sort(),
    );
  });

  // The two work-item events that deliberately project to nothing, each for a
  // reason written at its registry entry: a reorder is noise in a history, and
  // a deleted item takes its history with it.
  it('says nothing about a reorder or a deletion', () => {
    expect(activityRowsFor(sample['work_item.moved'])).toEqual([]);
    expect(activityRowsFor(sample['work_item.deleted'])).toEqual([]);
  });

  // Slice 8, and the one `false` here that is about the screen rather than the
  // log: the thread renders directly above the feed, so a line saying somebody
  // commented sits an inch below the comment itself.
  it('says nothing about a comment, which the thread above it already shows', () => {
    expect(activityRowsFor(sample['comment.created'])).toEqual([]);
    expect(activityRowsFor(sample['comment.deleted'])).toEqual([]);
  });

  // The audit row records that a comment was destroyed and whether its author
  // did it. It deliberately does not copy the body: the log is Owner-visible
  // and permanent, and a retracted comment should not survive in it.
  it('audits a deleted comment without keeping its text', () => {
    const row = auditRowFor(sample['comment.deleted']);

    expect(row?.subjectType).toBe('comment');
    expect(row?.data).toMatchObject({ workItemId: 'wi1', byAuthor: false });
    expect(JSON.stringify(row?.data)).not.toContain('body');
  });

  /**
   * The condition that keeps the feed honest about files. A file dropped on the
   * item is announced by nothing else; a file pasted into a comment is already
   * rendered inside that comment, an inch above the feed.
   */
  it('projects a file on the item but stays quiet about one inside a comment', () => {
    expect(activityRowsFor(sample['attachment.added'])).toEqual([
      {
        workItemId: 'wi1',
        projectId: 'p1',
        action: 'attachment.added',
        data: { attachmentId: 'a1', filename: 'contract.pdf' },
      },
    ]);

    expect(
      activityRowsFor({ ...sample['attachment.added'], commentId: 'c1' }),
    ).toEqual([]);
    expect(
      activityRowsFor({ ...sample['attachment.removed'], commentId: 'c1' }),
    ).toEqual([]);
  });

  /**
   * The filename is kept where `comment.deleted` withholds the body, and the
   * difference is the point: a filename identifies the thing that was removed,
   * a body *is* the thing. A log that cannot say which file went records
   * nothing worth keeping.
   */
  it('audits a removed file by name, and says whether its uploader did it', () => {
    const row = auditRowFor(sample['attachment.removed']);

    expect(row?.subjectType).toBe('attachment');
    expect(row?.subjectId).toBe('a1');
    expect(row?.data).toMatchObject({ filename: 'contract.pdf', byUploader: false });
  });

  it('anchors every row to an item, a project and its own event type', () => {
    for (const event of everyEvent) {
      for (const row of activityRowsFor(event)) {
        expect(row.workItemId, event.type).toBeTruthy();
        expect(row.projectId, event.type).toBeTruthy();
        expect(row.action, event.type).toBe(event.type);
        expect(typeof row.data, event.type).toBe('object');
      }
    }
  });

  // §8: "one line per name". An edit that moved two fields is two things a
  // reader wants to see, not one line saying the item was edited.
  it('fans an edit out into one row per field', () => {
    const rows = activityRowsFor(sample['work_item.updated']);

    expect(rows.map((r) => r.data.field)).toEqual(['title', 'dueDate']);
  });

  // Assignment is a set operation carrying a diff, and each side of the diff
  // happened to a different person — §4 notifies them separately for the same
  // reason.
  it('fans assignment out per person, saying which way', () => {
    const rows = activityRowsFor({
      type: 'work_item.assigned',
      workspaceId: 'w1',
      projectId: 'p1',
      workItemId: 'wi1',
      added: ['m2', 'm3'],
      removed: ['m4'],
    });

    expect(rows.map((r) => r.data)).toEqual([
      { memberId: 'm2', assigned: true },
      { memberId: 'm3', assigned: true },
      { memberId: 'm4', assigned: false },
    ]);
  });

  // §13: what is stored is an id and the renderer owns the sentence. A name
  // written here would freeze at this moment and read as English forever in a
  // Khmer workspace — and would not follow a rename.
  it('stores state ids, not state names', () => {
    const [row] = activityRowsFor(sample['work_item.state_changed']);

    expect(row?.data).toEqual({ from: 's1', to: 's2', completed: false });
  });

  // The one exception, and it is not a reference: a blocked reason is free text
  // a person typed about this moment, so the feed keeps the words they used
  // rather than whatever the item says today.
  it('keeps the words of a blocked reason', () => {
    const [row] = activityRowsFor(sample['work_item.blocked_changed']);

    expect(row?.data).toEqual({ blocked: true, reason: 'waiting on the client' });
  });
});

/**
 * The third sink (slice 9). Same shape of guarantee as the other two: the
 * mapped type makes an undecided event a compile error, so what is left to test
 * is that the decisions taken are §7.8's, and that the projector stays pure —
 * it names members, and never tries to work out who not to tell.
 */
describe('the notify projectors', () => {
  const types = Object.keys(eventRegistry) as EventType[];

  it('has a decision for every event type', () => {
    for (const type of types) {
      expect(eventRegistry[type], type).toHaveProperty('notify');
    }
  });

  it('notifies only about work items, comments and files on them', () => {
    const notifying = types.filter((type) => eventRegistry[type].notify !== false);

    expect(notifying.sort()).toEqual(
      [
        'attachment.added',
        'comment.created',
        /*
         * Slice 18's two, and both ride the **existing** `mention` kind (§20.6).
         *
         * "§6-6's five kinds are a closed set people reason about, and somebody
         * who switched mentions off meant mentions, wherever their name was
         * written. A `wiki_mention` row in the preference grid would be a toggle
         * nobody wants and a second place to forget."
         *
         * They are also the first notifications in the product whose subject is
         * not a work item, which is what `NotifySubject` exists for.
         */
        'wiki_page.created',
        'wiki_page.updated',
        'work_item.assigned',
        'work_item.blocked_changed',
        'work_item.created',
        'work_item.custom_field_changed',
        'work_item.state_changed',
        'work_item.updated',
      ].sort(),
    );
  });

  it('says nothing about a label, a reorder or a deletion', () => {
    expect(notifyDraftsFor(sample['work_item.labelled'])).toEqual([]);
    // Slice 11's, and the one that would flood an inbox if it were not here:
    // planning a sprint moves thirty items in one sitting (§7.6), and the
    // general §7.8 rule would turn that into thirty emails.
    expect(notifyDraftsFor(sample['work_item.cycle_changed'])).toEqual([]);
    expect(notifyDraftsFor(sample['work_item.moved'])).toEqual([]);
    expect(notifyDraftsFor(sample['work_item.deleted'])).toEqual([]);
    expect(notifyDraftsFor(sample['attachment.removed'])).toEqual([]);
  });

  it('tells the item assignees when it changes, as item activity', () => {
    const drafts = notifyDraftsFor({
      ...sample['work_item.state_changed'],
      assigneeIds: ['m1', 'm2'],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe('item_activity');
    expect(drafts[0]?.recipientMemberIds).toEqual(['m1', 'm2']);
    expect(drafts[0]?.commentId).toBeNull();
  });

  it('turns one edit into one notification, however many fields moved', () => {
    const drafts = notifyDraftsFor({
      ...sample['work_item.updated'],
      fields: ['title', 'dueDate', 'priority'],
      assigneeIds: ['m1'],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.data).toEqual({ fields: ['title', 'dueDate', 'priority'] });
  });

  it('tells only the people whose assignment changed, not everyone on the item', () => {
    const drafts = notifyDraftsFor({
      ...sample['work_item.assigned'],
      added: ['m2'],
      removed: ['m3'],
    });

    // §4: "Unassignment notifies the person removed." And nobody else on the
    // item hears that a colleague was added.
    expect(drafts[0]?.kind).toBe('assignment');
    expect(drafts[0]?.recipientMemberIds).toEqual(['m2', 'm3']);
  });

  it('notifies the people assigned at creation, which is the only event a create emits', () => {
    const drafts = notifyDraftsFor({
      ...sample['work_item.created'],
      assigneeIds: ['m2'],
    });

    expect(drafts[0]?.kind).toBe('assignment');
    expect(drafts[0]?.recipientMemberIds).toEqual(['m2']);
  });

  it('splits a comment into a mention and a comment, and never both for one person', () => {
    const drafts = notifyDraftsFor({
      ...sample['comment.created'],
      commentId: 'c1',
      mentioned: ['m2'],
      // m2 is mentioned *and* assigned; m3 is only assigned.
      assigneeIds: ['m2', 'm3'],
    });

    expect(drafts.map((draft) => draft.kind)).toEqual(['mention', 'comment']);
    expect(drafts[0]?.recipientMemberIds).toEqual(['m2']);
    expect(drafts[1]?.recipientMemberIds).toEqual(['m3']);
  });

  it('carries the comment id, so the click lands on the comment (§7.8)', () => {
    const drafts = notifyDraftsFor({
      ...sample['comment.created'],
      commentId: 'c1',
      mentioned: ['m2'],
      assigneeIds: [],
    });

    expect(drafts[0]?.commentId).toBe('c1');
  });

  it('drops a draft addressed to nobody rather than emitting an empty one', () => {
    const drafts = notifyDraftsFor({
      ...sample['comment.created'],
      mentioned: [],
      assigneeIds: [],
    });

    expect(drafts).toEqual([]);
  });

  it('stays quiet about a file pasted into a comment, which the comment announces', () => {
    const inComment = notifyDraftsFor({
      ...sample['attachment.added'],
      commentId: 'c1',
      assigneeIds: ['m2'],
    });
    const onItem = notifyDraftsFor({
      ...sample['attachment.added'],
      commentId: null,
      assigneeIds: ['m2'],
    });

    expect(inComment).toEqual([]);
    expect(onItem).toHaveLength(1);
  });

  it('does not remove the actor — that is the unit of work, which knows who they are', () => {
    // The projector is pure and has no actor to compare against. §7.8's "an
    // actor never hears about their own action" is applied once, in
    // `UnitOfWork.flush`, and this test pins the division of labour.
    const drafts = notifyDraftsFor({
      ...sample['work_item.state_changed'],
      assigneeIds: ['m1', 'm2', 'm3'],
    });

    expect(drafts[0]?.recipientMemberIds).toHaveLength(3);
  });
});
