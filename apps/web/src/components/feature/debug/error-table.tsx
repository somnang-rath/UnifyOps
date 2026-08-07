'use client';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import type { ErrorLog, ErrorLogListResult, ErrorLogQuery } from '@/schemas/error-log';

const SOURCE_COLORS: Record<string, string> = {
  frontend: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  backend: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
};

const TYPE_COLORS: Record<string, string> = {
  error: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  debug: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  info: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

function Pill({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide', colorClass)}>
      {label}
    </span>
  );
}

interface ErrorTableProps {
  result: ErrorLogListResult;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  query: ErrorLogQuery;
  onQueryChange: (q: ErrorLogQuery) => void;
  resolving: Set<string>;
  deleting: Set<string>;
}

export function ErrorTable({
  result,
  selected,
  onToggle,
  onToggleAll,
  onResolve,
  onDelete,
  query,
  onQueryChange,
  resolving,
  deleting,
}: ErrorTableProps) {
  const f = useFormat();
  const fmtDate = (iso: string) => `${f.date(iso)} ${f.time(iso)}`;
  const allSelected = result.items.length > 0 && result.items.every((i) => selected.has(i._id));

  return (
    <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-bg-subtle">
              <th className="w-8 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="rounded"
                />
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-36">Date</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-24">Source</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-20">Type</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-16">Code</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Message</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-36">User</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-40">Location</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted w-24">Status</th>
              <th className="px-3 py-2.5 text-right font-semibold text-text-muted w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-text-muted">
                  No logs found.
                </td>
              </tr>
            )}
            {result.items.map((log) => (
              <tr
                key={log._id}
                className={cn(
                  'border-b border-border/50 hover:bg-bg-hover transition-colors',
                  selected.has(log._id) && 'bg-accent-50 dark:bg-accent/5',
                )}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(log._id)}
                    onChange={() => onToggle(log._id)}
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-2 text-text-muted whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                <td className="px-3 py-2">
                  <Pill label={log.source} colorClass={SOURCE_COLORS[log.source] ?? ''} />
                </td>
                <td className="px-3 py-2">
                  <Pill label={log.logType} colorClass={TYPE_COLORS[log.logType] ?? ''} />
                </td>
                <td className="px-3 py-2 text-text-muted tabular-nums">
                  {log.statusCode ?? '—'}
                </td>
                <td className="px-3 py-2 text-text max-w-0">
                  <div className="truncate font-medium" title={log.errorMessage}>
                    {log.errorTitle}
                  </div>
                  <div className="truncate text-text-muted text-[11px]" title={log.errorMessage}>
                    {log.errorMessage}
                  </div>
                </td>
                <td className="px-3 py-2 text-text-muted truncate max-w-[144px]">
                  {log.userEmail ?? '—'}
                </td>
                <td className="px-3 py-2 text-text-muted truncate max-w-[160px]">
                  {log.pageRoute ?? log.endpointUrl ?? '—'}
                </td>
                <td className="px-3 py-2">
                  {log.resolvedStatus ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Resolved
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium">Open</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/debug/${log._id}`}
                      title="View detail"
                      className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Link>
                    {!log.resolvedStatus && (
                      <button
                        type="button"
                        title="Mark resolved"
                        onClick={() => onResolve(log._id)}
                        disabled={resolving.has(log._id)}
                        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-emerald-600 transition-colors disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => onDelete(log._id)}
                      disabled={deleting.has(log._id)}
                      className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-red-500 transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-[12px] text-text-muted">
          <span>
            {f.number((result.page - 1) * result.limit + 1)}–
            {f.number(Math.min(result.page * result.limit, result.total))} of{' '}
            {f.number(result.total)} logs
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={result.page <= 1}
              onClick={() => onQueryChange({ ...query, page: result.page - 1 })}
              className="p-1 rounded hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 tabular-nums">
              {result.page} / {result.totalPages}
            </span>
            <button
              type="button"
              disabled={result.page >= result.totalPages}
              onClick={() => onQueryChange({ ...query, page: result.page + 1 })}
              className="p-1 rounded hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
