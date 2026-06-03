'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useReport, useReportMutations, reportsApi } from '@/hooks/use-reports';
import { CanvasEditor } from '@/components/feature/reports/canvas-editor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReportTemplate } from '@/schemas/report';
import {
  ArrowLeft, CheckCircle2, Circle, Download, Eye, Filter,
  History, Link2, Loader2, Play, RefreshCw, Save, X,
} from 'lucide-react';
import type { ReportPerRecipientUrlConfig } from '@/schemas/report';
import { api } from '@/lib/api';

/* ── Filtered-preview popover ────────────────────────────────────────────── */

const FILTER_LS_KEY = 'report_preview_filter';

function PreviewFilterPopover({
  templateId,
  perRecipientUrlConfig,
  onClose,
  onPreviewReady,
  onBeforePreview,
}: {
  templateId: string;
  perRecipientUrlConfig?: ReportPerRecipientUrlConfig;
  onClose: () => void;
  onPreviewReady: (url: string) => void;
  onBeforePreview?: () => Promise<void>;
}) {
  const saved = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem(FILTER_LS_KEY) ?? '{}'); } catch { return {}; } })()
    : {};

  const cpoMode = !!(perRecipientUrlConfig?.enabled && perRecipientUrlConfig?.dataUrlTemplate);

  const [field, setField]     = useState<string>(saved.field ?? 'email');
  const [value, setValue]     = useState<string>(saved.value ?? '');
  const [cpoId, setCpoId]     = useState<string>('');
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(FILTER_LS_KEY, JSON.stringify({ field, value })); } catch {}
  }, [field, value]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const openPreview = async (filterField?: string, filterValue?: string, previewCpoId?: string) => {
    setLoading(true);
    try {
      await onBeforePreview?.();
      const path = reportsApi.previewUrl(templateId, filterField, filterValue, previewCpoId);
      const res = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      onPreviewReady(url);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1.5 w-72 bg-bg-card border border-border rounded-2xl shadow-xl z-50 animate-fade-in"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-accent-600" />
          <span className="text-xs font-semibold">Preview as recipient</span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-3">

        {/* Full preview */}
        <button
          onClick={() => openPreview()}
          disabled={loading}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border hover:border-accent-300 hover:bg-accent-50/50 dark:hover:bg-accent-950/20 transition-all text-left group"
        >
          <div className="w-7 h-7 rounded-lg bg-bg-subtle group-hover:bg-accent-100 dark:group-hover:bg-accent-900/40 flex items-center justify-center transition-colors">
            <Eye className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-600 transition-colors" />
          </div>
          <div>
            <p className="text-xs font-medium text-text">Full preview</p>
            <p className="text-[10px] text-text-muted">Show all data (no filter)</p>
          </div>
        </button>

        {/* ── Per-CPO URL preview (Mode C) ── */}
        {cpoMode && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-text-muted">or preview per CPO</span>
              <div className="flex-1 border-t border-border" />
            </div>

            {/* CPO ID hint */}
            <div className="px-3 py-2 rounded-xl bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
              <div className="flex items-center gap-1.5 mb-1">
                <Link2 className="w-3 h-3 text-violet-600 dark:text-violet-400 flex-shrink-0" />
                <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">Per-CPO URL Mode active</span>
              </div>
              <p className="text-[10px] text-violet-600 dark:text-violet-400 leading-relaxed font-mono truncate">
                {perRecipientUrlConfig?.dataUrlTemplate}
              </p>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1.5 block">
                CPO ID
              </label>
              <input
                type="text"
                value={cpoId}
                onChange={(e) => setCpoId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && cpoId.trim() && openPreview(undefined, undefined, cpoId.trim())}
                placeholder="CPO001"
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-violet-400 transition-colors font-mono"
              />
              <p className="text-[10px] text-text-muted mt-1">
                ID field: <code className="bg-bg-subtle rounded px-1">{perRecipientUrlConfig?.idField || 'id'}</code>
              </p>
            </div>

            <Button
              size="sm"
              onClick={() => openPreview(undefined, undefined, cpoId.trim())}
              disabled={loading || !cpoId.trim()}
              className="w-full gap-1.5 bg-violet-600 hover:bg-violet-700 text-black border-0"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Eye className="w-3.5 h-3.5" />}
              {loading ? 'Generating…' : 'Preview this CPO'}
            </Button>
          </>
        )}

        {/* ── Standard filter (Mode A / B) ── */}
        {!cpoMode && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-text-muted">or filter by recipient</span>
              <div className="flex-1 border-t border-border" />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1.5 block">
                Filter Field
              </label>
              <input
                type="text"
                value={field}
                onChange={(e) => setField(e.target.value)}
                placeholder="email"
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors font-mono"
              />
              <p className="text-[10px] text-text-muted mt-1">e.g. <code className="bg-bg-subtle rounded px-1">email</code> or <code className="bg-bg-subtle rounded px-1">cpo_id</code></p>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1.5 block">
                Value
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && value.trim() && openPreview(field, value)}
                placeholder="cpo@example.com"
                className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              />
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={() => openPreview(field, value)}
              disabled={loading || !value.trim() || !field.trim()}
              className="w-full gap-1.5"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Eye className="w-3.5 h-3.5" />}
              {loading ? 'Generating…' : 'Preview filtered PDF'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Edit page ───────────────────────────────────────────────────────────── */

export default function ReportEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: serverTemplate, isLoading } = useReport(id);
  const { update, triggerRun } = useReportMutations();

  const [local, setLocal]           = useState<ReportTemplate | null>(null);
  const [dirty, setDirty]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preparing, setPreparing]   = useState(false);
  const [running, setRunning]       = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [autoSave, setAutoSave]     = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const debounceRef          = useRef<NodeJS.Timeout | null>(null);
  const savedTimerRef        = useRef<NodeJS.Timeout | null>(null);
  const localRef             = useRef<ReportTemplate | null>(null);
  const previewBtnRef        = useRef<HTMLDivElement>(null);
  const canvasRefreshRef     = useRef<(() => Promise<void>) | null>(null);
  const canvasExportRef      = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (serverTemplate && !local) {
      setLocal(serverTemplate);
      localRef.current = serverTemplate;
    }
  }, [serverTemplate]);

  const patch = useCallback((changes: Partial<ReportTemplate>) => {
    setLocal((prev) => {
      const next = prev ? { ...prev, ...changes } : prev;
      localRef.current = next;
      return next;
    });
    setDirty(true);
    setSaved(false);
    if (!autoSave) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (localRef.current) handleSave(localRef.current);
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave]);

  const closePdfPreview = () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null);
  };

  useEffect(() => {
    if (!pdfPreviewUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePdfPreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfPreviewUrl]);

  /* Prepare: fetch fresh data + run auto-layout (used before preview and run) */
  const prepare = async () => {
    setPreparing(true);
    try {
      if (canvasExportRef.current) await canvasExportRef.current();
      // Save the freshly-laid-out template so the server generates from current data
      if (localRef.current) await update.mutateAsync({ id, body: localRef.current });
    } finally {
      setPreparing(false);
    }
  };

  /* Full (unfiltered) preview — prepare → save → generate PDF */
  const handlePreview = async () => {
    setPreviewing(true);
    try {
      await prepare();
      const res = await api.get(`/reports/${id}/preview`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPdfPreviewUrl(url);
    } finally {
      setPreviewing(false);
    }
  };

  /* Run (send email) — prepare → save → trigger run */
  const handleRun = async () => {
    setRunning(true);
    try {
      await prepare();
      await triggerRun.mutateAsync(id);
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async (data?: ReportTemplate) => {
    if (!local && !data) return;
    const toSave = data ?? local!;
    setSaving(true);
    try {
      await update.mutateAsync({ id, body: toSave });
      setDirty(false);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !local) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-12 border-b border-border flex items-center gap-3 px-4 bg-bg-card flex-shrink-0">
          <div className="h-5 w-20 bg-bg-subtle rounded animate-pulse" />
          <div className="w-px h-5 bg-border" />
          <div className="h-5 w-40 bg-bg-subtle rounded animate-pulse" />
          <div className="ml-auto flex gap-2">
            <div className="h-7 w-20 bg-bg-subtle rounded animate-pulse" />
            <div className="h-7 w-20 bg-bg-subtle rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="h-12 border-b border-border flex items-center gap-2 px-3 bg-bg-card flex-shrink-0">

        <Link href="/reports">
          <Button variant="ghost" size="sm" className="gap-1.5 text-text-muted">
            <ArrowLeft className="w-3.5 h-3.5" />
            Reports
          </Button>
        </Link>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Editable name */}
        {editingName ? (
          <input
            autoFocus
            className="text-sm font-semibold bg-transparent border-b-2 border-accent-600 outline-none px-0.5 min-w-0 w-52"
            value={local.name}
            onChange={(e) => patch({ name: e.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="text-sm font-semibold hover:text-accent-600 transition-colors truncate max-w-[200px] px-0.5"
            title="Click to rename"
          >
            {local.name}
          </button>
        )}

        {/* Save status */}
        <div className="flex items-center gap-1 ml-1">
          {saving && (
            <span className="flex items-center gap-1 text-[11px] text-text-muted">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </span>
          )}
          {!saving && saved && (
            <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400 animate-fade-in">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
          {!saving && !saved && dirty && (
            <span className="flex items-center gap-1 text-[11px] text-text-muted">
              <Circle className="w-2 h-2 fill-amber-400 text-amber-400" /> Unsaved
            </span>
          )}
        </div>

        <span className="ml-1 text-[11px] text-text-muted bg-bg-subtle border border-border px-2 py-0.5 rounded-full hidden sm:inline-flex items-center gap-1">
          {local.pageSize} · {local.orientation}
        </span>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-1.5">

          {/* Auto-save toggle */}
          <button
            onClick={() => setAutoSave((v) => !v)}
            title={autoSave ? 'Auto-save ON' : 'Auto-save OFF'}
            className={cn(
              'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
              autoSave
                ? 'border-accent-400 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                : 'border-border text-text-muted hover:border-accent-300 hover:text-text',
            )}
          >
            <RefreshCw className={cn('w-3 h-3', autoSave && 'animate-spin [animation-duration:3s]')} />
            Auto-save
          </button>

          <div className="w-px h-4 bg-border hidden sm:block" />

          <Link href={`/reports/${id}/history`}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-text-muted" title="Run history">
              <History className="w-3.5 h-3.5" />
              <span className="hidden md:inline">History</span>
            </Button>
          </Link>

          {/* Preview */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreview}
            disabled={previewing || preparing}
            className="gap-1.5 text-text-muted"
          >
            {(previewing || preparing)
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Eye className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">
              {preparing ? 'Preparing…' : previewing ? 'Generating…' : 'Preview'}
            </span>
          </Button>

          {/* Filter preview */}
          <div ref={previewBtnRef} className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilterOpen((v) => !v)}
              title="Preview filtered by recipient"
              className={cn(
                'gap-1.5',
                filterOpen
                  ? 'text-accent-600 bg-accent-50 dark:bg-accent-950/30 dark:text-accent-400'
                  : 'text-text-muted',
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Filter</span>
            </Button>

            {filterOpen && (
              <PreviewFilterPopover
                templateId={id}
                perRecipientUrlConfig={local.perRecipientUrlConfig}
                onClose={() => setFilterOpen(false)}
                onPreviewReady={setPdfPreviewUrl}
                onBeforePreview={dirty && local ? async () => { await update.mutateAsync({ id, body: local }); } : undefined}
              />
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSave()}
            disabled={!dirty || saving}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleRun}
            disabled={running || preparing}
            className="gap-1.5"
          >
            {(running || preparing)
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Play className="w-3.5 h-3.5" />}
            {preparing ? 'Preparing…' : running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <CanvasEditor
        template={local}
        onChange={patch}
        refreshDatasourcesRef={canvasRefreshRef}
        prepareForExportRef={canvasExportRef}
        getLatestTemplate={() => localRef.current!}
      />

      {/* PDF preview modal — shows inline instead of downloading */}
      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-bg-card animate-fade-in">
          {/* Header bar */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="w-4 h-4 text-accent-600 flex-shrink-0" />
              <span className="text-sm font-semibold truncate">
                Preview — {local.name}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Download button */}
              <a
                href={pdfPreviewUrl}
                download={`${local.name}.pdf`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:border-accent-400 hover:text-accent-600 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </a>
              <button
                onClick={closePdfPreview}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* PDF iframe */}
          <iframe
            src={pdfPreviewUrl}
            className="flex-1 w-full border-0"
            title="PDF Preview"
          />
        </div>
      )}
    </div>
  );
}
