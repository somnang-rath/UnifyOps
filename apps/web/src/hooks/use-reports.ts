'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type {
  ReportTemplate,
  ReportRun,
  DeliveryPage,
  ReportBlocklistEntry,
} from '@/schemas/report';

// ── API service layer ─────────────────────────────────────────────────────────

const reportsService = {
  list: () => api.get<ReportTemplate[]>('/reports').then((r) => r.data),

  byId: (id: string) => api.get<ReportTemplate>(`/reports/${id}`).then((r) => r.data),

  create: (body: Partial<ReportTemplate>) =>
    api.post<ReportTemplate>('/reports', body).then((r) => r.data),

  update: (id: string, body: Partial<ReportTemplate>) =>
    api.patch<ReportTemplate>(`/reports/${id}`, body).then((r) => r.data),

  remove: (id: string) => api.delete(`/reports/${id}`).then((r) => r.data),

  /** Generate PDF only (no email). */
  triggerRun: (id: string) =>
    api.post<ReportRun>(`/reports/${id}/run`).then((r) => r.data),

  /**
   * Fire async send to all non-blocked recipients.
   * Returns the ReportRun immediately (status='generating').
   * Poll listRuns to watch successCount / failedCount update live.
   */
  sendToRecipients: (id: string) =>
    api.post<ReportRun>(`/reports/${id}/send`).then((r) => r.data),

  /** Legacy test-send. */
  sendTestEmail: (id: string) =>
    api.post<{ sent: number; queued: boolean }>(`/reports/${id}/send-test`).then((r) => r.data),

  listRuns: (id: string) =>
    api.get<ReportRun[]>(`/reports/${id}/runs`).then((r) => r.data),

  /**
   * Paginated delivery log for one run.
   * Uses a separate collection — safe for 10,000+ recipients.
   */
  listDeliveries: (templateId: string, runId: string, page = 0, limit = 50) =>
    api
      .get<DeliveryPage>(`/reports/${templateId}/runs/${runId}/deliveries`, {
        params: { page, limit },
      })
      .then((r) => r.data),

  // ── Blocklist ──────────────────────────────────────────────────────────────

  addBlocklistEntry: (
    templateId: string,
    body: { email?: string; userId?: string; reason?: string },
  ) =>
    api.post<ReportBlocklistEntry>(`/reports/${templateId}/blocklist`, body).then((r) => r.data),

  removeBlocklistEntry: (templateId: string, entryId: string) =>
    api.delete(`/reports/${templateId}/blocklist/${entryId}`).then((r) => r.data),

  // ── PDF ────────────────────────────────────────────────────────────────────

  /** Build a preview URL with optional per-recipient filter. */
  previewUrl(id: string, filterField?: string, filterValue?: string): string {
    const base = `/reports/${id}/preview`;
    if (filterField && filterValue) {
      return `${base}?filterField=${encodeURIComponent(filterField)}&filterValue=${encodeURIComponent(filterValue)}`;
    }
    return base;
  },

  async downloadPdf(id: string, name: string): Promise<void> {
    const res = await api.get(`/reports/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9\-_ ]/gi, '_')}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

export const reportsApi = reportsService;

// ── Queries ───────────────────────────────────────────────────────────────────

export const useReportWidgetData = () =>
  useQuery({
    queryKey: ['reports', 'widget-data'],
    queryFn: () => api.get<Record<string, unknown>>('/reports/widget-data').then((r) => r.data),
    staleTime: 60_000,
  });

export const useReports = () =>
  useQuery({ queryKey: ['reports'], queryFn: reportsService.list });

export const useReport = (id: string | null) =>
  useQuery({
    queryKey: ['reports', 'byId', id],
    queryFn: () => reportsService.byId(id!),
    enabled: !!id,
  });

export const useReportRuns = (templateId: string | null) =>
  useQuery({
    queryKey: ['reports', 'runs', templateId],
    queryFn: () => reportsService.listRuns(templateId!),
    enabled: !!templateId,
  });

/**
 * Live-polling version — refetches every 4 s while any run is still 'generating'.
 * Stop polling by passing `enabled: false` or when all runs are settled.
 */
export const useReportRunsLive = (templateId: string | null) =>
  useQuery({
    queryKey: ['reports', 'runs', templateId],
    queryFn: () => reportsService.listRuns(templateId!),
    enabled: !!templateId,
    refetchInterval: (query) => {
      const runs = query.state.data as ReportRun[] | undefined;
      return runs?.some((r) => r.status === 'generating') ? 4_000 : false;
    },
  });

export const useRunDeliveries = (
  templateId: string | null,
  runId: string | null,
  page = 0,
  limit = 50,
) =>
  useQuery({
    queryKey: ['reports', 'deliveries', templateId, runId, page, limit],
    queryFn: () => reportsService.listDeliveries(templateId!, runId!, page, limit),
    enabled: !!templateId && !!runId,
  });

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useReportMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ['reports'], exact: true });

  return {
    create: useMutation({
      mutationFn: reportsService.create,
      onSuccess: () => { inv(); toast('Report template created'); },
    }),

    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<ReportTemplate> }) =>
        reportsService.update(id, body),
      onSuccess: (updated) => {
        qc.setQueryData(['reports', 'byId', updated._id], updated);
        inv();
      },
    }),

    remove: useMutation({
      mutationFn: reportsService.remove,
      onSuccess: () => { inv(); toast('Report template deleted'); },
    }),

    triggerRun: useMutation({
      mutationFn: reportsService.triggerRun,
      onSuccess: (run) => {
        qc.invalidateQueries({ queryKey: ['reports', 'runs', run.templateId] });
        toast('Report generated successfully');
      },
      onError: () => toast('Report generation failed', 'error'),
    }),

    /**
     * Async send — returns immediately with a 'generating' run.
     * Use useReportRunsLive() to watch progress counters update.
     */
    sendToRecipients: useMutation({
      mutationFn: reportsService.sendToRecipients,
      onSuccess: (run) => {
        qc.invalidateQueries({ queryKey: ['reports', 'runs', run.templateId] });
        toast(`Sending started — ${run.totalRecipients} recipient(s) queued`);
      },
      onError: () => toast('Failed to start send', 'error'),
    }),

    sendTest: useMutation({
      mutationFn: reportsService.sendTestEmail,
      onSuccess: (_, templateId) => {
        qc.invalidateQueries({ queryKey: ['reports', 'runs', templateId] });
        toast('Test send queued');
      },
      onError: () => toast('Failed to queue test email', 'error'),
    }),
  };
}

// ── Blocklist mutations ───────────────────────────────────────────────────────

export function useBlocklistMutations(templateId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['reports', 'byId', templateId] });

  return {
    add: useMutation({
      mutationFn: (body: { email?: string; userId?: string; reason?: string }) =>
        reportsService.addBlocklistEntry(templateId, body),
      onSuccess: (entry) => {
        qc.setQueryData<ReportTemplate>(['reports', 'byId', templateId], (old) =>
          old ? { ...old, blocklist: [...(old.blocklist ?? []), entry] } : old,
        );
        refresh();
        toast('Added to blocklist');
      },
      onError: () => toast('Failed to add to blocklist', 'error'),
    }),

    remove: useMutation({
      mutationFn: (entryId: string) =>
        reportsService.removeBlocklistEntry(templateId, entryId),
      onSuccess: (_d, entryId) => {
        qc.setQueryData<ReportTemplate>(['reports', 'byId', templateId], (old) =>
          old
            ? { ...old, blocklist: (old.blocklist ?? []).filter((e) => e.id !== entryId) }
            : old,
        );
        refresh();
        toast('Removed from blocklist');
      },
      onError: () => toast('Failed to remove from blocklist', 'error'),
    }),
  };
}
