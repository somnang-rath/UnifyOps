'use client';
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Upload, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Confirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import {
  ALL_BACKUP_SCOPES,
  BACKUP_SCOPE_LABELS,
  type BackupFilePreview,
  type BackupMeta,
  type BackupScope,
  type ImportResult,
  type ImportStrategy,
} from '@/schemas/backup';
import { useBackupMutations } from '@/hooks/use-backup';

async function readFileMeta(file: File): Promise<BackupFilePreview> {
  // All .prismback files are gzip-compressed. Use the browser's built-in
  // DecompressionStream to decompress before parsing, so we can detect
  // meta.encrypted and show the password field when needed.
  try {
    const ds   = new DecompressionStream('gzip');
    const buf  = await new Response(file.stream().pipeThrough(ds)).arrayBuffer();
    const text = new TextDecoder().decode(buf);
    const json = JSON.parse(text) as { meta: BackupMeta };
    return { meta: json.meta, encrypted: json.meta.encrypted ?? false };
  } catch {
    // Fallback for any uncompressed or legacy file
    try {
      const text = await file.text();
      const json = JSON.parse(text) as { meta: BackupMeta };
      return { meta: json.meta, encrypted: json.meta.encrypted ?? false };
    } catch {
      throw new Error('Cannot read file metadata');
    }
  }
}

export function BackupImportCard() {
  const f = useFormat();
  const { importBackup } = useBackupMutations();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file,       setFile]       = useState<File | null>(null);
  const [meta,       setMeta]       = useState<BackupMeta | null>(null);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [metaError,  setMetaError]  = useState<string | null>(null);
  const [strategy,   setStrategy]   = useState<ImportStrategy>('merge');
  const [password,   setPassword]   = useState('');
  const [scopes,     setScopes]     = useState<BackupScope[]>([...ALL_BACKUP_SCOPES]);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const handleFilePick = async (picked: File) => {
    setFile(picked);
    setResult(null);
    setMetaError(null);
    setMeta(null);
    setIsEncrypted(false);

    try {
      const preview = await readFileMeta(picked);
      setMeta(preview.meta);
      setIsEncrypted(preview.encrypted);
      // Pre-tick only the scopes present in the backup
      if (preview.meta.scopes?.length) {
        setScopes(preview.meta.scopes.filter((s): s is BackupScope =>
          (ALL_BACKUP_SCOPES as readonly string[]).includes(s),
        ));
      }
    } catch {
      // File is probably gzip-compressed; treat as valid but no preview available
      setMetaError('Could not preview file metadata — you can still proceed with the import.');
    }
  };

  const doImport = () => {
    if (!file) return;
    setResult(null);
    importBackup.mutate(
      { file, opts: { strategy, scopes, password: password || null } },
      {
        onSuccess: (res) => setResult(res),
      },
    );
  };

  const handleImportClick = () => {
    if (!file) return;
    if (strategy === 'replace') {
      setConfirmReplace(true);
    } else {
      doImport();
    }
  };

  const toggleScope = (scope: BackupScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const totalInserted = result
    ? Object.values(result.inserted).reduce((s, n) => s + (n ?? 0), 0)
    : 0;
  const totalSkipped = result
    ? Object.values(result.skipped).reduce((s, n) => s + (n ?? 0), 0)
    : 0;

  return (
    <>
      <Confirm
        open={confirmReplace}
        title="Replace existing data?"
        body={`This will permanently delete your existing ${scopes.map((s) => BACKUP_SCOPE_LABELS[s]).join(', ')} data before restoring the backup. This cannot be undone.`}
        danger
        onConfirm={() => { setConfirmReplace(false); doImport(); }}
        onClose={() => setConfirmReplace(false)}
      />

      <section className="bg-bg-card border border-border rounded-lg p-6 flex flex-col gap-5">
        <header>
          <h3 className="text-[15px] font-semibold">Import Backup</h3>
          <p className="text-[13px] text-text-muted mt-0.5">
            Restore your data from a <code className="font-mono">.prismback</code> file.
          </p>
        </header>

        {/* File drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFilePick(f);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors',
            file
              ? 'border-accent/60 bg-accent-50 dark:bg-[rgba(99,102,241,.06)]'
              : 'border-border hover:border-accent/50',
          )}
        >
          <Upload className={cn('w-7 h-7', file ? 'text-accent' : 'text-text-muted')} />
          {file ? (
            <div className="text-center">
              <p className="text-[13px] font-medium text-text">{file.name}</p>
              <p className="text-[11.5px] text-text-muted">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-text-muted text-center">
              Click to choose or drag a <code className="font-mono">.prismback</code> file here
            </p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".prismback"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFilePick(f);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />

        {/* Metadata preview */}
        {meta && (
          <div className="text-[12px] bg-bg-subtle border border-border rounded-md px-4 py-3 flex flex-col gap-1">
            <p><span className="text-text-muted">Exported by:</span> <span className="font-medium">{meta.exportedBy}</span></p>
            <p>
              <span className="text-text-muted">Date:</span>{' '}
              <span className="font-medium">
                {f.dateTime(meta.exportedAt)}
              </span>
            </p>
            <p>
              <span className="text-text-muted">Contents:</span>{' '}
              <span className="font-medium">
                {meta.scopes?.map((s) => BACKUP_SCOPE_LABELS[s as BackupScope] ?? s).join(', ')}
              </span>
            </p>
            {isEncrypted && (
              <p className="text-amber-500 font-medium flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3.5 h-3.5" /> This backup is password-protected
              </p>
            )}
          </div>
        )}
        {metaError && (
          <p className="text-[12px] text-text-muted italic">{metaError}</p>
        )}

        {/* Password field — shown automatically when meta says encrypted,
            or user can manually reveal it via checkbox when meta is unknown */}
        {file && (isEncrypted || metaError) && (
          <div className="flex flex-col gap-2">
            {metaError && !isEncrypted && (
              <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  className="accent-[var(--a)] w-3.5 h-3.5"
                  checked={isEncrypted}
                  onChange={(e) => setIsEncrypted(e.target.checked)}
                />
                <span className="text-[13px] font-medium">This backup is password-protected</span>
              </label>
            )}
            {isEncrypted && (
              <Field label="Backup password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter the backup password"
                  autoComplete="off"
                  className="max-w-[320px]"
                />
              </Field>
            )}
          </div>
        )}

        {/* Scopes to restore */}
        {file && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-text-muted">
              Restore data types
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_BACKUP_SCOPES.map((scope) => {
                const inFile  = !meta?.scopes || meta.scopes.includes(scope);
                const checked = scopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer select-none transition-colors',
                      !inFile && 'opacity-40 cursor-not-allowed',
                      checked && inFile
                        ? 'border-accent bg-accent-50 dark:bg-[rgba(99,102,241,.1)]'
                        : 'border-border hover:border-accent/50',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--a)] w-3.5 h-3.5"
                      checked={checked}
                      disabled={!inFile}
                      onChange={() => toggleScope(scope)}
                    />
                    <span className="text-[12.5px] font-medium truncate">
                      {BACKUP_SCOPE_LABELS[scope]}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Strategy */}
        {file && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-text-muted">
              Restore strategy
            </span>
            <div className="flex flex-col gap-2">
              {(
                [
                  {
                    value:  'merge'   as ImportStrategy,
                    label:  'Merge with existing data',
                    hint:   'Adds backup items to your current data. Items that already exist are skipped.',
                    danger: false,
                  },
                  {
                    value:  'replace' as ImportStrategy,
                    label:  'Replace — remove all new data first',
                    hint:   'Deletes your current data in the selected types, then restores the backup.',
                    danger: true,
                  },
                ] satisfies { value: ImportStrategy; label: string; hint: string; danger: boolean }[]
              ).map(({ value, label, hint, danger }) => (
                <label
                  key={value}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 rounded-md border cursor-pointer select-none transition-colors',
                    strategy === value
                      ? danger
                        ? 'border-red-400 bg-red-500/10'
                        : 'border-accent bg-accent-50 dark:bg-[rgba(99,102,241,.1)]'
                      : 'border-border hover:border-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="strategy"
                    className="accent-[var(--a)] mt-0.5 flex-shrink-0"
                    checked={strategy === value}
                    onChange={() => setStrategy(value)}
                  />
                  <div>
                    <p className={cn('text-[13px] font-medium', danger && strategy === value && 'text-red-500')}>
                      {label}
                    </p>
                    <p className="text-[12px] text-text-muted mt-0.5">{hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-md border border-border bg-bg-subtle px-4 py-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-emerald-500 font-medium text-[13px]">
              <CheckCircle2 className="w-4 h-4" />
              Import complete
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              {ALL_BACKUP_SCOPES.filter(
                (s) => (result.inserted[s] ?? 0) > 0 || (result.skipped[s] ?? 0) > 0,
              ).map((s) => (
                <div key={s} className="flex justify-between text-[12px]">
                  <span className="text-text-muted">{BACKUP_SCOPE_LABELS[s]}</span>
                  <span>
                    <span className="text-emerald-500 font-medium">{result.inserted[s] ?? 0} added</span>
                    {(result.skipped[s] ?? 0) > 0 && (
                      <span className="text-text-muted ml-1">· {result.skipped[s]} skipped</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11.5px] text-text-muted mt-1">
              Total: {totalInserted} items restored, {totalSkipped} already existed.
            </p>
          </div>
        )}

        {importBackup.isError && (
          <div className="flex items-center gap-2 text-red-500 text-[13px]">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {(importBackup.error as Error)?.message ?? 'Import failed — please try again.'}
          </div>
        )}

        {/* Loading bar */}
        {importBackup.isPending && (
          <div className="w-full bg-bg-hover rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-accent rounded-full animate-pulse w-full" />
          </div>
        )}

        <div>
          <Button
            variant="primary"
            onClick={handleImportClick}
            disabled={!file || importBackup.isPending || scopes.length === 0}
          >
            <Upload className="w-3.5 h-3.5" />
            {importBackup.isPending ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </section>
    </>
  );
}
