'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlarmClock,
  AlertCircle,
  Activity,
  AtSign,
  BookOpen,
  Bot,
  CheckCheck,
  CheckCircle2,
  FolderInput,
  GitMerge,
  GitPullRequest,
  Inbox,
  MessageSquare,
  Search,
  Trash2,
  Users,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useNotifMutations,
  useNotificationHistory,
  useNotifications,
} from '@/hooks/use-notifications';
import { useFormat } from '@prism/i18n';
import { cn } from '@/lib/utils';
import type { Notification, NotifType } from '@/schemas/notification';

type Meta = { Icon: LucideIcon; tone: string; ring: string };

const A = {
  tone: 'text-amber-600 dark:text-amber-400',
  ring: 'bg-amber-500/10',
};
const V = {
  tone: 'text-violet-600 dark:text-violet-400',
  ring: 'bg-violet-500/10',
};
const S = {
  tone: 'text-sky-600 dark:text-sky-400',
  ring: 'bg-sky-500/10',
};
const E = {
  tone: 'text-emerald-600 dark:text-emerald-400',
  ring: 'bg-emerald-500/10',
};
const R = {
  tone: 'text-rose-600 dark:text-rose-400',
  ring: 'bg-rose-500/10',
};

const TYPE_META: Record<NotifType, Meta> = {
  issue: { Icon: AlertCircle, ...A },
  mr: { Icon: GitMerge, ...V },
  mention: { Icon: AtSign, ...S },
  done: { Icon: CheckCircle2, ...E },
  issue_assigned: { Icon: UserPlus, ...A },
  issue_status: { Icon: Activity, ...A },
  issue_commented: { Icon: MessageSquare, ...S },
  mr_review: { Icon: GitPullRequest, ...V },
  mr_decided: { Icon: GitMerge, ...V },
  mr_commented: { Icon: MessageSquare, ...V },
  wiki_mention: { Icon: BookOpen, ...S },
  note_shared: { Icon: FolderInput, ...E },
  project_member: { Icon: Users, ...E },
  due_soon: { Icon: AlarmClock, ...R },
  digest: { Icon: Bot, ...V },
};

function bucketOf(n: Notification, now: Date): string {
  const d = new Date(n.updatedAt ?? n.createdAt);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  if (d >= todayStart) return 'Today';
  if (d >= yesterdayStart) return 'Yesterday';
  if (d >= weekStart) return 'Last 7 days';
  return 'Older';
}

const BUCKET_ORDER = ['Today', 'Yesterday', 'Last 7 days', 'Older'] as const;

type Tab = 'all' | 'unread' | 'mentions';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mentions', label: 'Mentions' },
];

export default function NotificationsHistoryPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useNotificationHistory();
  const { data: panelData } = useNotifications();
  const { read, readAll, remove, clearRead } = useNotifMutations();
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const items = useMemo<Notification[]>(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      unread: items.filter((n) => !n.read).length,
      mentions: items.filter((n) => n.type === 'mention').length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((n) => {
      if (tab === 'unread' && n.read) return false;
      if (tab === 'mentions' && n.type !== 'mention') return false;
      if (needle) {
        const hay = `${n.title} ${n.subject}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, tab, q]);

  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<string, Notification[]>();
    for (const n of filtered) {
      const b = bucketOf(n, now);
      const list = map.get(b) ?? [];
      list.push(n);
      map.set(b, list);
    }
    return BUCKET_ORDER.filter((k) => map.has(k)).map(
      (k) => [k, map.get(k)!] as const,
    );
  }, [filtered]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          hasNextPage &&
          !isFetchingNextPage
        ) {
          fetchNextPage();
        }
      },
      { rootMargin: '320px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const unread = panelData?.unread ?? 0;
  const hasRead = items.some((n) => n.read);

  const onRowClick = (n: Notification) => {
    if (!n.read) read.mutate(n._id);
    if (n.link) router.push(n.link);
  };

  return (
    <>
      <div className="mb-5 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Notifications
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Your full history. The bell shows the 40 most recent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => unread > 0 && readAll.mutate()}
            disabled={unread === 0 || readAll.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-sm border border-border text-text-sub hover:border-accent hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
          <button
            type="button"
            onClick={() => hasRead && clearRead.mutate()}
            disabled={!hasRead || clearRead.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-sm border border-border text-text-sub hover:border-accent hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear read
          </button>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-wrap">
          <div className="flex items-center gap-1">
            {TABS.map((t) => {
              const active = tab === t.key;
              const c = counts[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium rounded-sm transition-colors',
                    active
                      ? 'bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)]'
                      : 'text-text-muted hover:text-text hover:bg-bg-hover',
                  )}
                >
                  {t.label}
                  {c > 0 && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-px rounded-full',
                        active
                          ? 'bg-accent text-white'
                          : 'bg-bg-hover text-text-muted',
                      )}
                    >
                      {c}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="ml-auto relative w-full sm:w-[260px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title or subject…"
              className="w-full pl-8 pr-7 py-1.5 text-[12.5px] bg-bg-subtle border border-border rounded-sm outline-none focus:border-accent transition-colors"
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQ('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="p-3 space-y-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-sm bg-bg-hover" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <span className="w-12 h-12 rounded-full bg-bg-hover flex items-center justify-center text-text-muted">
              <Inbox className="w-6 h-6" />
            </span>
            <p className="text-[13px] text-text-muted">
              {q.trim()
                ? `No matches for "${q.trim()}".`
                : tab === 'unread'
                  ? "You're all caught up."
                  : tab === 'mentions'
                    ? 'No mentions in your history.'
                    : 'No notifications yet.'}
            </p>
          </div>
        ) : (
          <div>
            {grouped.map(([bucket, list]) => (
              <section key={bucket}>
                <div className="sticky top-tb z-10 px-5 py-2 bg-bg-card/95 backdrop-blur-sm border-b border-border text-[11px] font-semibold uppercase tracking-[.08em] text-text-muted">
                  {bucket}
                </div>
                {list.map((n) => (
                  <Row
                    key={n._id}
                    n={n}
                    onClick={() => onRowClick(n)}
                    onDismiss={() => remove.mutate(n._id)}
                  />
                ))}
              </section>
            ))}
            <div ref={sentinelRef} className="h-12 flex items-center justify-center">
              {isFetchingNextPage && (
                <span className="text-[12px] text-text-muted">Loading…</span>
              )}
              {!hasNextPage && items.length > 0 && (
                <span className="text-[11.5px] text-text-muted">
                  End of history
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
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
  const f = useFormat();
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
        'group relative flex items-start gap-3.5 px-5 py-3.5 border-b border-border last:border-b-0 transition-colors cursor-pointer outline-none hover:bg-bg-hover focus-visible:bg-bg-hover',
        !n.read && 'bg-accent-50/40 dark:bg-[rgba(99,102,241,.06)]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
          meta.ring,
        )}
      >
        <Icon className={cn('w-[18px] h-[18px]', meta.tone)} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <strong
            className={cn(
              'text-[13.5px]',
              !n.read ? 'text-text' : 'text-text-sub font-medium',
            )}
          >
            {n.title}
            {count > 1 && (
              <span className="ml-2 text-[10.5px] font-semibold text-accent bg-accent-50 dark:bg-[rgba(99,102,241,.18)] dark:text-[var(--a-200)] rounded-full px-1.5 py-px align-middle">
                ×{count}
                {distinctActors > 1 && (
                  <span className="opacity-70"> · {distinctActors}</span>
                )}
              </span>
            )}
          </strong>
          <span className="ml-auto text-[11px] text-text-muted flex-shrink-0">
            {f.relative(n.updatedAt ?? n.createdAt)}
          </span>
        </div>
        <p className="text-[12.5px] text-text-muted mt-1 line-clamp-2">
          {n.subject}
        </p>
      </div>
      {!n.read && (
        <span
          className="mt-2 w-2 h-2 rounded-full bg-accent flex-shrink-0"
          aria-label="unread"
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Dismiss"
        className="ml-1 mt-1 w-7 h-7 rounded-sm flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-bg-card hover:text-text transition-opacity"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
