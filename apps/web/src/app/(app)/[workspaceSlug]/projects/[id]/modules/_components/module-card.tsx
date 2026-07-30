'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { Avatar, Badge, type BadgeProps } from '@prism/ui';
import { Button, IconButton } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/feature/planning/progress-bar';
import {
  useModuleIssues,
  type FeatureModule,
  type ModuleStatus,
} from '@/hooks/use-modules';
import { cn } from '@/lib/utils';

const STATUS_BADGE: Record<
  ModuleStatus,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  backlog: { label: 'Backlog', variant: 'neutral' },
  planned: { label: 'Planned', variant: 'outline' },
  in_progress: { label: 'In progress', variant: 'accent' },
  paused: { label: 'Paused', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null;

interface Props {
  module: FeatureModule;
  lead?: { name: string; avatar?: string };
  hrefFor: (issueId: string) => string;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddItems: () => void;
  onRemoveItem: (issueId: string) => void;
}

export function ModuleCard({
  module,
  lead,
  hrefFor,
  canWrite,
  onEdit,
  onDelete,
  onAddItems,
  onRemoveItem,
}: Props) {
  const [open, setOpen] = useState(false);
  // Fetch a module's items only once expanded — otherwise a project with many
  // modules fires one request per card on mount.
  const { data: issues = [], isLoading } = useModuleIssues(
    open ? module._id : null,
  );

  const badge = STATUS_BADGE[module.status];
  const { total, completed } = module.progress;

  // Either date can stand alone here, so build the label from what exists
  // rather than assuming a range.
  const dates = [
    module.startDate && `From ${fmt(module.startDate)}`,
    module.targetDate && `Target ${fmt(module.targetDate)}`,
  ].filter(Boolean) as string[];

  return (
    <div className="border border-border rounded-sm bg-bg overflow-hidden">
      <div className="flex items-start gap-3 p-3.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${module.name}` : `Expand ${module.name}`}
          className="mt-0.5 text-text-muted hover:text-text transition-colors"
        >
          <ChevronRight
            className={cn(
              'w-4 h-4 transition-transform duration-[var(--dur)]',
              open && 'rotate-90',
            )}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-semibold truncate">{module.name}</h3>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>

          {module.description && (
            <p className="text-[12.5px] text-text-muted mt-1 line-clamp-2">
              {module.description}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2 text-[11.5px] text-text-muted flex-wrap">
            {lead && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={lead.name} src={lead.avatar} size="xs" />
                {lead.name}
              </span>
            )}
            {dates.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Target className="w-3 h-3" />
                {dates.join(' · ')}
              </span>
            )}
            <span>
              {completed}/{total} done
            </span>
          </div>

          <ProgressBar completed={completed} total={total} className="mt-2" />
        </div>

        {canWrite && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <IconButton onClick={onEdit} aria-label={`Edit ${module.name}`}>
              <Pencil className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton onClick={onDelete} aria-label={`Delete ${module.name}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-border bg-bg-subtle/40 px-3.5 py-3">
          {isLoading ? (
            <SkeletonText lines={3} />
          ) : issues.length === 0 ? (
            <p className="text-[12.5px] text-text-muted py-2">
              No work items in this module yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-px mb-2">
              {issues.map((issue) => (
                <li
                  key={issue._id}
                  className="group flex items-center gap-2.5 px-2 py-1.5 rounded-sm hover:bg-bg-hover"
                >
                  <Link
                    href={hrefFor(issue._id)}
                    className="flex-1 min-w-0 truncate text-[13px] hover:text-accent"
                  >
                    {issue.title}
                  </Link>
                  <span className="text-[11px] text-text-muted capitalize flex-shrink-0">
                    {issue.status}
                  </span>
                  {canWrite && (
                    <IconButton
                      size="xs"
                      onClick={() => onRemoveItem(issue._id)}
                      aria-label={`Remove ${issue.title} from ${module.name}`}
                      // Hover-revealed but always keyboard-reachable.
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canWrite && (
            <Button size="sm" variant="ghost" onClick={onAddItems}>
              <Plus className="w-3.5 h-3.5" />
              Add work items
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
