'use client';
import { useState } from 'react';
import { Download, Eye, EyeOff, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ALL_BACKUP_SCOPES, BACKUP_SCOPE_LABELS, type BackupScope } from '@/schemas/backup';
import { useBackupMutations } from '@/hooks/use-backup';

export function BackupExportCard() {
  const { exportBackup } = useBackupMutations();

  const [scopes, setScopes]       = useState<BackupScope[]>([...ALL_BACKUP_SCOPES]);
  const [fileName, setFileName]   = useState('Backup UnifyOps');
  const [usePassword, setUsePass] = useState(false);
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [progress, setProgress]   = useState<number | null>(null);

  const allChecked  = scopes.length === ALL_BACKUP_SCOPES.length;
  const noneChecked = scopes.length === 0;

  const toggleScope = (scope: BackupScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const handleExport = () => {
    if (noneChecked) return;
    setProgress(0);
    exportBackup.mutate(
      {
        scopes,
        fileName: fileName.trim() || 'Backup UnifyOps',
        password: usePassword && password ? password : null,
        onProgress: setProgress,
      },
      { onSettled: () => setProgress(null) },
    );
  };

  return (
    <section className="bg-bg-card border border-border rounded-lg p-6 flex flex-col gap-5">
      <header>
        <h3 className="text-[15px] font-semibold">Export Backup</h3>
        <p className="text-[13px] text-text-muted mt-0.5">
          Download all your data as a <code className="font-mono">.prismback</code> file.
        </p>
      </header>

      {/* Scope picker */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-text-muted">
            Include data
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScopes([...ALL_BACKUP_SCOPES])}
              className="text-[11px] text-accent hover:underline"
            >
              Select all
            </button>
            <span className="text-text-muted text-[11px]">·</span>
            <button
              type="button"
              onClick={() => setScopes([])}
              className="text-[11px] text-text-muted hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ALL_BACKUP_SCOPES.map((scope) => {
            const checked = scopes.includes(scope);
            return (
              <label
                key={scope}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer select-none transition-colors',
                  checked
                    ? 'border-accent bg-accent-50 dark:bg-[rgba(99,102,241,.1)]'
                    : 'border-border hover:border-accent/50',
                )}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--a)] w-3.5 h-3.5 flex-shrink-0"
                  checked={checked}
                  onChange={() => toggleScope(scope)}
                />
                <span className="text-[12.5px] font-medium truncate">
                  {BACKUP_SCOPE_LABELS[scope]}
                </span>
              </label>
            );
          })}
        </div>
        {noneChecked && (
          <p className="text-[12px] text-red-500">Select at least one data type to export.</p>
        )}
      </div>

      {/* File name */}
      <Field label="File name" hint=".prismback will be appended">
        <Input
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="Backup UnifyOps"
          maxLength={120}
          className="max-w-[320px]"
        />
      </Field>

      {/* Password protection */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            className="accent-[var(--a)] w-3.5 h-3.5"
            checked={usePassword}
            onChange={(e) => {
              setUsePass(e.target.checked);
              if (!e.target.checked) setPassword('');
            }}
          />
          <Lock className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-[13px] font-medium">Protect with password</span>
        </label>
        {usePassword && (
          <div className="relative max-w-[320px]">
            <Input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter backup password"
              className="pr-9"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
        {usePassword && (
          <p className="text-[11.5px] text-text-muted">
            You will need this password to import the backup. It is never stored on the server.
          </p>
        )}
      </div>

      {/* Progress bar */}
      {progress !== null && (
        <div className="w-full bg-bg-hover rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div>
        <Button
          variant="primary"
          onClick={handleExport}
          disabled={exportBackup.isPending || noneChecked}
        >
          <Download className="w-3.5 h-3.5" />
          {exportBackup.isPending ? 'Preparing…' : 'Download Backup'}
        </Button>
      </div>
    </section>
  );
}
