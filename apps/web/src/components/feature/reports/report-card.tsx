'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ReportTemplate } from '@/schemas/report';
import { reportsApi, useReportMutations } from '@/hooks/use-reports';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BookTemplate, Calendar, Camera, Clock, Copy, Download, Edit2,
  FileJson, History, ImagePlus, Loader2, MoreHorizontal, Play,
  Share2, Trash2, Trash, Users, Zap,
} from 'lucide-react';
import { QuickScheduleModal } from './quick-schedule-modal';
import { ShareReportModal } from './share-report-modal';
import { ImageCropModal } from '@/components/feature/sheets/image-crop-modal';

const FREQ_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};

const FMT_STYLE: Record<string, string> = {
  pdf:  'bg-rose-500 text-white',
  xlsx: 'bg-emerald-500 text-white',
};

interface Props {
  template: ReportTemplate;
  onRun: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}

export function ReportCard({ template, onRun, onDelete, onDuplicate }: Props) {
  const [menuOpen, setMenuOpen]           = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading]     = useState(false);
  const [scheduleOpen, setScheduleOpen]   = useState(false);
  const [shareOpen, setShareOpen]         = useState(false);
  const [uploading, setUploading]         = useState(false);
  const [cropSrc, setCropSrc]             = useState<string | null>(null);
  const [savingTmpl, setSavingTmpl]       = useState(false);

  const menuRef      = useRef<HTMLDivElement>(null);
  const coverMenuRef = useRef<HTMLDivElement>(null);
  const fileRef      = useRef<HTMLInputElement>(null);
  const { update } = useReportMutations();

  /* close ⋯ menu on outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  /* close cover menu on outside click */
  useEffect(() => {
    if (!coverMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (coverMenuRef.current && !coverMenuRef.current.contains(e.target as Node)) setCoverMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [coverMenuOpen]);

  const handleDownload = async () => {
    setMenuOpen(false);
    setDownloading(true);
    try { await reportsApi.downloadPdf(template._id, template.name); }
    finally { setDownloading(false); }
  };

  const handleCoverPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleCropApply = async (cropped: string) => {
    setCropSrc(null);
    setUploading(true);
    try {
      await update.mutateAsync({ id: template._id, body: { thumbnail: cropped } });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveCover = async () => {
    setCoverMenuOpen(false);
    await update.mutateAsync({ id: template._id, body: { thumbnail: '' } });
  };

  const handleToggleTemplate = async () => {
    setMenuOpen(false);
    setSavingTmpl(true);
    try {
      await update.mutateAsync({ id: template._id, body: { isTemplate: !template.isTemplate } });
    } finally {
      setSavingTmpl(false);
    }
  };

  const cpoMode        = template.perRecipientUrlConfig?.enabled && !!template.perRecipientUrlConfig?.listUrl;
  const autoMode       = !cpoMode && template.dataRecipientsConfig?.enabled && !!template.dataRecipientsConfig?.emailField;
  const recipientCount = (autoMode || cpoMode) ? null : (template.recipients?.length ?? 0);
  const bg = template.background ?? '#e2e8f0';

  return (
    <div className="flex flex-col bg-bg-card border border-border rounded-2xl overflow-hidden shadow-sm">

      <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={handleCoverPick} />

      {/* ── Cover — fixed 16:9 ──────────────────── */}
      <div className="relative aspect-video overflow-hidden flex-shrink-0" style={{ background: bg }}>

        {/* Image or placeholder */}
        {template.thumbnail ? (
          <img
            src={template.thumbnail}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col justify-center px-7 py-6 gap-2.5" style={{ color: '#94a3b8' }}>
            <div className="h-2.5 w-2/5 rounded-full bg-current opacity-40" />
            <div className="h-2   w-3/5 rounded-full bg-current opacity-25" />
            <div className="flex items-end gap-1.5 h-12 mt-1 opacity-30">
              {[50, 75, 40, 88, 60, 70, 45].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-current" style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="h-1.5 w-full rounded-full bg-current opacity-20 mt-1" />
            <div className="h-1.5 w-5/6  rounded-full bg-current opacity-15" />
            <div className="h-1.5 w-4/6  rounded-full bg-current opacity-10" />
          </div>
        )}

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

        {/* Top-left: schedule badge */}
        <div className="absolute top-2.5 left-2.5">
          {template.schedule.enabled ? (
            <span className="inline-flex items-center gap-1 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-sm">
              <Zap className="w-2.5 h-2.5 fill-white" />
              {FREQ_LABELS[template.schedule.frequency] ?? 'Auto'}
            </span>
          ) : (
            <span className="inline-block bg-black/45 backdrop-blur-sm text-white/90 text-[10px] font-medium px-2 py-0.5 rounded-md">
              Manual
            </span>
          )}
        </div>

        {/* Top-right: cover-options button */}
        <div ref={coverMenuRef} className="absolute top-2.5 right-2.5">
          <button
            onClick={(e) => { e.stopPropagation(); setCoverMenuOpen((o) => !o); }}
            className={cn(
              'w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-sm',
              coverMenuOpen ? 'bg-white/90 text-slate-700' : 'bg-black/40 text-white hover:bg-black/60',
            )}
            title="Cover options"
            disabled={uploading}
          >
            {uploading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Camera className="w-3.5 h-3.5" />}
          </button>

          {/* Cover options popover */}
          {coverMenuOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-44 bg-bg-card border border-border rounded-xl shadow-xl py-1 z-50">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Cover image
              </div>

              <button
                onClick={() => { setCoverMenuOpen(false); fileRef.current?.click(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left"
              >
                <ImagePlus className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                {template.thumbnail ? 'Change photo' : 'Upload photo'}
              </button>

              {template.thumbnail && (
                <>
                  <button
                    onClick={() => { setCoverMenuOpen(false); setCropSrc(template.thumbnail!); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left"
                  >
                    <Camera className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                    Re-crop
                  </button>

                  <div className="my-1 border-t border-border/60" />

                  <button
                    onClick={handleRemoveCover}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 text-left"
                  >
                    <Trash className="w-3.5 h-3.5 flex-shrink-0" />
                    Remove cover
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Bottom-left: format pills */}
        {!!template.permissions?.allowedFormats?.length && (
          <div className="absolute bottom-2.5 left-2.5 flex gap-1">
            {template.permissions.allowedFormats.map((fmt) => (
              <span
                key={fmt}
                className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide shadow-sm', FMT_STYLE[fmt] ?? 'bg-black/50 text-white')}
              >
                {fmt}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ──────────────────────────────── */}
      <div className="flex flex-col flex-1 px-4 pt-3.5 pb-4 gap-2.5">

        {/* Title + description */}
        <div className="min-h-[48px]">
          <p className="font-semibold text-[13px] leading-snug truncate text-text">
            {template.name}
          </p>
          <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed min-h-[30px]">
            {template.description || 'Start with an empty canvas'}
          </p>
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn(
            'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border',
            template.schedule.enabled
              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800'
              : 'bg-bg-subtle text-text-muted border-border',
          )}>
            <Calendar className="w-2.5 h-2.5" />
            {template.schedule.enabled
              ? (FREQ_LABELS[template.schedule.frequency] ?? template.schedule.frequency)
              : 'Manual'}
          </span>

          {cpoMode ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800">
              <Zap className="w-2.5 h-2.5" /> Per-CPO
            </span>
          ) : autoMode ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-accent-50 text-accent-700 border border-accent-200 dark:bg-accent-950/40 dark:text-accent-400 dark:border-accent-800">
              <Zap className="w-2.5 h-2.5" /> Auto
            </span>
          ) : recipientCount != null && recipientCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-accent-50 text-accent-700 border border-accent-200 dark:bg-accent-950/40 dark:text-accent-400 dark:border-accent-800">
              <Users className="w-2.5 h-2.5" /> {recipientCount}
            </span>
          ) : null}

          {template.isTemplate && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-accent-50 text-accent-700 border border-accent-200 dark:bg-accent-950/40 dark:text-accent-400 dark:border-accent-800">
              <BookTemplate className="w-2.5 h-2.5" /> Template
            </span>
          )}

          {(template.grants?.length ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-bg-subtle text-text-muted border border-border">
              <Share2 className="w-2.5 h-2.5" /> Shared
            </span>
          )}

          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-text-muted">
            <Clock className="w-2.5 h-2.5" />
            {new Date(template.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </div>

        <div className="border-t border-border/60 mt-0.5" />

        {/* Actions */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
            <span className="text-xs text-red-600 dark:text-red-400 flex-1 font-medium">Delete this report?</span>
            <button
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              className="text-xs font-bold text-red-600 hover:text-red-700 px-2"
            >Yes</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-text-muted hover:text-text px-2"
            >No</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">

            <Link href={`/reports/${template._id}/edit`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                <Edit2 className="w-3 h-3" /> Edit
              </Button>
            </Link>

            <Button variant="primary" size="sm" onClick={onRun} className="flex-1 gap-1.5 text-xs">
              <Play className="w-3 h-3 fill-current" /> Run
            </Button>

            {/* ⋯ overflow menu */}
            <div ref={menuRef} className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center border text-text-muted',
                  menuOpen
                    ? 'border-accent-400 bg-accent-50 text-accent-600 dark:bg-accent-950/30 dark:text-accent-400'
                    : 'border-border bg-bg-subtle hover:bg-bg-hover',
                )}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div className="absolute bottom-full right-0 mb-1.5 w-44 bg-bg-card border border-border rounded-xl shadow-lg py-1 z-50">

                  <button
                    onClick={() => { setMenuOpen(false); setScheduleOpen(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left"
                  >
                    <Zap className={cn('w-3.5 h-3.5', template.schedule.enabled ? 'text-green-500 fill-green-500' : 'text-text-muted')} />
                    <span>{template.schedule.enabled ? 'Edit schedule' : 'Set schedule'}</span>
                    {template.schedule.enabled && (
                      <span className="ml-auto text-[10px] font-bold text-green-600 dark:text-green-400">ON</span>
                    )}
                  </button>

                  <button
                    onClick={() => { setMenuOpen(false); onDuplicate?.(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left"
                  >
                    <Copy className="w-3.5 h-3.5 text-text-muted" />
                    Duplicate
                  </button>

                  <button
                    onClick={() => { setMenuOpen(false); setShareOpen(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left"
                  >
                    <Share2 className="w-3.5 h-3.5 text-text-muted" />
                    Share
                    {(template.grants?.length ?? 0) > 0 && (
                      <span className="ml-auto text-[10px] font-bold text-accent-600">{template.grants!.length}</span>
                    )}
                  </button>

                  <button
                    onClick={handleToggleTemplate}
                    disabled={savingTmpl}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left disabled:opacity-40"
                  >
                    {savingTmpl
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" />
                      : <BookTemplate className={cn('w-3.5 h-3.5', template.isTemplate ? 'text-accent-600' : 'text-text-muted')} />}
                    <span>{template.isTemplate ? 'Remove from templates' : 'Save as template'}</span>
                    {template.isTemplate && (
                      <span className="ml-auto text-[10px] font-bold text-accent-600">ON</span>
                    )}
                  </button>

                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left disabled:opacity-40"
                  >
                    {downloading
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" />
                      : <Download className="w-3.5 h-3.5 text-text-muted" />}
                    <span>Download PDF</span>
                  </button>

                  <button
                    onClick={() => { setMenuOpen(false); reportsApi.exportJson(template); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover text-left"
                  >
                    <FileJson className="w-3.5 h-3.5 text-text-muted" />
                    Export JSON
                  </button>

                  <Link href={`/reports/${template._id}/history`} onClick={() => setMenuOpen(false)}>
                    <span className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-bg-hover">
                      <History className="w-3.5 h-3.5 text-text-muted" />
                      Run history
                    </span>
                  </Link>

                  <div className="my-1 border-t border-border/60" />

                  <button
                    onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete report
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Crop modal */}
      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          onApply={handleCropApply}
          onClose={() => setCropSrc(null)}
        />
      )}

      <QuickScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        template={template}
      />

      {shareOpen && (
        <ShareReportModal
          template={template}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
