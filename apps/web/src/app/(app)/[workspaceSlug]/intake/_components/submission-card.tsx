'use client';
import Link from 'next/link';
import { Check, Mail, RefreshCw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label, PriorityPill } from '@/components/feature/issue/pills';
import { relTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';
import type { IntakeStatus, IntakeSubmission } from '@/hooks/use-intake';

const STATUS_STYLE: Record<IntakeStatus, string> = {
  pending: 'bg-amber-500/12 text-amber-600 border-amber-500/25',
  accepted: 'bg-green/12 text-green border-green/25',
  declined: 'bg-bg-subtle text-text-muted border-border',
};

/**
 * One row of the triage queue.
 *
 * Accepting is deliberately two buttons, not one: "Accept" sends nothing and
 * lets the API apply the stored suggestion (a single click for the common
 * case), while "Edit" opens the form pre-filled with the same values. Both go
 * through the same endpoint — the difference is only whether the triager looks
 * at the proposal before agreeing to it.
 */
export function SubmissionCard({
  sub,
  assigneeName,
  workspaceSlug,
  busy,
  onAccept,
  onEdit,
  onDecline,
  onSuggest,
}: {
  sub: IntakeSubmission;
  /** Resolved from the project's members; absent when the id no longer maps. */
  assigneeName?: string;
  workspaceSlug: string;
  busy: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onDecline: () => void;
  onSuggest: () => void;
}) {
  const pending = sub.status === 'pending';
  const s = sub.suggestion;

  return (
    <article
      className={cn(
        'bg-bg-card border border-border rounded-xl px-4 py-3.5 flex flex-col gap-2.5',
        !pending && 'opacity-75',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-snug break-words">
            {sub.title}
          </h3>
          <div className="flex items-center gap-2 mt-1 text-[11.5px] text-text-muted flex-wrap">
            <span>{relTime(sub.createdAt)}</span>
            {sub.submitterEmail && (
              <a
                href={`mailto:${sub.submitterEmail}`}
                className="inline-flex items-center gap-1 hover:text-text"
              >
                <Mail className="w-3 h-3" aria-hidden="true" />
                {sub.submitterEmail}
              </a>
            )}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-semibold capitalize',
            STATUS_STYLE[sub.status],
          )}
        >
          {sub.status}
        </span>
      </div>

      {sub.description && (
        <p className="text-[12.5px] text-text-sub whitespace-pre-wrap line-clamp-4">
          {sub.description}
        </p>
      )}

      {/* The proposal, shown before any action — a suggestion the triager can
          read is the only thing that makes one-click Accept honest. */}
      {pending && (
        <div className="flex items-center gap-2 flex-wrap text-[11.5px] text-text-muted">
          <Sparkles className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
          {s ? (
            <>
              {s.priority && (
                <PriorityPill priority={s.priority as Issue['priority']} />
              )}
              {s.labels.map((l) => (
                <Label key={l}>{l}</Label>
              ))}
              <span>{assigneeName ? `→ ${assigneeName}` : 'unassigned'}</span>
            </>
          ) : (
            <span>No suggestion yet.</span>
          )}
          <button
            type="button"
            onClick={onSuggest}
            disabled={busy}
            className="inline-flex items-center gap-1 text-text-muted hover:text-text disabled:opacity-50"
            title="Ask the assistant again"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            {s ? 'Re-run' : 'Suggest'}
          </button>
        </div>
      )}

      {sub.status === 'accepted' && sub.issueId && (
        <Link
          href={`/${workspaceSlug}/issues/${sub.issueId}`}
          className="text-[12px] text-accent hover:underline underline-offset-2 w-fit"
        >
          View the work item →
        </Link>
      )}

      {pending && (
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            size="sm"
            variant="primary"
            onClick={onAccept}
            disabled={busy}
          >
            <Check className="w-3.5 h-3.5" /> Accept
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            Edit &amp; accept
          </Button>
          <Button size="sm" variant="ghost" onClick={onDecline} disabled={busy}>
            <X className="w-3.5 h-3.5" /> Decline
          </Button>
        </div>
      )}
    </article>
  );
}
