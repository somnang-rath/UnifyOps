'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlarmClock,
  AlertCircle,
  Activity,
  AtSign,
  Bell,
  BookOpen,
  Bot,
  CheckCheck,
  CheckCircle2,
  FolderInput,
  GitMerge,
  GitPullRequest,
  Inbox,
  MessageSquare,
  Trash2,
  Users,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import {
  useNotifications,
  useNotifMutations,
} from '@/hooks/use-notifications';
import { relTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Notification, NotifType } from '@/schemas/notification';

type Tab = 'all' | 'unread' | 'mentions';

type TypeMeta = { Icon: LucideIcon; tone: string; ring: string };

const AMBER: Omit<TypeMeta, 'Icon'> = {
  tone: 'text-amber-600 dark:text-amber-400',
  ring: 'bg-amber-500/10',
};
const VIOLET: Omit<TypeMeta, 'Icon'> = {
  tone: 'text-violet-600 dark:text-violet-400',
  ring: 'bg-violet-500/10',
};
const SKY: Omit<TypeMeta, 'Icon'> = {
  tone: 'text-sky-600 dark:text-sky-400',
  ring: 'bg-sky-500/10',
};
const EMERALD: Omit<TypeMeta, 'Icon'> = {
  tone: 'text-emerald-600 dark:text-emerald-400',
  ring: 'bg-emerald-500/10',
};
const ROSE: Omit<TypeMeta, 'Icon'> = {
  tone: 'text-rose-600 dark:text-rose-400',
  ring: 'bg-rose-500/10',
};

const TYPE_META: Record<NotifType, TypeMeta> = {
  issue: { Icon: AlertCircle, ...AMBER },
  mr: { Icon: GitMerge, ...VIOLET },
  mention: { Icon: AtSign, ...SKY },
  done: { Icon: CheckCircle2, ...EMERALD },
  issue_assigned: { Icon: UserPlus, ...AMBER },
  issue_status: { Icon: Activity, ...AMBER },
  issue_commented: { Icon: MessageSquare, ...SKY },
  mr_review: { Icon: GitPullRequest, ...VIOLET },
  mr_decided: { Icon: GitMerge, ...VIOLET },
  mr_commented: { Icon: MessageSquare, ...VIOLET },
  wiki_mention: { Icon: BookOpen, ...SKY },
  note_shared: { Icon: FolderInput, ...EMERALD },
  project_member: { Icon: Users, ...EMERALD },
  due_soon: { Icon: AlarmClock, ...ROSE },
  digest: { Icon: Bot, ...VIOLET },
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mentions', label: 'Mentions' },
];

export function NotificationsBell() {
  const open = useUIStore((s) => s.notifsOpen);
  const setOpen = useUIStore((s) => s.setNotifs);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useNotifications();
  const { read, readAll, remove, clearRead } = useNotifMutations();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  const filtered = useMemo(() => {
    if (tab === 'unread') return items.filter((n) => !n.read);
    if (tab === 'mentions') return items.filter((n) => n.type === 'mention');
    return items;
  }, [items, tab]);

  const onRowClick = (n: Notification) => {
    if (!n.read) read.mutate(n._id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        aria-expanded={open}
        className={cn(
          'relative w-9 h-9 rounded-sm flex items-center justify-center text-text-muted transition-colors duration-[var(--dur)] hover:bg-bg-hover hover:text-text',
          open && 'bg-bg-hover text-text',
        )}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-grad text-white text-[10px] font-semibold leading-none flex items-center justify-center shadow-a"
            aria-label={`${unread} unread`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-2rem)] bg-bg-card border border-border rounded-md shadow-lg overflow-hidden animate-slide-up z-50"
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <strong className="text-[13px]">Notifications</strong>
              {unread > 0 && (
                <span className="text-[10px] font-semibold text-accent bg-accent-50 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)] rounded-full px-1.5 py-px">
                  {unread} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => unread > 0 && readAll.mutate()}
                disabled={unread === 0 || readAll.isPending}
                className="inline-flex items-center gap-1 text-[11.5px] text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
              <button
                type="button"
                onClick={() =>
                  items.length > unread && clearRead.mutate()
                }
                disabled={items.length === unread || clearRead.isPending}
                title="Clear read notifications"
                className="inline-flex items-center gap-1 text-[11.5px] text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-2 pt-2 border-b border-border">
            {TABS.map((t) => {
              const active = tab === t.key;
              const count =
                t.key === 'unread'
                  ? unread
                  : t.key === 'mentions'
                    ? items.filter((n) => n.type === 'mention').length
                    : items.length;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-t-sm border-b-2 -mb-px transition-colors',
                    active
                      ? 'border-accent text-text'
                      : 'border-transparent text-text-muted hover:text-text',
                  )}
                >
                  {t.label}
                  {count > 0 && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-px rounded-full',
                        active
                          ? 'bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.18)] dark:text-[var(--a-200)]'
                          : 'bg-bg-hover text-text-muted',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="max-h-[440px] overflow-y-auto">
            {isLoading ? (
              <SkeletonList />
            ) : filtered.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              filtered.map((n) => (
                <Row
                  key={n._id}
                  n={n}
                  onClick={() => onRowClick(n)}
                  onDismiss={() => remove.mutate(n._id)}
                />
              ))
            )}
          </div>
          <div className="border-t border-border bg-bg-subtle/40">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-center text-[12px] font-medium text-accent hover:bg-bg-hover transition-colors"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  n,
  onClick,
  onDismiss,
}: {
  n: Notification;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const meta = TYPE_META[n.type] ?? TYPE_META.issue;
  const Icon = meta.Icon;
  const count = n.count ?? 1;
  const distinctActors = n.actorIds?.length ?? 0;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      className={cn(
        'group relative w-full flex items-start gap-3 px-3.5 py-3 text-left border-b border-border last:border-b-0 transition-colors cursor-pointer outline-none hover:bg-bg-hover focus-visible:bg-bg-hover',
        !n.read && 'bg-accent-50/40 dark:bg-[rgba(99,102,241,.06)]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
          meta.ring,
        )}
      >
        <Icon className={cn('w-4 h-4', meta.tone)} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <strong
            className={cn(
              'text-[13px] truncate',
              !n.read ? 'text-text' : 'text-text-sub font-medium',
            )}
          >
            {n.title}
            {count > 1 && (
              <span className="ml-1.5 text-[10px] font-semibold text-accent bg-accent-50 dark:bg-[rgba(99,102,241,.18)] dark:text-[var(--a-200)] rounded-full px-1.5 py-px align-middle">
                ×{count}
                {distinctActors > 1 && (
                  <span className="opacity-70"> · {distinctActors}</span>
                )}
              </span>
            )}
          </strong>
          <span className="ml-auto text-[10.5px] text-text-muted flex-shrink-0">
            {relTime(n.updatedAt ?? n.createdAt)}
          </span>
        </div>
        <p className="text-[12px] text-text-muted mt-0.5 line-clamp-2">
          {n.subject}
        </p>
      </div>
      {!n.read && (
        <span
          className="mt-2 w-2 h-2 rounded-full bg-accent flex-shrink-0 group-hover:opacity-0 transition-opacity"
          aria-label="unread"
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Dismiss notification"
        className="absolute top-2 right-2 w-6 h-6 rounded-sm flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-bg-card hover:text-text transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 px-2 py-3 animate-pulse"
        >
          <div className="w-8 h-8 rounded-full bg-bg-hover flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 bg-bg-hover rounded" />
            <div className="h-2.5 w-3/4 bg-bg-hover rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const msg =
    tab === 'unread'
      ? "You're all caught up."
      : tab === 'mentions'
        ? 'No mentions yet.'
        : 'No notifications yet.';
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-text-muted">
        <Inbox className="w-5 h-5" />
      </span>
      <p className="text-[12.5px] text-text-muted">{msg}</p>
    </div>
  );
}
