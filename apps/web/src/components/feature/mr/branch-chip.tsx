import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BranchChip({
  name,
  target,
  className,
}: {
  name: string;
  target?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-[3px] rounded-sm font-mono text-[11px] font-medium border',
        target
          ? 'bg-[rgba(16,185,129,.1)] text-green border-[rgba(16,185,129,.2)]'
          : 'bg-[rgba(99,102,241,.1)] text-accent-700 border-[rgba(99,102,241,.2)]',
        className,
      )}
    >
      <GitBranch className="w-3 h-3" /> {name}
    </span>
  );
}
