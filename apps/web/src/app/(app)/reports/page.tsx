'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReports, useReportMutations } from '@/hooks/use-reports';
import { ReportCard } from '@/components/feature/reports/report-card';
import { NewReportModal } from '@/components/feature/reports/new-report-modal';
import type { ReportTemplate } from '@/components/feature/reports/new-report-modal';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Calendar, ChevronLeft, ChevronRight, FileBarChart2, LayoutGrid, MonitorPlay, Plus } from 'lucide-react';

const ITEMS_PER_PAGE = 12;

export default function ReportsPage() {
  const router = useRouter();
  const { data: reports, isLoading } = useReports();
  const { create, remove, triggerRun } = useReportMutations();
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(0);

  const handleCreate = async (tmpl: ReportTemplate) => {
    const t = await create.mutateAsync({
      name: tmpl.id === 'blank' ? 'Untitled Report' : tmpl.label,
      description: tmpl.description,
      pageSize: tmpl.pageSize,
      orientation: tmpl.orientation,
      background: tmpl.background,
      elements: tmpl.elements,
      schedule: { enabled: false, frequency: 'monthly', hour: 8 },
      recipients: [],
      permissions: { allowDownload: true, allowedFormats: ['pdf'] },
    });
    setModalOpen(false);
    router.push(`/reports/${t._id}/edit`);
  };

  const scheduledCount = reports?.filter((r) => r.schedule.enabled).length ?? 0;
  const totalPages = Math.ceil((reports?.length ?? 0) / ITEMS_PER_PAGE);

  // Clamp page when items are removed
  useEffect(() => {
    if (totalPages > 0 && page >= totalPages) setPage(totalPages - 1);
  }, [totalPages, page]);
  const paginatedReports = reports?.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE) ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center flex-shrink-0">
            <FileBarChart2 className="w-5 h-5 text-accent-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Reports</h1>
            <p className="text-sm text-text-muted mt-0.5">
              Design, schedule, and distribute reports to your team
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* <Link
            href="/reports/display"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-bg-card text-sm text-text-sub hover:bg-bg-hover transition-colors"
          >
            <MonitorPlay className="w-4 h-4" />
            Display
          </Link> */}
          <Button onClick={() => setModalOpen(true)} variant="primary" className="gap-2" disabled={create.isPending}>
            <Plus className="w-4 h-4" />
            New Report
          </Button>
        </div>
      </div>

      {/* Stats row */}
      {!isLoading && !!reports?.length && (
        <div className="flex gap-3 mb-6">
          <div className="flex items-center gap-2 bg-bg-card border border-border rounded-lg px-4 py-2.5 text-sm">
            <LayoutGrid className="w-4 h-4 text-text-muted" />
            <span className="font-semibold">{reports.length}</span>
            <span className="text-text-muted">report{reports.length !== 1 ? 's' : ''}</span>
          </div>
          {scheduledCount > 0 && (
            <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2.5 text-sm">
              <Calendar className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-green-700 dark:text-green-400">{scheduledCount}</span>
              <span className="text-green-600 dark:text-green-500">scheduled</span>
            </div>
          )}
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden border border-border">
              <div className="h-36 bg-bg-subtle animate-pulse" />
              <div className="p-3.5 space-y-2.5">
                <div className="h-4 w-3/4 bg-bg-subtle rounded animate-pulse" />
                <div className="h-3 w-full bg-bg-subtle rounded animate-pulse" />
                <div className="h-3 w-5/6 bg-bg-subtle rounded animate-pulse" />
                <div className="h-8 w-full bg-bg-subtle rounded animate-pulse mt-3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !reports?.length && (
        <div className="text-center py-24 rounded-2xl border border-dashed border-border bg-bg-subtle/50">
          <div className="w-16 h-16 rounded-2xl bg-bg-card border border-border flex items-center justify-center mx-auto mb-4 shadow-sm">
            <FileBarChart2 className="w-7 h-7 text-text-muted opacity-50" />
          </div>
          <p className="text-base font-semibold mb-1">No reports yet</p>
          <p className="text-sm text-text-muted mb-6 max-w-xs mx-auto">
            Create your first report template to design, schedule, and share insights with your team.
          </p>
          <Button onClick={() => setModalOpen(true)} variant="primary" className="gap-2">
            <Plus className="w-4 h-4" /> Create Report
          </Button>
        </div>
      )}

      {/* Cards grid */}
      {!isLoading && !!reports?.length && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {paginatedReports.map((t) => (
              <ReportCard
                key={t._id}
                template={t}
                onRun={() => triggerRun.mutate(t._id)}
                onDelete={() => remove.mutate(t._id)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-border bg-bg-card text-text-sub hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    i === page
                      ? 'bg-accent-600 text-white'
                      : 'border border-border bg-bg-card text-text-sub hover:bg-bg-hover'
                  }`}
                >
                  {i + 1}
                </button>
              ))}

              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-border bg-bg-card text-text-sub hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Template picker modal */}
      <NewReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
