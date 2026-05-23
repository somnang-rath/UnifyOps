import type { NotifType } from './schemas/notification.schema';

export const NOTIF_PREF_TYPES: NotifType[] = [
  'issue_assigned',
  'issue_status',
  'issue_commented',
  'mention',
  'mr_review',
  'mr_decided',
  'mr_commented',
  'wiki_mention',
  'note_shared',
  'project_member',
  'due_soon',
];

export interface NotifPref {
  inApp: boolean;
  email: boolean;
}
export type NotifPrefs = Record<string, NotifPref>;

export function defaultNotifPrefs(): NotifPrefs {
  return Object.fromEntries(
    NOTIF_PREF_TYPES.map((t) => [t, { inApp: true, email: false }]),
  );
}

export function mergeNotifPrefs(
  stored?: Record<string, Partial<NotifPref>>,
): NotifPrefs {
  const out = defaultNotifPrefs();
  if (!stored) return out;
  for (const [k, v] of Object.entries(stored)) {
    out[k] = {
      inApp: v?.inApp ?? out[k]?.inApp ?? true,
      email: v?.email ?? out[k]?.email ?? false,
    };
  }
  return out;
}
