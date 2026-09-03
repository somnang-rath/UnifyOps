/**
 * What a person can be notified *about* (§6-6, §7.8).
 *
 * §6-6 puts "per-user preferences (in-app / email, per event type)" in v1 and
 * leaves a "rules engine" to Phase 2. The two are only distinguishable if
 * "event type" means something a person recognises, so this is a small closed
 * set of **kinds** rather than the ~thirty members of `DomainEvent`. Nobody
 * wants a preference screen with a row for `work_item.blocked_changed`; they
 * want to turn off "changes to items I'm on" and keep mentions.
 *
 * The mapping from event to kind lives in the event registry, beside the audit
 * and activity decisions, so a new event type cannot reach somebody's inbox
 * without a deliberate answer to "what kind of thing is this?".
 *
 * In `src/lib` because both sides read it: the preferences screen renders a row
 * per kind, and the server validates the form against the same list.
 *
 * Closed enum, mapped to messages in code — no translation key reaches the
 * database (§13).
 */
export const NOTIFICATION_KINDS = [
  /** Somebody wrote your name in a comment. §7.7's whole point. */
  'mention',
  /** You were assigned an item, or taken off one — §4 notifies both. */
  'assignment',
  /** Something changed on an item you are assigned to. */
  'item_activity',
  /** Somebody commented on an item you are assigned to, without naming you. */
  'comment',
  /** The evening due-date digest (§7.8). Email only — see `CHANNELS`. */
  'digest',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The two v1 channels. Phase 2 adds Telegram here (§5, §19.5), which is the
 * reason this is a list rather than two booleans.
 */
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Which channels each kind can use at all.
 *
 * The digest is email-only by construction, not by default: an in-app digest
 * would be a list of items sitting one click away from the list of items it
 * summarises. §7.8 asks for one message per person per evening, and the inbox
 * is not where that message means anything.
 */
export const CHANNELS: Record<NotificationKind, readonly NotificationChannel[]> = {
  mention: NOTIFICATION_CHANNELS,
  assignment: NOTIFICATION_CHANNELS,
  item_activity: NOTIFICATION_CHANNELS,
  comment: NOTIFICATION_CHANNELS,
  digest: ['email'],
};

/**
 * What a person gets before they have touched the preference screen.
 *
 * Mentions and assignment reach the inbox *and* the mailbox because both are
 * somebody asking for you specifically. Item activity and comments on your
 * items are in-app only: they are frequent, and §7.8's stated failure mode is
 * a product whose mail a team learns to filter. The digest is on, because
 * §17-19's finding was that the product never warned before a due date.
 */
export const DEFAULT_PREFERENCES: Record<NotificationKind, readonly NotificationChannel[]> = {
  mention: ['in_app', 'email'],
  assignment: ['in_app', 'email'],
  item_activity: ['in_app'],
  comment: ['in_app'],
  digest: ['email'],
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return (
    typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value)
  );
}

/** Whether a kind reaches a channel, given the preferences a person has saved. */
export function wants(
  preferences: Partial<Record<NotificationKind, readonly NotificationChannel[]>>,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean {
  if (!CHANNELS[kind].includes(channel)) return false;
  const saved = preferences[kind] ?? DEFAULT_PREFERENCES[kind];
  return saved.includes(channel);
}
