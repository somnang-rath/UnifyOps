'use client';
import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/select';
import { useIssueBulk, type BulkPatch } from '@/hooks/use-issues';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
} from '@/schemas/issue';

const labelize = (s: string) => s[0].toUpperCase() + s.slice(1);

interface Props {
  ids: string[];
  users: { _id: string; name: string }[];
  onClear: () => void;
}

/**
 * Bulk edit bar for the issues list (Phase 7b).
 *
 * Per ADR 0011 §4 the selection has **no URL surface** — it is ephemeral UI
 * state owned by the page, passed down as ids. This component only turns a
 * choice into a request.
 *
 * Each control applies immediately rather than staging a patch behind an
 * "Apply" button: the selection survives the write, so setting a status and
 * then a priority is two clicks, not two round trips through a form. The
 * controls reset to their placeholder afterwards — they are actions, not a
 * shared value the selection actually has (twelve issues rarely agree on one).
 */
export function BulkBar({ ids, users, onClear }: Props) {
  const { update, remove } = useIssueBulk();
  const [confirming, setConfirming] = useState(false);
  const busy = update.isPending || remove.isPending;

  const apply = (patch: BulkPatch) => update.mutate({ ids, patch });

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5 shadow-lg"
      >
        <span aria-live="polite" className="text-[13px] font-medium">
          {ids.length} selected
        </span>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        <Select
          inline
          size="sm"
          value=""
          disabled={busy}
          placeholder="Status…"
          aria-label="Set status for selected tasks"
          onValueChange={(status) => apply({ status })}
          options={ISSUE_STATUSES.map((s) => ({
            value: s,
            label: labelize(s),
          }))}
        />
        <Select
          inline
          size="sm"
          value=""
          disabled={busy}
          placeholder="Priority…"
          aria-label="Set priority for selected tasks"
          onValueChange={(priority) => apply({ priority })}
          options={ISSUE_PRIORITIES.map((p) => ({
            value: p,
            label: labelize(p),
          }))}
        />
        <Select
          inline
          size="sm"
          value=""
          disabled={busy}
          placeholder="Type…"
          aria-label="Set type for selected tasks"
          onValueChange={(type) => apply({ type })}
          options={ISSUE_TYPES.map((t) => ({ value: t, label: labelize(t) }))}
        />
        <Select
          inline
          size="sm"
          value=""
          disabled={busy}
          placeholder="Assignee…"
          aria-label="Set assignee for selected tasks"
          // `__none` is a sentinel: an empty value can't be distinguished from
          // the placeholder, and unassigning must be reachable.
          onValueChange={(v) =>
            apply({ assigneeId: v === '__none' ? null : v })
          }
          options={[
            { value: '__none', label: 'Unassigned' },
            ...users.map((u) => ({ value: u._id, label: u.name })),
          ]}
        />

        {/* Packed left, not `ml-auto` — the toaster occupies the bottom-right
            corner, and a result toast must not cover Delete/Clear. */}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(true)}
            aria-label="Delete selected tasks"
            className="text-red"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <Confirm
        open={confirming}
        danger
        title={`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`}
        body="This cannot be undone. Tasks you didn't create are skipped unless you're an admin."
        onConfirm={() => remove.mutate(ids, { onSuccess: onClear })}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
