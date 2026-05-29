'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useReport,
  useReportRunsLive,
  useReportMutations,
  reportsApi,
} from '@/hooks/use-reports';
import { RunHistoryTable } from '@/components/feature/reports/run-history-table';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Calendar, CheckCircle2, Download, Edit2,
  Loader2, Play, Send, XCircle, Zap,
} from 'lucide-react';

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};

export default function ReportHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const { data: template, isLoading: loadingTemplate } = useReport(id);
  /* Live-polling: auto-refetch every 4 s while any run is 'generating' */
  const { data: runs, isLoading: loadingRuns } = useReportRunsLive(id);
  const { triggerRun, sendToRecipients } = useReportMutations();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!template) return;
    setDownloading(true);
    try {
      await reportsApi.downloadPdf(id, template.name);
    } finally {
      setDownloading(false);
    }
  };

  const isLoading     = loadingTemplate || loadingRuns;
  const totalRuns     = runs?.length ?? 0;
  const successRuns   = runs?.filter((r) => r.status === 'done').length ?? 0;
  const errorRuns     = runs?.filter((r) => r.status === 'error').length ?? 0;
  const successRate   = totalRuns ? Math.round((successRuns / totalRuns) * 100) : null;
  const hasSending    = runs?.some((r) => r.status === 'generating') ?? false;

  const autoMode =
    template?.dataRecipientsConfig?.enabled &&
    !!template?.dataRecipientsConfig?.emailField;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 mb-6 text-sm text-text-muted">
        <Link href="/reports" className="hover:text-text transition-colors flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" />
          Reports
        </Link>
        <span className="opacity-40">/</span>
        <span className="text-text truncate max-w-[180px]">
          {loadingTemplate ? '...' : template?.name}
        </span>
        <span className="opacity-40">/</span>
        <span className="text-text-sub">History</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          {loadingTemplate ? (
            <div className="h-6 w-52 bg-bg-subtle rounded animate-pulse mb-1.5" />
          ) : (
            <h1 className="text-xl font-semibold mb-1 truncate">{template?.name}</h1>
          )}
          <div className="flex items-center gap-4 text-sm text-text-muted flex-wrap">
            {/* Auto-recipients badge */}
            {autoMode && (
              <span className="flex items-center gap-1 text-accent-600 dark:text-accent-400 font-medium">
                <Zap className="w-3.5 h-3.5" />
                Auto-recipients from API
              </span>
            )}
            {template?.schedule.enabled && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <Calendar className="w-3.5 h-3.5" />
                Runs {FREQ_LABELS[template.schedule.frequency] ?? template.schedule.frequency}
              </span>
            )}
            {/* Live indicator */}
            {hasSending && (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Sending in progress…
              </span>
            )}
            <Link
              href={`/reports/${id}/edit`}
              className="flex items-center gap-1 hover:text-accent-600 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit template
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={downloading || loadingTemplate}
            className="gap-1.5"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            PDF
          </Button>

          {/* Generate PDF only */}
          <Button
            variant="outline"
            onClick={() => triggerRun.mutate(id)}
            disabled={triggerRun.isPending}
            className="gap-1.5"
            title="Generate PDF only (no email)"
          >
            {triggerRun.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Generate
          </Button>

          {/* Send emails to all recipients */}
          <Button
            variant="primary"
            onClick={() => sendToRecipients.mutate(id)}
            disabled={sendToRecipients.isPending}
            className="gap-1.5"
            title={autoMode ? 'Send to all recipients from API data' : 'Send to all manual recipients'}
          >
            {sendToRecipients.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : autoMode
                ? <Zap className="w-4 h-4" />
                : <Send className="w-4 h-4" />}
            {autoMode ? 'Send (auto)' : 'Send Now'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {!isLoading && totalRuns > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="text-2xl font-bold">{totalRuns}</div>
            <div className="text-xs text-text-muted mt-0.5">Total Runs</div>
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-5 h-5" />
              {successRuns}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              Successful
              {successRate != null && (
                <span className="ml-1 text-green-600 dark:text-green-400">({successRate}%)</span>
              )}
            </div>
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className={`text-2xl font-bold flex items-center gap-1.5 ${errorRuns > 0 ? 'text-red-500' : 'text-text-muted'}`}>
              <XCircle className="w-5 h-5" />
              {errorRuns}
            </div>
            <div className="text-xs text-text-muted mt-0.5">Errors</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      ) : (
        <RunHistoryTable runs={runs ?? []} templateId={id} />
      )}
    </div>
  );
}
