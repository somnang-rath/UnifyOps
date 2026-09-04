import { getFormatter, getTranslations } from 'next-intl/server';
import { FileText, ImageIcon } from 'lucide-react';
import { describeSize } from '@/lib/attachments';
import type { AttachmentView } from '@/server/services/attachments';
import type { ComposerContext } from './comment-composer';
import { DeleteAttachment } from './attachment-delete';

/**
 * The files on an item, or the files posted with one comment (§7.7, §2.4).
 *
 * A server component, like the thread and the feed around it: names, sizes and
 * timestamps all resolve where the locale and the workspace timezone already
 * are. Only the delete control is a client component, and only because
 * confirming is an interaction.
 *
 * **Every file is fetched through `/api/internal/upload/<id>`, never through a
 * store URL in the markup.** A signed store URL baked into HTML is a bearer
 * credential in a page that gets cached and shared, and it expires while the
 * page is still open. The route asks §10 per request and redirects to a URL
 * good for minutes — so a preview keeps working, and a person who lost access
 * between renders gets a 404 rather than the file.
 *
 * §11's five states: `[L]` server-rendered with the page · `[E]` the item panel
 * says what this is and leaves the drop target live; a comment with no files
 * renders nothing at all · `[S]` the action revalidates and the file appears ·
 * `[X]` a failed removal reports in its own row · `[!]` a long filename
 * truncates with the extension kept, a file whose uploader has left still shows
 * their name (§7.12), and an image that fails to load falls back to its row.
 */

/** Sizes are a number plus a translated unit — never a formatted string (§13). */
async function Size({ bytes }: { bytes: number }) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const { value, unit } = describeSize(bytes);

  return (
    <span className="tabular-nums">
      {t(`attachments.size.${unit}`, { value: format.number(value) })}
    </span>
  );
}

async function Attachment({
  file,
  context,
}: {
  file: AttachmentView;
  context: ComposerContext;
}) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const who = file.uploadedByName ?? t('comments.formerMember');

  const href = `/api/internal/upload/${file.id}?w=${encodeURIComponent(context.workspaceSlug)}`;
  const Icon = file.previewable ? ImageIcon : FileText;

  return (
    <li className="flex items-start gap-2.5 rounded-sm border border-border bg-surface p-2">
      {file.previewable ? (
        // `inline` so the store serves it as an image rather than a download.
        // A plain <img>: `next/image` would proxy or optimise a private file
        // through a URL that outlives the permission check that produced it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${href}&disp=inline`}
          alt={file.filename}
          className="h-12 w-12 shrink-0 rounded-sm border border-border object-cover"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-hover text-text-muted"
        >
          <Icon className="h-5 w-5" />
        </span>
      )}

      <div className="min-w-0 flex-1 space-y-0.5">
        <a
          href={href}
          // Downloads rather than navigating away, and the name comes from the
          // signed disposition rather than from this attribute — the server
          // decides what a file is called, not the markup.
          className="block truncate text-sm text-accent underline underline-offset-2 transition-colors duration-120 hover:text-text"
        >
          {file.filename}
        </a>

        {/* A <div>, not a <p>, and the delete control is why: `DeleteAttachment`
            renders a <form>, which is flow content, and the HTML parser closes
            an open <p> the moment it meets some. The server's markup and the
            browser's tree then disagree about who the button's parent is, which
            React reports as a hydration error on the one panel this row belongs
            to. The comment thread's identical metadata row already uses a
            <div>; this was the one that did not. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-text-subtle">
          <Size bytes={file.sizeBytes} />
          <span aria-hidden>·</span>
          <span>{who}</span>
          <span aria-hidden>·</span>
          <time dateTime={file.createdAt.toISOString()} className="tabular-nums">
            {format.dateTime(file.createdAt, { day: 'numeric', month: 'short' })}
          </time>

          {file.canDelete && (
            <DeleteAttachment
              context={context}
              attachmentId={file.id}
              filename={file.filename}
            />
          )}
        </div>
      </div>
    </li>
  );
}

export async function AttachmentList({
  files,
  context,
  label,
}: {
  files: AttachmentView[];
  context: ComposerContext;
  /** What the list is, for a screen reader. The heading is the caller's. */
  label: string;
}) {
  if (files.length === 0) return null;

  return (
    <ul aria-label={label} className="space-y-1.5">
      {files.map((file) => (
        <Attachment key={file.id} file={file} context={context} />
      ))}
    </ul>
  );
}
