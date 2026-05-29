'use client';
import { useState } from 'react';
import type { ReportDeliveryLogEntry, ReportRun } from '@/schemas/report';
import { useRunDeliveries } from '@/hooks/use-reports';
import {
  Ban, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, Download, ExternalLink, Loader2,
  MousePointer, X, XCircle, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ── status config ───────────────────────────────────────────── */
const STATUS_CONFIG = {
  done:       { icon: CheckCircle2, label: 'Done',      cls: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400' },
  error:      { icon: XCircle,      label: 'Error',     cls: 'text-red-500 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800' },
  pending:    { icon: Clock,        label: 'Pending',   cls: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400' },
  generating: { icon: Loader2,      label: 'Sending…',  cls: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400' },
} as const;

const DELIVERY_STATUS_CFG = {
  success: { icon: CheckCircle2, label: 'Sent',    cls: 'text-green-600 dark:text-green-400' },
  failed:  { icon: XCircle,      label: 'Failed',  cls: 'text-red-500 dark:text-red-400' },
  blocked: { icon: Ban,          label: 'Blocked', cls: 'text-amber-600 dark:text-amber-400' },
} as const;

/* ── helpers ─────────────────────────────────────────────────── */
function relTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ── DeliveryCountsCell ──────────────────────────────────────── */
function DeliveryCountsCell({ run }: { run: ReportRun }) {
  const total   = run.totalRecipients ?? 0;
  const success = run.successCount    ?? 0;
  const failed  = run.failedCount     ?? 0;
  const blocked = run.blockedCount    ?? 0;

  if (total === 0 && run.status === 'generating') {
    return <span className="text-text-muted text-xs">queued…</span>;
  }
  if (total === 0) {
    return <span className="text-text-muted text-xs">—</span>;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {success > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-full px-2 py-0.5">
          <CheckCircle2 className="w-2.5 h-2.5" />{success}
        </span>
      )}
      {failed > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-full px-2 py-0.5">
          <XCircle className="w-2.5 h-2.5" />{failed}
        </span>
      )}
      {blocked > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-full px-2 py-0.5">
          <Ban className="w-2.5 h-2.5" />{blocked}
        </span>
      )}
      {run.status === 'generating' && total > 0 && (
        <div className="w-20 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
          <div
            className="h-full bg-accent-600 transition-all duration-500"
            style={{ width: `${Math.round(((success + failed + blocked) / total) * 100)}%` }}
          />
        </div>
      )}
      <span className="text-text-muted text-[10px]">/ {total}</span>
    </div>
  );
}

/* ── Delivery log drawer ─────────────────────────────────────── */
const PAGE_SIZE = 50;

function DeliveryRow({ entry }: { entry: ReportDeliveryLogEntry }) {
  const cfg = DELIVERY_STATUS_CFG[entry.status] ?? DELIVERY_STATUS_CFG.failed;
  const Icon = cfg.icon;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
      <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cfg.cls)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-text truncate">{entry.email}</span>
          <span className={cn('text-[10px] font-semibold', cfg.cls)}>{cfg.label}</span>
          {entry.filteredRows != null && entry.filteredRows > 0 && (
            <span className="text-[10px] text-text-muted">{entry.filteredRows} rows</span>
          )}
        </div>
        {entry.error && (
          <p className="text-[10px] text-red-500 mt-0.5 break-words">{entry.error}</p>
        )}
        <p className="text-[10px] text-text-muted mt-0.5">{fmtDate(entry.sentAt)}</p>
      </div>
    </div>
  );
}

function DeliveryDrawer({
  run,
  templateId,
  onClose,
}: {
  run: ReportRun;
  templateId: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const { data, isLoading } = useRunDeliveries(templateId, run._id, page, PAGE_SIZE);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const cfg  = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* dim overlay */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade-in" />

      {/* panel */}
      <div className="relative w-full max-w-md bg-bg-card border-l border-border h-full flex flex-col shadow-2xl animate-slide-up">

        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border', cfg.cls)}>
                <Icon className={cn('w-3 h-3', run.status === 'generating' && 'animate-spin')} />
                {cfg.label}
              </span>
              <span className="text-[11px] text-text-muted">
                {run.triggeredBy === 'schedule' ? '⚡ Scheduled' : '👆 Manual'}
              </span>
            </div>
            <p className="text-xs text-text-muted">{fmtDate(run.createdAt)} · {relTime(run.createdAt)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* counters */}
        <div className="flex gap-0 border-b border-border flex-shrink-0">
          {[
            { label: 'Sent',    value: run.successCount ?? 0, cls: 'text-green-600 dark:text-green-400' },
            { label: 'Failed',  value: run.failedCount  ?? 0, cls: 'text-red-500 dark:text-red-400' },
            { label: 'Blocked', value: run.blockedCount ?? 0, cls: 'text-amber-600 dark:text-amber-400' },
            { label: 'Total',   value: run.totalRecipients ?? 0, cls: 'text-text-sub' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex-1 px-4 py-3 text-center border-r border-border last:border-0">
              <div className={cn('text-lg font-bold', cls)}>{value}</div>
              <div className="text-[10px] text-text-muted">{label}</div>
            </div>
          ))}
        </div>

        {/* run-level error */}
        {run.error && (
          <div className="mx-5 mt-3 flex-shrink-0 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">Run error</p>
            <p className="text-xs text-red-500 mt-0.5 break-words">{run.error}</p>
          </div>
        )}

        {/* delivery log list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="text-center py-12">
              <ExternalLink className="w-8 h-8 mx-auto mb-2 text-text-muted opacity-30" />
              <p className="text-sm text-text-muted">No delivery records yet.</p>
              {run.status === 'generating' && (
                <p className="text-xs text-text-muted mt-1">Deliveries appear here as they complete.</p>
              )}
            </div>
          ) : (
            <div>
              {data.items.map((entry) => (
                <DeliveryRow key={entry._id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border flex-shrink-0">
            <Button
              variant="ghost" size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </Button>
            <span className="text-xs text-text-muted">
              Page {page + 1} of {totalPages} · {data?.total ?? 0} total
            </span>
            <Button
              variant="ghost" size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="gap-1"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main table ──────────────────────────────────────────────── */
interface Props {
  runs: ReportRun[];
  templateId: string;
}

export function RunHistoryTable({ runs, templateId }: Props) {
  const [selectedRun, setSelectedRun] = useState<ReportRun | null>(null);

  if (!runs.length) {
    return (
      <div className="text-center py-16 rounded-xl border border-dashed border-border bg-bg-subtle/50">
        <Clock className="w-10 h-10 mx-auto mb-3 text-text-muted opacity-30" />
        <p className="text-sm font-medium text-text-sub mb-1">No runs yet</p>
        <p className="text-xs text-text-muted">Click "Send Now" to deliver the first report.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-subtle border-b border-border">
              {['Status', 'Trigger', 'Date', 'Deliveries', 'Error', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((run) => {
              const cfg  = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
              const Icon = cfg.icon;
              const isClickable = run.status === 'done' || run.status === 'error' ||
                                  (run.status === 'generating' && (run.totalRecipients ?? 0) > 0);
              return (
                <tr
                  key={run._id}
                  onClick={() => isClickable && setSelectedRun(run)}
                  className={cn(
                    'transition-colors',
                    isClickable ? 'cursor-pointer hover:bg-bg-hover' : 'hover:bg-bg-hover/50',
                  )}
                  title={isClickable ? 'Click to view per-recipient details' : undefined}
                >
                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border', cfg.cls)}>
                      <Icon className={cn('w-3 h-3', run.status === 'generating' && 'animate-spin')} />
                      {cfg.label}
                    </span>
                  </td>

                  {/* Trigger */}
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium',
                      run.triggeredBy === 'schedule'
                        ? 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400'
                        : 'bg-bg-subtle text-text-sub',
                    )}>
                      {run.triggeredBy === 'schedule'
                        ? <Zap className="w-2.5 h-2.5" />
                        : <MousePointer className="w-2.5 h-2.5" />}
                      {run.triggeredBy === 'schedule' ? 'Scheduled' : 'Manual'}
                    </span>
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3">
                    <div className="text-text-sub text-xs">{fmtDate(run.createdAt)}</div>
                    <div className="text-text-muted text-[11px] mt-0.5">{relTime(run.createdAt)}</div>
                  </td>

                  {/* Delivery counters */}
                  <td className="px-4 py-3">
                    <DeliveryCountsCell run={run} />
                  </td>

                  {/* Error */}
                  <td className="px-4 py-3 max-w-[180px]">
                    {run.error ? (
                      <span className="text-red-500 text-xs truncate block" title={run.error}>
                        {run.error}
                      </span>
                    ) : (
                      <span className="text-text-muted text-xs">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {run.status === 'done' && run.fileId && (
                        <Button
                          variant="ghost" size="xs"
                          title="Download report PDF"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {isClickable && (
                        <Button
                          variant="ghost" size="xs"
                          title="View delivery details"
                          onClick={(e) => { e.stopPropagation(); setSelectedRun(run); }}
                          className="text-text-muted hover:text-accent-600"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Delivery detail drawer */}
      {selectedRun && (
        <DeliveryDrawer
          run={selectedRun}
          templateId={templateId}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </>
  );
}
