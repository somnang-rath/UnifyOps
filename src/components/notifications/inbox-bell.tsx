import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * The bell in the workspace header (§7.8: "Bell shows unread count").
 *
 * A server component and a plain link, deliberately. The count is fetched by
 * the layout that renders it, so it is correct on every navigation and costs
 * one indexed count on a partial index — no client bundle, no polling, no
 * websocket. §8's board polls because a board goes stale while you stare at it;
 * an inbox badge that updates when you move around the product is telling the
 * truth often enough, and slice 9 is not where realtime arrives.
 *
 * The number is capped for layout, not for honesty: the inbox itself shows
 * everything, and a header pill is not the place to render a four-digit count.
 */
const MAX_SHOWN = 99;

export async function InboxBell({
  workspaceSlug,
  unread,
}: {
  workspaceSlug: string;
  unread: number;
}) {
  const t = await getTranslations('inbox');

  return (
    <Link
      href={`/${workspaceSlug}/inbox`}
      // The name carries the count, so a screen reader is not left to infer it
      // from a badge it announces separately — and an icon-only control with no
      // accessible name is a defect (the a11y baseline).
      aria-label={unread > 0 ? t('bell.unread', { count: unread }) : t('bell.empty')}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-xs text-text-muted transition-colors duration-120 hover:bg-surface-sunken hover:text-text"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-[18px] w-[18px]"
      >
        <path
          d="M10 3a4 4 0 0 0-4 4v3l-1.2 2.4A.5.5 0 0 0 5.25 13h9.5a.5.5 0 0 0 .45-.72L14 10V7a4 4 0 0 0-4-4Z"
          strokeLinejoin="round"
        />
        <path d="M8.25 15.25a1.75 1.75 0 0 0 3.5 0" strokeLinecap="round" />
      </svg>

      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-2xs font-medium leading-4 text-danger-fg"
        >
          {unread > MAX_SHOWN ? `${MAX_SHOWN}+` : unread}
        </span>
      )}
    </Link>
  );
}
