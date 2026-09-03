import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { toEntry } from '@/components/notifications/entry';
import { NotificationList } from '@/components/notifications/notification-list';
import { resolveActorContext } from '@/server/auth/context';
import { getInbox } from '@/server/services/notifications';
import {
  loadMoreInboxAction,
  markInboxReadAction,
  setNotificationReadAction,
} from './actions';

/**
 * §7.8's inbox.
 *
 * A server component that renders the first page and hands the client three
 * bound actions. The list is interactive — marking read is optimistic — but the
 * data is not; there is no reason for the first page to arrive as a fetch after
 * the shell has painted.
 *
 * No `loading.tsx` skeleton, deliberately. The page is one query on an index
 * built for it, and a skeleton that flashes for 20ms is a layout shift with
 * extra steps. The five-states loading requirement is met by the list's own
 * "Show older" transition, which is where waiting actually happens here.
 */
export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  // The layout has already refused a non-member, but a page that trusts its
  // layout is a page that breaks the day somebody renders it another way.
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, inbox] = await Promise.all([getTranslations('inbox'), getInbox(resolved)]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
        {t('title')}
      </h1>

      <NotificationList
        workspaceSlug={workspaceSlug}
        now={new Date().toISOString()}
        entries={inbox.rows.map(toEntry)}
        nextCursor={inbox.nextCursor}
        onSetRead={async (id, read) => {
          'use server';
          return setNotificationReadAction(workspaceSlug, id, read);
        }}
        onMarkAllRead={async () => {
          'use server';
          await markInboxReadAction(workspaceSlug);
        }}
        onLoadMore={async (cursor) => {
          'use server';
          return loadMoreInboxAction(workspaceSlug, cursor);
        }}
      />
    </div>
  );
}
