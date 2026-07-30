'use client';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@prism/ui';
import type { SavedView, SaveViewBody, ViewLayout } from '@/hooks/use-views';

const LAYOUTS: { value: ViewLayout; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'kanban', label: 'Board' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'spreadsheet', label: 'Table' },
];

/** `''` = "any", the absence of that filter. The API strips empty keys. */
const ANY = '';

const STATUS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];
const TYPES = [ANY, 'bug', 'feature', 'task', 'docs'];
const PRIORITIES = [ANY, 'low', 'medium', 'high', 'critical'];
const GROUP_BY = [ANY, 'status', 'priority', 'assignee'];
const SORT_BY = [
  { value: 'created:desc', label: 'Newest first' },
  { value: 'created:asc', label: 'Oldest first' },
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'priority:desc', label: 'Priority' },
];

const titleCase = (v: string) =>
  v ? v[0].toUpperCase() + v.slice(1) : 'Any';

interface Props {
  open: boolean;
  view?: SavedView | null;
  saving: boolean;
  onSave: (body: SaveViewBody) => void;
  onClose: () => void;
}

/**
 * Create/edit a project saved view.
 *
 * This form writes the *definition* directly, unlike the `ViewsBar` on the
 * issues list which snapshots whatever filters are currently applied. Both
 * produce the same shape — this one is for people who know the slice they want
 * without having to build it on the list first.
 */
export function ViewModal({ open, view, saving, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<ViewLayout>('list');
  const [status, setStatus] = useState('open');
  const [type, setType] = useState(ANY);
  const [priority, setPriority] = useState(ANY);
  const [groupBy, setGroupBy] = useState(ANY);
  const [sortBy, setSortBy] = useState('created:desc');
  const [isShared, setIsShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // `filters` can be absent entirely: Mongoose `minimize` drops an empty `{}`
    // at save time, so a view created with no filters loads without the field.
    const f = (view?.filters ?? {}) as Record<string, string | undefined>;
    setName(view?.name ?? '');
    setLayout(view?.layout ?? 'list');
    setStatus(f.status ?? 'open');
    setType(f.type ?? ANY);
    setPriority(f.priority ?? ANY);
    setGroupBy(view?.groupBy ?? ANY);
    setSortBy(view?.sortBy || 'created:desc');
    setIsShared(view?.isShared ?? false);
    setError(null);
  }, [open, view]);

  const submit = () => {
    if (!name.trim()) return setError('Give the view a name');
    setError(null);
    onSave({
      name: name.trim(),
      layout,
      filters: {
        status,
        // Omit rather than send '' — the API's schema would reject an empty
        // enum value, and an absent key is exactly "don't filter on this".
        ...(type ? { type } : {}),
        ...(priority ? { priority } : {}),
      },
      groupBy: groupBy || null,
      sortBy,
      isShared,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={view ? 'Edit view' : 'New view'}
      description="A named slice of this project's work items."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : view ? 'Save changes' : 'Create view'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" required error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Critical bugs"
            maxLength={120}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Layout">
            <Select
              value={layout}
              onValueChange={(v) => setLayout(v as ViewLayout)}
              options={LAYOUTS}
              aria-label="View layout"
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onValueChange={setStatus}
              options={STATUS}
              aria-label="Status filter"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select
              value={type}
              onValueChange={setType}
              options={TYPES.map((v) => ({ value: v, label: titleCase(v) }))}
              aria-label="Type filter"
            />
          </Field>
          <Field label="Priority">
            <Select
              value={priority}
              onValueChange={setPriority}
              options={PRIORITIES.map((v) => ({ value: v, label: titleCase(v) }))}
              aria-label="Priority filter"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Group by">
            <Select
              value={groupBy}
              onValueChange={setGroupBy}
              options={GROUP_BY.map((v) => ({
                value: v,
                label: v ? titleCase(v) : 'No grouping',
              }))}
              aria-label="Group by"
            />
          </Field>
          <Field label="Sort by">
            <Select
              value={sortBy}
              onValueChange={setSortBy}
              options={SORT_BY}
              aria-label="Sort by"
            />
          </Field>
        </div>

        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <div className="text-[13px] font-medium">Share with the team</div>
            <p className="text-[11.5px] text-text-muted mt-0.5 max-w-[42ch]">
              Everyone who can read this project sees a shared view. A private
              view is yours alone.
            </p>
          </div>
          <Switch
            checked={isShared}
            onCheckedChange={setIsShared}
            aria-label="Share this view with the team"
            className="mt-1 flex-shrink-0"
          />
        </div>
      </div>
    </Modal>
  );
}
