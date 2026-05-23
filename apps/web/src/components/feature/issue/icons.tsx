import { Bug, CheckSquare, FileText, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Issue } from '@/schemas/issue';

const TYPE = {
  bug: {
    Icon: Bug,
    cls: 'bg-[rgba(239,68,68,.12)] text-red',
  },
  feature: {
    Icon: Zap,
    cls: 'bg-[rgba(245,158,11,.12)] text-amber',
  },
  task: {
    Icon: CheckSquare,
    cls: 'bg-[rgba(16,185,129,.12)] text-green',
  },
  docs: {
    Icon: FileText,
    cls: 'bg-[rgba(59,130,246,.12)] text-blue',
  },
} as const;

export function IssueTypeIcon({
  type,
  size = 28,
  className,
}: {
  type: Issue['type'];
  size?: number;
  className?: string;
}) {
  const { Icon, cls } = TYPE[type];
  const iconSize = Math.round(size * 0.54);
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg flex-shrink-0',
        cls,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Icon style={{ width: iconSize, height: iconSize }} />
    </div>
  );
}
