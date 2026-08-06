'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type { NotifType } from '@/schemas/notification';

export interface NotifPref {
  inApp: boolean;
  email: boolean;
}
export type NotifPrefs = Record<string, NotifPref>;

export const NOTIF_PREF_TYPES: {
  key: NotifType;
  label: string;
  hint: string;
}[] = [
  {
    key: 'issue_assigned',
    label: 'Issue assigned',
    hint: 'When an issue is assigned to you',
  },
  {
    key: 'issue_status',
    label: 'Status changes',
    hint: 'When the status of an issue you own or are assigned to changes',
  },
  {
    key: 'issue_commented',
    label: 'Comments',
    hint: 'When someone comments on an issue you own or are assigned to',
  },
  {
    key: 'mention',
    label: 'Mentions',
    hint: 'When someone @-mentions you in a comment',
  },
  {
    key: 'mr_review',
    label: 'Review requested',
    hint: 'When someone requests your review on a merge request',
  },
  {
    key: 'mr_decided',
    label: 'Review decided',
    hint: 'When a reviewer approves or rejects your merge request',
  },
  {
    key: 'mr_commented',
    label: 'MR comments',
    hint: 'When someone comments on a merge request you own or review',
  },
  {
    key: 'wiki_mention',
    label: 'Wiki mentions',
    hint: 'When someone @-mentions you in a wiki page',
  },
  {
    key: 'note_shared',
    label: 'Note folder shared',
    hint: 'When a note folder is shared with you',
  },
  {
    key: 'project_member',
    label: 'Added to project',
    hint: 'When you are added to a project',
  },
  {
    key: 'due_soon',
    label: 'Due soon',
    hint: 'Daily reminder for issues due tomorrow',
  },
  {
    key: 'digest',
    label: 'Weekly digest',
    hint: 'A Friday summary of your open work and cycle progress',
  },
];

const svc = {
  list: () =>
    api.get<NotifPrefs>('/users/me/notif-prefs').then((r) => r.data),
  update: (patch: Partial<Record<NotifType, Partial<NotifPref>>>) =>
    api
      .patch<NotifPrefs>('/users/me/notif-prefs', patch)
      .then((r) => r.data),
};

export const useNotifPrefs = () => {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['notif-prefs'],
    queryFn: svc.list,
    enabled: !!user,
    staleTime: 60_000,
  });
};

export function useUpdateNotifPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: svc.update,
    onSuccess: (data) => {
      qc.setQueryData(['notif-prefs'], data);
    },
  });
}
