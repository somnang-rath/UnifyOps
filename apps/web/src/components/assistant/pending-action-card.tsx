'use client';
import { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useConfirmPendingAction } from '@/hooks/use-assistant';
import type { PendingAction } from '@/schemas/assistant';
import { cn } from '@/lib/utils';

/**
 * The confirmation affordance Tier C depends on (ADR 0015 §2.2).
 *
 * The assistant cannot delete anything; it can only describe a deletion, and
 * this card is the only path from that description to the action. Pressing
 * Delete replays the described request as an ordinary authenticated call — so
 * the user's permissions still decide the outcome, and a model that talks its
 * way into *claiming* it was confirmed has still changed nothing.
 *
 * The affected items are listed by title rather than counted, because "delete
 * 12 work items" is not something anyone can meaningfully agree to.
 */
export function PendingActionCard({
  action,
  onDone,
}: {
  action: PendingAction;
  onDone: () => void;
}) {
  const confirm = useConfirmPendingAction();
  const [done, setDone] = useState(false);

  if (done) return null;

  return (
    <div className="rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold">{action.summary}</p>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            The assistant has not done this. Confirm to carry it out.
          </p>

          <ul className="mt-2 space-y-0.5">
            {action.items.map((i) => (
              <li key={i.id} className="truncate text-[12px] text-text-sub">
                · {i.title || i.id}
              </li>
            ))}
          </ul>
          {action.skipped?.length ? (
            <p className="mt-1.5 text-[11px] text-text-muted">
              {action.skipped.length} item(s) you cannot see were left out.
            </p>
          ) : null}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={confirm.isPending}
              onClick={() =>
                confirm.mutate(action, {
                  onSuccess: () => {
                    setDone(true);
                    onDone();
                  },
                })
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md bg-red px-2.5 py-1 text-[12px] font-medium text-white',
                'transition-opacity hover:opacity-90 disabled:opacity-50',
              )}
            >
              <Check className="h-3.5 w-3.5" />
              {confirm.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-text-sub transition-colors hover:bg-bg-hover hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
