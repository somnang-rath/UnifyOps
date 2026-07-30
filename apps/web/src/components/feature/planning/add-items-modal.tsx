'use client';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Checkbox, EmptyState } from '@prism/ui';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { InputWithIcon } from '@/components/ui/input';
import { SkeletonText } from '@/components/ui/skeleton';
import { useIssues } from '@/hooks/use-issues';
import { useDebounce } from '@/hooks/use-debounce';

interface Props {
  open: boolean;
  projectId: string;
  /** Shown in the title — the cycle's or module's name. */
  targetName: string;
  /**
   * The backlog filter, e.g. `{ cycleId: 'none' }` or `{ moduleId: 'none' }`.
   * Passing it rather than hardcoding is what lets cycles and modules share
   * this dialog, and it keeps the "unscheduled only" rule **server-side**: an
   * item already in another cycle is never listed, so this dialog can't quietly
   * pull work out of a running sprint. Moving one is an explicit act elsewhere.
   */
  backlogFilter: { cycleId?: 'none'; moduleId?: 'none' };
  saving: boolean;
  onAdd: (issueIds: string[]) => void;
  onClose: () => void;
}

/** Pick unscheduled work items to drop into a cycle or a module. */
export function AddItemsModal({
  open,
  projectId,
  targetName,
  backlogFilter,
  saving,
  onAdd,
  onClose,
}: Props) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const debouncedQ = useDebounce(q, 220);

  const { data: resp, isLoading } = useIssues({
    projectId,
    status: 'all',
    ...backlogFilter,
    q: debouncedQ || undefined,
  });

  // Reset each time it opens — a selection left over from the previous cycle
  // would otherwise apply to this one.
  useEffect(() => {
    if (open) {
      setQ('');
      setSelected([]);
    }
  }, [open]);

  const items = resp?.items ?? [];

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Add work items to ${targetName}`}
      description="Only items that aren't scheduled anywhere yet are listed."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onAdd(selected)}
            disabled={saving || selected.length === 0}
          >
            {saving
              ? 'Adding…'
              : selected.length
                ? `Add ${selected.length} item${selected.length === 1 ? '' : 's'}`
                : 'Add items'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <InputWithIcon
          icon={<Search className="w-3.5 h-3.5" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search unscheduled work items…"
          aria-label="Search unscheduled work items"
        />

        <div className="max-h-[46vh] overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <SkeletonText lines={5} />
          ) : items.length === 0 ? (
            <EmptyState
              label="Nothing to add"
              hint={
                debouncedQ
                  ? 'No unscheduled work item matches that search.'
                  : 'Every work item in this project is already scheduled.'
              }
            />
          ) : (
            <ul className="flex flex-col gap-px">
              {items.map((issue) => (
                <li key={issue._id}>
                  <label className="flex items-center gap-2.5 px-2 py-2 rounded-sm cursor-pointer hover:bg-bg-hover">
                    <Checkbox
                      checked={selected.includes(issue._id)}
                      onChange={() => toggle(issue._id)}
                    />
                    <span className="flex-1 min-w-0 truncate text-[13px]">
                      {issue.title}
                    </span>
                    <span className="text-[11px] text-text-muted capitalize flex-shrink-0">
                      {issue.status}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
