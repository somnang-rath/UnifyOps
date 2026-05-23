import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';

const STATUS: Record<string, { cls: string; label: string }> = {
  // Standard statuses
  todo:       { cls: 'bg-bg-hover text-text-sub',              label: 'To do'      },
  inprogress: { cls: 'bg-[rgba(245,158,11,.12)] text-amber',   label: 'In progress'},
  review:     { cls: 'bg-[rgba(59,130,246,.12)] text-blue',    label: 'Review'     },
  done:       { cls: 'bg-[rgba(16,185,129,.12)] text-green',   label: 'Done'       },
  // Role-specific Kanban column IDs (from seed role-boards)
  design:     { cls: 'bg-[rgba(168,85,247,.12)] text-violet',  label: 'In Design'       },
  ready:      { cls: 'bg-[rgba(236,72,153,.12)] text-pink',    label: 'Ready to Publish' },
  discovery:  { cls: 'bg-[rgba(99,102,241,.12)] text-accent',  label: 'Discovery'       },
};

export function StatusPill({ status }: { status: string }) {
  const meta = STATUS[status] ?? {
    cls: 'bg-accent-50 text-accent',
    label: status,
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-[9px] py-[3px] rounded-full text-[11px] font-semibold whitespace-nowrap',
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

const PRIO = {
  low: 'bg-[rgba(16,185,129,.1)] text-green',
  medium: 'bg-[rgba(245,158,11,.1)] text-amber',
  high: 'bg-[rgba(239,68,68,.1)] text-red',
  critical: 'bg-gradient-to-br from-red to-pink text-white',
} as const;

export function PriorityPill({
  priority,
}: {
  priority: Issue['priority'];
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[3px] px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize',
        PRIO[priority],
      )}
    >
      {priority}
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex px-[9px] py-0.5 rounded-full text-[11px] font-medium border border-border text-text-sub bg-bg-subtle">
      {children}
    </span>
  );
}

const MR_STATUS = {
  open: {
    cls: 'bg-[rgba(16,185,129,.12)] text-green',
    label: 'Open',
  },
  merged: {
    cls: 'bg-[rgba(139,92,246,.12)] text-violet',
    label: 'Merged',
  },
  closed: {
    cls: 'bg-[rgba(239,68,68,.12)] text-red',
    label: 'Closed',
  },
} as const;

export function MRStatusPill({
  status,
}: {
  status: 'open' | 'merged' | 'closed';
}) {
  const m = MR_STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-[9px] py-[3px] rounded-full text-[11px] font-semibold whitespace-nowrap',
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}
