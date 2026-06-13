'use client';
import { useState } from 'react';
import { CalendarClock, Download, HardDrive, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { BACKUP_SCOPE_LABELS, type BackupFile, type BackupScope } from '@/schemas/backup';
import { useBackupFiles, useBackupMutations, downloadStoredBackup } from '@/hooks/use-backup';
import { useAuthStore } from '@/stores/auth-store';

function fmtBytes(n: number): string {
  if (n < 1024)        return `${n} B`;
  if (n < 1024 ** 2)   return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3)   return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function BackupHistoryCard() {
  const { data: files, isLoading } = useBackupFiles();
  const { deleteFile } = useBackupMutations();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (f: BackupFile) => {
    setDownloadingId(f._id);
    try {
      await downloadStoredBackup(f._id, f.fileName);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <Confirm
        open={!!deletingId}
        title="Delete backup?"
        body="This backup file will be permanently removed from the server."
        danger
        onConfirm={() => { if (deletingId) deleteFile.mutate(deletingId); setDeletingId(null); }}
        onClose={() => setDeletingId(null)}
      />

      <section className="bg-bg-card border border-border rounded-lg p-6 flex flex-col gap-4">
        <header>
          <h3 className="text-[15px] font-semibold flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-text-muted" />
            Stored Backups
          </h3>
          <p className="text-[13px] text-text-muted mt-0.5">
            Auto-generated backups stored on the server. Kept for 30 days, max 10 files.
          </p>
        </header>

        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-md bg-bg-hover" />
            ))}
          </div>
        ) : !files?.length ? (
          <p className="text-[13px] text-text-muted italic py-4 text-center">
            No backup files stored yet. Enable auto-backup or export a backup above.
          </p>
        ) : (
          <div className="overflow-hidden border border-border rounded-md">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center bg-bg-subtle px-4 py-2 text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted gap-3">
              <span>File</span>
              <span>Size</span>
              <span>Source</span>
              <span>Created</span>
              <span className="sr-only">Actions</span>
            </div>

            {files.map((f) => (
              <div
                key={f._id}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-3 border-t border-border gap-3"
              >
                {/* File name + scopes */}
                <div className="min-w-0">
                  <p className="text-[13px] font-medium truncate">{f.fileName}</p>
                  <p className="text-[11px] text-text-muted mt-0.5 truncate">
                    {f.scopes
                      .map((s) => BACKUP_SCOPE_LABELS[s as BackupScope] ?? s)
                      .join(', ')}
                  </p>
                </div>

                {/* Size */}
                <span className="text-[12px] text-text-muted whitespace-nowrap">
                  {fmtBytes(f.size)}
                </span>

                {/* Trigger badge */}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap',
                    f.triggeredBy === 'schedule'
                      ? 'bg-accent/10 text-accent'
                      : 'bg-bg-hover text-text-muted',
                  )}
                >
                  {f.triggeredBy === 'schedule' ? (
                    <><CalendarClock className="w-3 h-3" /> Auto</>
                  ) : (
                    <><UserRound className="w-3 h-3" /> Manual</>
                  )}
                </span>

                {/* Date */}
                <span className="text-[11.5px] text-text-muted whitespace-nowrap">
                  {fmtDate(f.createdAt)}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDownload(f)}
                    disabled={downloadingId === f._id || f.status !== 'ready'}
                    title="Download"
                    className="p-1.5 rounded-sm border border-border text-text-muted hover:text-accent hover:border-accent transition-colors disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingId(f._id)}
                    title="Delete"
                    className="p-1.5 rounded-sm border border-border text-text-muted hover:text-red-500 hover:border-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
