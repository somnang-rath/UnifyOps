import { getFormatter, getTranslations } from 'next-intl/server';
import { Avatar } from '@/components/ui/avatar';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { splitMentions } from '@/lib/mentions';
import type { CommentEntry, CommentThreadView } from '@/server/services/comments';
import { AttachmentList } from './attachment-list';
import { CommentComposer, type ComposerContext } from './comment-composer';
import { DeleteComment } from './comment-delete';
import { hasKhmer } from '@/lib/search';

/**
 * One work item's conversation (§7.7 — slice 8).
 *
 * A server component, like the activity feed it sits above: the bodies, the
 * names and the timestamps are all resolved where the locale and the workspace
 * timezone already are, so §13's hardest requirement costs nothing. Only the
 * composer and the delete control are client components, and only because
 * typing and confirming are interactions.
 *
 * §11's five states: `[L]` server-rendered inside the page, no spinner ·
 * `[E]` an item nobody has commented on says so and shows the box that fixes
 * it · `[S]` the action revalidates and the thread re-renders with the new
 * comment in it · `[X]` a failed post reports on the composer and keeps the
 * text (§7.7) · `[!]` three of them: an archived project renders the thread
 * read-only with the reason on screen rather than hiding the box, a deleted
 * comment leaves a tombstone rather than closing the gap, and a long thread
 * truncates from the *top* with a link to the rest.
 *
 * **Files pasted into a comment render inside that comment** (§2.4), where the
 * item's own files render in their own panel above it. Two lists, because they
 * mean two things: a file on the item is a property of the work, and a file in
 * a comment is part of what somebody said.
 *
 * **Mentions render as the person's current name**, resolved from the id in the
 * body. The stored string never contains a name, so somebody who changes theirs
 * reads correctly in a comment written last March (§13).
 */

/** The mention chip. Navy on a pale sky in light, Sky on deep navy in dark —
 * both sides of the accent pair, so it stays legible when the theme flips. */
const MENTION = 'rounded-sm bg-accent-subtle px-1 font-medium text-accent';

/**
 * §20.10, and §13's oldest open gap, closed.
 *
 * The gap has been recorded since slice 8: "a Khmer comment in an English
 * workspace inherits `lang=\"en\"` and clips its diacritics, and the same is true
 * today of item titles, descriptions and project names." §20.10 asks for all
 * four to be fixed **together**, in this slice, "because fixing it in one place
 * and not the others is how one gap becomes four".
 *
 * `hasKhmer` is the detector and it is the *same* one `searchRoute` uses — one
 * implementation, so text that searches as Khmer also renders as Khmer.
 * `undefined` rather than `\"en\"` when there is no Khmer in it, because the
 * page's own `lang` is already right for that case and restating it would
 * override a correct value with a guessed one.
 */
function Body({ body, mentioned }: { body: string; mentioned: Record<string, string> }) {
  return (
    // `pre-wrap`, because a comment is typed prose: the paragraph breaks
    // somebody put in are part of what they wrote. `break-words` so a pasted
    // URL cannot push the panel wider than the page on a 390px screen (§15-6).
    <p
      lang={hasKhmer(body) ? 'km' : undefined}
      className="whitespace-pre-wrap break-words text-sm text-text"
    >
      {splitMentions(body).map((segment, index) =>
        segment.kind === 'text' ? (
          // The index is a sound key here: segments are derived from one
          // immutable body and are never reordered or inserted into.
          <span key={index}>{segment.text}</span>
        ) : (
          <span key={index} className={MENTION}>
            @{mentioned[segment.memberId] ?? ''}
          </span>
        ),
      )}
    </p>
  );
}

async function Comment({
  entry,
  context,
  mentioned,
  timezone,
}: {
  entry: CommentEntry;
  context: ComposerContext;
  mentioned: Record<string, string>;
  timezone: string;
}) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const who = entry.authorName ?? t('comments.formerMember');

  return (
    <li className="flex items-start gap-2.5">
      <Avatar id={entry.authorUserId ?? entry.authorMemberId} name={who} size="md" className="mt-0.5" />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-text">{who}</span>
          <time
            dateTime={entry.createdAt.toISOString()}
            className="text-2xs tabular-nums text-text-subtle"
          >
            {format.dateTime(entry.createdAt, {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: timezone,
            })}
          </time>

          {entry.canDelete && (
            <DeleteComment context={context} commentId={entry.id} author={who} />
          )}
        </div>

        {entry.deletedAt === null ? (
          <>
            {/* A body is optional when a file is not: §2.4's pasted screenshot
                is often the whole message, so an empty body renders nothing
                rather than an empty paragraph. */}
            {entry.body !== '' && <Body body={entry.body} mentioned={mentioned} />}
            {entry.files.length > 0 && (
              <AttachmentList
                files={entry.files}
                context={context}
                label={t('attachments.inComment', { author: who })}
              />
            )}
          </>
        ) : (
          // The tombstone. §10 lets a Lead remove somebody else's comment, and a
          // thread that silently closed over the gap would read as though the
          // exchange never happened — which is the one thing a moderated
          // conversation must not do.
          <p className="text-sm italic text-text-subtle">{t('comments.deleted')}</p>
        )}
      </div>
    </li>
  );
}

export async function CommentThread({
  thread,
  context,
  timezone,
  showAllHref,
}: {
  thread: CommentThreadView;
  context: ComposerContext;
  /** The company's zone (§6-1), so one comment has one timestamp for everybody. */
  timezone: string;
  /** Where "show the whole conversation" goes, or null when nothing is hidden. */
  showAllHref: string | null;
}) {
  const t = await getTranslations();

  return (
    <section aria-labelledby="comments-heading" className="space-y-3">
      <h2 id="comments-heading" className="text-xs font-medium text-text-muted">
        {t('comments.heading')}
      </h2>

      {thread.truncated && showAllHref && (
        <p className="text-2xs text-text-subtle">
          {t('comments.truncated')}{' '}
          <Link
            href={showAllHref}
            className="underline underline-offset-2 transition-colors duration-120 hover:text-text"
          >
            {t('comments.showAll')}
          </Link>
        </p>
      )}

      {thread.entries.length === 0 ? (
        <EmptyState title={t('comments.empty')} />
      ) : (
        <ol className="space-y-4">
          {thread.entries.map((entry) => (
            <Comment
              key={entry.id}
              entry={entry}
              context={context}
              mentioned={thread.mentioned}
              timezone={timezone}
            />
          ))}
        </ol>
      )}

      {thread.canComment ? (
        <CommentComposer context={context} people={thread.mentionable} />
      ) : (
        // Shown rather than hidden, for the reason the item page states: a
        // person looking at a stale tab has to be able to see *why* they cannot
        // type, and a box that has quietly vanished explains nothing. Two
        // sentences, because "unarchive it" and "ask for access" are different
        // things to go and do.
        <Alert tone="warning">
          {thread.cannotCommentReason === 'archived'
            ? t('comments.cannotCommentArchived')
            : t('comments.cannotCommentForbidden')}
        </Alert>
      )}
    </section>
  );
}
