'use client';
import { CheckCircle2, Trash2, X } from 'lucide-react';

interface BulkActionsBarProps {
  count: number;
  onResolve: () => void;
  onDelete: () => void;
  onClear: () => void;
  resolving: boolean;
  deleting: boolean;
}

export function BulkActionsBar({
  count,
  onResolve,
  onDelete,
  onClear,
  resolving,
  deleting,
}: BulkActionsBarProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-accent-50 dark:bg-accent/10 border border-accent/30 text-[12px]">
      <span className="text-accent-700 dark:text-accent font-medium">{count} selected</span>
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={onResolve}
          disabled={resolving}
          className="flex items-center gap-1.5 h-7 px-3 rounded bg-emerald-500 hover:bg-emerald-600 text-white font-medium disabled:opacity-40 transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {resolving ? 'Resolving…' : 'Mark Resolved'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 h-7 px-3 rounded bg-red-500 hover:bg-red-600 text-white font-medium disabled:opacity-40 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
