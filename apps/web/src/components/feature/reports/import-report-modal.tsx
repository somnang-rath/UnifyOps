'use client';

import { useCallback, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, FileJson, Loader2, Upload, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReportTemplate } from '@/schemas/report';

// Fields we expect in a valid export file
const REQUIRED_KEYS = ['__prism_report', 'name', 'elements'] as const;

export interface ParsedReport
  extends Pick<
    ReportTemplate,
    | 'name' | 'description' | 'pageSize' | 'orientation' | 'background'
    | 'elements' | 'pages' | 'groups' | 'margins' | 'header' | 'footer' | 'permissions'
  > {}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the validated payload when the user confirms. */
  onImport: (report: ParsedReport) => Promise<void>;
}

export function ImportReportModal({ open, onClose, onImport }: Props) {
  const [dragging, setDragging]     = useState(false);
  const [parsed, setParsed]         = useState<ParsedReport | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [filename, setFilename]     = useState<string>('');
  const [loading, setLoading]       = useState(false);
  const fileRef                     = useRef<HTMLInputElement>(null);

  const reset = () => { setParsed(null); setError(null); setFilename(''); };

  const parse = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Only .json files exported from Prism are supported.');
      return;
    }
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target!.result as string);
        for (const k of REQUIRED_KEYS) {
          if (!(k in raw)) throw new Error(`Missing field: ${k}`);
        }
        if (raw.__prism_report !== true) {
          throw new Error('Not a valid Prism report export.');
        }
        setParsed({
          name:        raw.name        ?? 'Imported Report',
          description: raw.description ?? '',
          pageSize:    raw.pageSize    ?? 'A4',
          orientation: raw.orientation ?? 'portrait',
          background:  raw.background  ?? '#ffffff',
          elements:    Array.isArray(raw.elements)  ? raw.elements  : [],
          pages:       Array.isArray(raw.pages)     ? raw.pages     : [],
          groups:      Array.isArray(raw.groups)    ? raw.groups    : [],
          margins:     raw.margins,
          header:      raw.header,
          footer:      raw.footer,
          permissions: raw.permissions ?? { allowDownload: true, allowedFormats: ['pdf'] },
        });
        setError(null);
      } catch (err: unknown) {
        setParsed(null);
        setError(err instanceof Error ? err.message : 'Failed to parse file.');
      }
    };
    reader.readAsText(file);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    reset();
    parse(files[0]);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = async () => {
    if (!parsed) return;
    setLoading(true);
    try { await onImport(parsed); }
    finally { setLoading(false); }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-modal-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
              <FileJson className="w-4 h-4 text-accent-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Import Report</h2>
              <p className="text-xs text-text-muted">Load a .json report export</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'relative flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none',
              dragging
                ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/20'
                : parsed
                  ? 'border-green-400 bg-green-50 dark:bg-green-950/20'
                  : error
                    ? 'border-red-400 bg-red-50 dark:bg-red-950/20'
                    : 'border-border bg-bg-subtle hover:border-accent-400 hover:bg-accent-50/40 dark:hover:bg-accent-950/10',
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {parsed ? (
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            ) : error ? (
              <AlertCircle className="w-8 h-8 text-red-500" />
            ) : (
              <Upload className={cn('w-8 h-8', dragging ? 'text-accent-500' : 'text-text-muted')} />
            )}

            <div className="text-center">
              <p className={cn(
                'text-sm font-medium',
                parsed ? 'text-green-700 dark:text-green-400'
                  : error ? 'text-red-600 dark:text-red-400'
                  : 'text-text-sub',
              )}>
                {parsed
                  ? 'File loaded'
                  : error
                    ? 'Invalid file'
                    : dragging
                      ? 'Drop it here'
                      : 'Drop a JSON file or click to browse'}
              </p>
              {filename && (
                <p className="text-xs text-text-muted mt-0.5 truncate max-w-[240px]">{filename}</p>
              )}
              {!parsed && !error && (
                <p className="text-xs text-text-muted mt-0.5">Only Prism .json exports are accepted</p>
              )}
            </div>

            {(parsed || error) && (
              <button
                onClick={(e) => { e.stopPropagation(); reset(); }}
                className="absolute top-2 right-2 p-1 rounded-lg hover:bg-bg-hover text-text-muted"
                title="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Error detail */}
          {error && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Parsed preview */}
          {parsed && (
            <div className="rounded-xl border border-border bg-bg-subtle overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-border bg-bg-card flex items-center gap-2">
                <FileJson className="w-3.5 h-3.5 text-accent-600 flex-shrink-0" />
                <p className="text-xs font-semibold truncate text-text">{parsed.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-px bg-border">
                {[
                  ['Page size', `${parsed.pageSize} · ${parsed.orientation}`],
                  ['Elements', String(parsed.elements.length)],
                  ['Pages', String(Math.max(1, parsed.pages?.length ?? 0))],
                  ['Background', parsed.background],
                ].map(([label, value]) => (
                  <div key={label} className="bg-bg-subtle px-3 py-2">
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">{label}</p>
                    <p className="text-xs font-medium text-text mt-0.5">
                      {label === 'Background'
                        ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm border border-border inline-block" style={{ background: value }} />
                            {value}
                          </span>
                        )
                        : value}
                    </p>
                  </div>
                ))}
              </div>
              {parsed.description && (
                <p className="px-3.5 py-2 text-xs text-text-muted border-t border-border line-clamp-2">
                  {parsed.description}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-bg-subtle">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={!parsed || loading}
            className="gap-1.5 min-w-[120px]"
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
              : <><Upload className="w-3.5 h-3.5" /> Import Report</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
