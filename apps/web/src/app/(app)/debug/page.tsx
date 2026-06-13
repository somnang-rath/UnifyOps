'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, RefreshCw, Settings } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import {
  useErrorLogs,
  useErrorLogStats,
  useErrorLogMutations,
} from '@/hooks/use-error-logs';
import { ErrorStats } from '@/components/feature/debug/error-stats';
import { ErrorFilters } from '@/components/feature/debug/error-filters';
import { ErrorTable } from '@/components/feature/debug/error-table';
import { BulkActionsBar } from '@/components/feature/debug/bulk-actions-bar';
import { RetentionSettings } from '@/components/feature/debug/retention-settings';
import { useQueryClient } from '@tanstack/react-query';
import type { ErrorLogQuery } from '@/schemas/error-log';

const SUPER_ADMIN_EMAILS = new Set(['somnang.rath12@gmail.com', 'admin@demo.com']);

export default function DebugPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  if (user && !SUPER_ADMIN_EMAILS.has(user.email)) {
    router.replace('/home');
    return null;
  }

  return <DebugPageInner />;
}

function DebugPageInner() {
  const qc = useQueryClient();

  const [query, setQuery] = useState<ErrorLogQuery>({ page: 1, limit: 20 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const { data: listResult, isLoading } = useErrorLogs(query);
  const { data: stats } = useErrorLogStats();
  const mutations = useErrorLogMutations();

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(
    (all: boolean) => {
      if (!listResult) return;
      setSelected(all ? new Set(listResult.items.map((i) => i._id)) : new Set());
    },
    [listResult],
  );

  const handleResolve = async (id: string) => {
    setResolving((s) => new Set(s).add(id));
    await mutations.resolve.mutateAsync(id).catch(() => null);
    setResolving((s) => { const n = new Set(s); n.delete(id); return n; });
  };

  const handleDelete = async (id: string) => {
    setDeleting((s) => new Set(s).add(id));
    await mutations.remove.mutateAsync(id).catch(() => null);
    setDeleting((s) => { const n = new Set(s); n.delete(id); return n; });
  };

  const handleBulkResolve = async () => {
    await mutations.bulkResolve.mutateAsync(Array.from(selected)).catch(() => null);
    setSelected(new Set());
  };

  const handleBulkDelete = async () => {
    await mutations.bulkDelete.mutateAsync(Array.from(selected)).catch(() => null);
    setSelected(new Set());
  };

  const exportLogs = (format: 'csv' | 'json') => {
    const params = new URLSearchParams();
    params.set('format', format);
    if (query.source) params.set('source', query.source);
    if (query.logType) params.set('logType', query.logType);
    if (query.resolved) params.set('resolved', query.resolved);
    if (query.search) params.set('search', query.search);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    window.open(`/api/v1/error-logs/export?${params.toString()}`, '_blank');
  };

  return (
    <div className="max-w-screen-2xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Error & Debug Logs</h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            Monitor and manage application errors from frontend and backend.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['error-logs'] });
              qc.invalidateQueries({ queryKey: ['error-logs-stats'] });
            }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border text-[12px] text-text-sub hover:bg-bg-hover transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border text-[12px] text-text-sub hover:bg-bg-hover transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <div className="absolute right-0 top-full mt-1 w-32 rounded-sm border border-border bg-bg-card shadow-lg z-10 hidden group-hover:block">
              <button
                type="button"
                onClick={() => exportLogs('csv')}
                className="w-full text-left px-3 py-2 text-[12px] text-text-sub hover:bg-bg-hover transition-colors"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => exportLogs('json')}
                className="w-full text-left px-3 py-2 text-[12px] text-text-sub hover:bg-bg-hover transition-colors"
              >
                Export JSON
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border text-[12px] text-text-sub hover:bg-bg-hover transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && <ErrorStats stats={stats} />}

      {/* Retention settings panel */}
      {showSettings && <RetentionSettings />}

      {/* Filters */}
      <ErrorFilters filters={query} onChange={setQuery} />

      {/* Bulk actions */}
      <BulkActionsBar
        count={selected.size}
        onResolve={handleBulkResolve}
        onDelete={handleBulkDelete}
        onClear={() => setSelected(new Set())}
        resolving={mutations.bulkResolve.isPending}
        deleting={mutations.bulkDelete.isPending}
      />

      {/* Table */}
      {isLoading && !listResult && (
        <div className="flex items-center justify-center py-16 text-text-muted text-[13px]">
          Loading logs…
        </div>
      )}
      {listResult && (
        <ErrorTable
          result={listResult}
          selected={selected}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
          onResolve={handleResolve}
          onDelete={handleDelete}
          query={query}
          onQueryChange={setQuery}
          resolving={resolving}
          deleting={deleting}
        />
      )}
    </div>
  );
}
