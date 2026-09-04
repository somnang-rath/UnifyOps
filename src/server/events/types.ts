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
 * Slice 10 adds custom fields; slice 11 adds cycles and the item-level
 * membership that puts work into one.
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
  /**
   * The address of the company changed (§6-1, slice 15).
   *
   * Separate from `renamed` because it is a different kind of event to the
   * people it affects: a rename changes a word in a header, and a slug change
   * breaks every link anybody has ever pasted into a chat. An owner reading the
   * log six months later after "why did all our bookmarks stop working" needs
   * to find this, and finding it inside a rename entry is finding it by luck.
   */
  | { type: 'workspace.slug_changed'; workspaceId: string; from: string; to: string }
  /**
   * Timezone, working days, week start or default language (§6-1, slice 15).
   *
   * One event for the four rather than four, because they are one form and one
   * save, and a log that reads as four entries for one click is a log that has
   * to be read four times. `changed` names which of them actually moved, so the
   * entry is still specific — the alternative, a payload of everything, makes
   * every save look like a change to everything.
   *
   * It is audited and it matters that it is: every one of these four silently
   * changes what "overdue", "stale" and "due tomorrow" mean for the whole
   * company, and the fortnight after somebody sets the working week to
   * Monday–Friday is exactly when somebody asks why the digest stopped arriving
   * on Saturdays.
   */
  | {
      type: 'workspace.settings_changed';
      workspaceId: string;
      changed: readonly ('timezone' | 'workingDays' | 'weekStart' | 'defaultLocale')[];
      timezone: string;
      workingDays: number;
      weekStart: number;
      defaultLocale: string;
    }
  /** §6-7: the logo or the accent colour. Audited as a workspace-level change. */
  | {
      type: 'workspace.branding_changed';
      workspaceId: string;
      changed: readonly ('logo' | 'accent')[];
      accent: string | null;
      hasLogo: boolean;
    }
  /**
   * The holiday calendar gained or lost a day (§6-1, §17-18, §18-10).
   *
   * Audited, and the seed emits **one** event with a count rather than ten —
   * the same call `workspace.settings_changed` makes, and the one
   * `work_item.cycle_changed` makes about notifications. A log where seeding a
   * year pushes everything else off the first page is a log nobody scrolls.
   */
  | {
      type: 'workspace.holidays_changed';
      workspaceId: string;
      added: number;
      removed: number;
      /** The years touched, so an owner can see *which* calendar moved. */
      years: readonly number[];
    }
  /**
   * §7.13's view-as, started and ended.
   *
   * **The only reason this event exists is the log.** §7.13: "Starting a session
   * is logged against the viewer: this is a permission an owner holds openly,
   * not a back door", and §18-11 built `audit_record.on_behalf_of_user_id`
   * specifically so a view-as session is visible in the log that exists to
   * record it. Both halves are emitted, because a session that is never
   * recorded as ending reads in the log as one that never ended.
   *
   * Both are emitted from the **viewer's own** context, not from inside the
   * session: `uow.emit` refuses while `readOnly` is set, which is correct — a
   * view-as session must produce no events of its own — so the exit action
   * resolves the real actor and emits as them.
   */
  | { type: 'workspace.view_as_started'; workspaceId: string; targetMemberId: string; targetUserId: string }
  | { type: 'workspace.view_as_ended'; workspaceId: string; targetMemberId: string; targetUserId: string }
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
  /**
   * §7.12's required choice, carried out: what happened to the open work of
   * somebody being offboarded (slice 15).
   *
   * "Removing a member requires choosing what happens to their open work" (§4),
   * and until slice 15 there was nothing to choose about — `removeMember`'s
   * comment says so, because work items did not exist when it was written.
   *
   * **One event for the whole reassignment, carrying every item it touched.**
   * The projector returns one feed line per item — which is what
   * `ActivitySpec` returning a *list* has been for since slice 7 — so an item
   * whose owner left says so in its own history. Notification is refused for
   * the reason `work_item.cycle_changed` refuses it: one person, one sitting,
   * forty items is forty emails, and §7.8 is blunt about what that teaches a
   * team to do with the product's mail. The person picking up the work is told
   * once, by the human who reassigned it.
   *
   * `toMemberId` is null for §7.12's other branch — "leave unassigned and flag
   * in Needs Attention" — which needs no flag, because §7.4's unassigned row is
   * already that surface.
   */
  | {
      type: 'workspace_member.work_reassigned';
      workspaceId: string;
      fromMemberId: string;
      toMemberId: string | null;
      items: readonly { workItemId: string; projectId: string }[];
    }
  /**
   * §6-6's workspace defaults changed (slice 15).
   *
   * Audited where `setNotificationPreference` is not, and the difference is who
   * it is about: a person's own preferences are theirs, and a company default
   * changes what every member who has never opened the screen receives. That is
   * an administrative act with an effect somebody may later have to explain.
   */
  | {
      type: 'workspace.notification_defaults_changed';
      workspaceId: string;
      kind: string;
      channels: readonly string[];
    }
  /**
   * §4's availability flag changed (§17-25, slice 13).
   *
   * Carries the dates and not the reason. The reason is free text somebody
   * typed about their own absence — "surgery", "father's funeral" — and the
   * audit log is Owner-visible and permanent (§18-11). Recording *that*
   * somebody marked themselves away, and until when, is what a log is for;
   * recording why is a medical record nobody asked us to keep. This is the same
   * line `comment.deleted` draws when it audits the deletion and withholds the
   * body.
   *
   * `from` and `to` are `YYYY-MM-DD` or null, and both are present because
   * clearing a flag and setting one are the same act from two directions —
   * a log entry saying only "availability changed" answers nothing.
   */
  | {
      type: 'workspace_member.availability_changed';
      workspaceId: string;
      memberId: string;
      from: string | null;
      to: string | null;
    }
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
      /**
       * A project defined a custom field (§6-4, §7.11).
       *
       * `kind` rides along and is never revisited: a field's kind is fixed at
       * creation, so the log records what was created rather than what it has
       * since become.
       */
      type: 'custom_field.created';
      workspaceId: string;
      projectId: string;
      fieldId: string;
      name: string;
      kind: string;
    }
  | {
      /**
       * A rename, or a change to one of the field's options.
       *
       * One event for both because they are one act to the person doing it —
       * editing the field's definition — and because §7.11 attaches the same
       * promise to each: "renaming → values preserved, no migration". Adding or
       * renaming an option is not destructive; removing one is, and has its own
       * event below.
       */
      type: 'custom_field.updated';
      workspaceId: string;
      projectId: string;
      fieldId: string;
      name: string;
      /** Set only when this update was a rename, so the log can show both. */
      previousName: string | null;
      /** The option that changed, or null when the field itself was renamed. */
      optionId: string | null;
    }
  | {
      type: 'custom_field.reordered';
      workspaceId: string;
      projectId: string;
      /** Field ids, in the order they now appear on the item panel. */
      order: readonly string[];
    }
  | {
      /**
       * A field, and every value anyone had stored in it, was deleted (§7.11).
       *
       * Audited, like the other three actions that destroy rather than change.
       * `valuesDeleted` is the number the confirmation showed, recorded so the
       * log says how much was lost rather than only that something was.
       */
      type: 'custom_field.deleted';
      workspaceId: string;
      projectId: string;
      fieldId: string;
      name: string;
      kind: string;
      valuesDeleted: number;
    }
  | {
      /**
       * One choice was removed from a select field, and cleared off every item
       * that had it.
       *
       * Separate from `custom_field.updated` because it is the destructive half
       * of editing a vocabulary: renaming "Acme" to "Acme Ltd" keeps every
       * value, deleting it takes them.
       */
      type: 'custom_field.option_removed';
      workspaceId: string;
      projectId: string;
      fieldId: string;
      optionId: string;
      name: string;
      /** How many items lost the value. The reason this one is audited. */
      clearedFrom: number;
    }
  | {
      /**
       * A cycle was planned (§7.6).
       *
       * The dates ride along because they are the cycle: a log line reading
       * "created Sprint 14" without them says nothing anybody would open a log
       * to find out, and unlike a name they are what the burndown was drawn
       * against.
       */
      type: 'cycle.created';
      workspaceId: string;
      projectId: string;
      cycleId: string;
      name: string;
      startDate: string;
      endDate: string;
    }
  | {
      /**
       * A rename, a goal, or a change to the range.
       *
       * One event for all three because they are one act to the person doing it
       * — editing the cycle — and because §7.6 attaches no different promise to
       * any of them. `datesChanged` is carried separately from the name for the
       * reason `previousName` exists on the other update events: moving a
       * cycle's end date redraws every burndown anybody has looked at, and a
       * log that cannot distinguish that from a typo fix is not worth reading.
       */
      type: 'cycle.updated';
      workspaceId: string;
      projectId: string;
      cycleId: string;
      name: string;
      /** Set only when this update was a rename, so the log can show both. */
      previousName: string | null;
      startDate: string;
      endDate: string;
      datesChanged: boolean;
    }
  | {
      /**
       * §7.6's end-of-cycle prompt was answered.
       *
       * `disposition` is which of the three answers — "move to the next cycle",
       * "return to the backlog", "leave them" — and `carriedOver` is how many
       * items it moved. Both are recorded because "the cycle closed" and "the
       * cycle closed with eleven items pushed into the next one" are different
       * events to a manager reading this in a retrospective, and the second is
       * the one that explains the next cycle's burndown starting high.
       */
      type: 'cycle.completed';
      workspaceId: string;
      projectId: string;
      cycleId: string;
      name: string;
      disposition: string;
      carriedOver: number;
    }
  | {
      /**
       * A cycle was destroyed, and everything in it returned to the backlog.
       *
       * Audited, joining `work_item.deleted`, `comment.deleted`,
       * `workflow_state.deleted`, `attachment.removed` and
       * `custom_field.deleted` as the actions that destroy rather than change.
       * It keeps the name, for the reason `attachment.removed` keeps its
       * filename: a log that cannot say *which* cycle went records nothing
       * worth keeping.
       */
      type: 'cycle.deleted';
      workspaceId: string;
      projectId: string;
      cycleId: string;
      name: string;
      /** How many items went back to the backlog. The reason this one is audited. */
      released: number;
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
      /**
       * One item was planned into a cycle, moved between cycles, or returned to
       * the backlog (§7.6).
       *
       * **Per item, never per cycle**, and that is §7.6's rule rather than a
       * shape chosen here: "cycle membership is per item, never inherited". A
       * planning session that moves thirty items emits thirty events, which is
       * what puts a line in each of those thirty items' feeds — the place
       * somebody looks to ask why their work moved.
       *
       * Both ids, and both may be null: null `to` is the backlog, null `from`
       * is work that was not planned into anything before.
       */
      type: 'work_item.cycle_changed';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      from: string | null;
      to: string | null;
      assigneeIds: readonly string[];
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
      /**
       * Somebody set or cleared one or more of an item's custom fields (§6-4).
       *
       * `fieldIds` rather than one event per field, for the reason
       * `work_item.updated` carries `fields`: the panel saves every field at
       * once because they are one thought, and the feed itemises what the inbox
       * summarises. Ids, never names — a field renamed next March must still
       * read correctly in the line that recorded this change (§13).
       */
      type: 'work_item.custom_field_changed';
      workspaceId: string;
      projectId: string;
      workItemId: string;
      fieldIds: readonly string[];
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
