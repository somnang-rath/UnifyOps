'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type {
  BackupFile,
  BackupScheduleSettings,
  ExportOptions,
  ImportOptions,
  ImportResult,
} from '@/schemas/backup';

// ── API service ───────────────────────────────────────────────────────────────

const svc = {
  list: () =>
    api.get<BackupFile[]>('/backups').then((r) => r.data),

  getSchedule: () =>
    api.get<BackupScheduleSettings | null>('/backups/schedule').then((r) => r.data),

  export: (opts: ExportOptions) =>
    api.post<Blob>('/backups/export', opts, { responseType: 'blob' }).then((r) => r.data),

  import: (file: File, opts: ImportOptions) => {
    const fd = new FormData();
    fd.append('file',     file);
    fd.append('strategy', opts.strategy);
    if (opts.password) fd.append('password', opts.password);
    if (opts.scopes)   fd.append('scopes',   JSON.stringify(opts.scopes));
    return api.post<ImportResult>('/backups/import', fd).then((r) => r.data);
  },

  upsertSchedule: (s: Partial<BackupScheduleSettings>) =>
    api.put<BackupScheduleSettings>('/backups/schedule', s).then((r) => r.data),

  deleteSchedule: () =>
    api.delete('/backups/schedule').then((r) => r.data),

  deleteFile: (id: string) =>
    api.delete(`/backups/${id}`).then((r) => r.data),

  downloadUrl: (id: string) => `/backups/${id}/download`,
};

// ── Queries ───────────────────────────────────────────────────────────────────

export const useBackupFiles = () =>
  useQuery({ queryKey: ['backups'], queryFn: svc.list });

export const useBackupSchedule = () =>
  useQuery({ queryKey: ['backups', 'schedule'], queryFn: svc.getSchedule });

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useBackupMutations() {
  const qc = useQueryClient();

  const exportBackup = useMutation({
    mutationFn: async (opts: ExportOptions & { onProgress?: (pct: number) => void }) => {
      const blob = await api
        .post<Blob>('/backups/export', opts, {
          responseType: 'blob',
          onDownloadProgress: (e) => {
            if (opts.onProgress && e.total) {
              opts.onProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        })
        .then((r) => r.data);
      return blob;
    },
    onSuccess: (blob, opts) => {
      const dateStr  = new Date().toISOString().slice(0, 10);
      const safeName = opts.fileName.replace(/[^a-zA-Z0-9 _\-]/g, '').trim() || 'Backup UnifyOps';
      const fileName = `${safeName} ${dateStr}.prismback`;
      triggerDownload(blob, fileName);
      toast('Backup downloaded successfully', 'success');
    },
    onError: () => toast('Export failed — please try again', 'error'),
  });

  const importBackup = useMutation({
    mutationFn: ({ file, opts }: { file: File; opts: ImportOptions }) =>
      svc.import(file, opts),
    onSuccess: (result) => {
      // Invalidate all cached data that may have changed after import
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: ['wiki'] });
      qc.invalidateQueries({ queryKey: ['workbooks'] });
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['mrs'] });

      const totalInserted = Object.values(result.inserted).reduce((s, n) => s + (n ?? 0), 0);
      const totalSkipped  = Object.values(result.skipped).reduce((s, n) => s + (n ?? 0), 0);
      toast(
        `Import complete — ${totalInserted} items restored, ${totalSkipped} skipped (already existed)`,
        'success',
      );
    },
    onError: (err: Error) =>
      toast(err?.message ?? 'Import failed — check the file and try again', 'error'),
  });

  const upsertSchedule = useMutation({
    mutationFn: svc.upsertSchedule,
    onSuccess: (data) => {
      qc.setQueryData(['backups', 'schedule'], data);
      toast('Backup schedule saved', 'success');
    },
    onError: () => toast('Failed to save schedule', 'error'),
  });

  const deleteSchedule = useMutation({
    mutationFn: svc.deleteSchedule,
    onSuccess: () => {
      qc.setQueryData(['backups', 'schedule'], null);
      toast('Schedule removed', 'success');
    },
    onError: () => toast('Failed to remove schedule', 'error'),
  });

  const deleteFile = useMutation({
    mutationFn: svc.deleteFile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast('Backup deleted', 'success');
    },
    onError: () => toast('Failed to delete backup', 'error'),
  });

  return { exportBackup, importBackup, upsertSchedule, deleteSchedule, deleteFile };
}

// ── Download a stored backup file from the server ────────────────────────────

export async function downloadStoredBackup(
  id: string,
  fileName: string,
): Promise<void> {
  const resp = await api.get<Blob>(`/backups/${id}/download`, { responseType: 'blob' });
  triggerDownload(resp.data, fileName);
}

// ── Helper: trigger a browser download from a Blob ───────────────────────────

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
