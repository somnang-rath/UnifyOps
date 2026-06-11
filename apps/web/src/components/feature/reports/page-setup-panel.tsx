'use client';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Globe, ImageUp, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type { FileItem } from '@/schemas/file';
import type {
  HFSection,
  ReportFooter,
  ReportHeader,
  ReportMargins,
  ReportTemplate,
} from '@/schemas/report';

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_MARGINS: ReportMargins = { top: 0, right: 0, bottom: 0, left: 0 };

export const DEFAULT_HEADER: ReportHeader = {
  enabled: false,
  height: 50,
  background: '#ffffff',
  padding: 12,
  borderBottom: false,
  borderColor: '#e5e7eb',
  borderWidth: 1,
};

export const DEFAULT_FOOTER: ReportFooter = {
  enabled: false,
  height: 40,
  background: '#ffffff',
  padding: 12,
  borderTop: false,
  borderColor: '#e5e7eb',
  borderWidth: 1,
  right: { type: 'page-number', pageNumberFormat: 'x-of-y', fontSize: 11, color: '#6b7280' },
};

// ── Micro components ──────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
      {children}
    </span>
  );
}

function NumInput({
  label,
  value,
  onChange,
  min = 0,
  max = 300,
  unit = 'px',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
          className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
        />
        {unit && <span className="text-[10px] text-text-muted flex-shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          'w-8 h-4 rounded-full relative transition-colors cursor-pointer flex-shrink-0',
          checked ? 'bg-accent-600' : 'bg-bg-subtle border border-border',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </div>
      {label && <span className="text-xs text-text-sub">{label}</span>}
    </label>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {children}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function AlignButtons({
  value,
  onChange,
}: {
  value: 'left' | 'center' | 'right';
  onChange: (v: 'left' | 'center' | 'right') => void;
}) {
  const opts: { v: 'left' | 'center' | 'right'; label: string }[] = [
    { v: 'left', label: 'L' },
    { v: 'center', label: 'C' },
    { v: 'right', label: 'R' },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'flex-1 py-1 text-xs rounded-md border transition-colors',
            value === o.v
              ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
              : 'border-border text-text-muted hover:text-text hover:bg-bg-hover',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Section type pill ─────────────────────────────────────────────────────────

function TypePill({
  value,
  current,
  onClick,
  title,
  children,
}: {
  value: HFSection['type'];
  current: HFSection['type'];
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-colors',
        current === value
          ? 'bg-bg-card text-accent-600 shadow-sm border border-accent-200 dark:border-accent-700'
          : 'text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

// ── Shared text-style row (size / bold / italic / underline / color) ─────────

function StyleRow({
  section,
  onChange,
  defaultColor = '#111111',
}: {
  section: HFSection;
  onChange: (s: HFSection) => void;
  defaultColor?: string;
}) {
  const set = <K extends keyof HFSection>(k: K, v: HFSection[K]) => onChange({ ...section, [k]: v });
  return (
    <>
      <div className="grid grid-cols-[1fr_28px_28px_28px] gap-1 items-end">
        <NumInput
          label="Size"
          value={section.fontSize ?? 12}
          onChange={(v) => set('fontSize', v)}
          min={6}
          max={72}
          unit=""
        />
        <div>
          <Label>B</Label>
          <button
            onClick={() => set('bold', !section.bold)}
            title="Bold"
            className={cn(
              'w-7 h-[30px] text-xs rounded-md border font-bold transition-colors',
              section.bold
                ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30'
                : 'border-border text-text-muted hover:bg-bg-hover',
            )}
          >
            B
          </button>
        </div>
        <div>
          <Label>I</Label>
          <button
            onClick={() => set('italic', !section.italic)}
            title="Italic"
            className={cn(
              'w-7 h-[30px] text-xs rounded-md border italic transition-colors',
              section.italic
                ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30'
                : 'border-border text-text-muted hover:bg-bg-hover',
            )}
          >
            I
          </button>
        </div>
        <div>
          <Label>U</Label>
          <button
            onClick={() => set('underline', !section.underline)}
            title="Underline"
            className={cn(
              'w-7 h-[30px] text-xs rounded-md border underline transition-colors',
              section.underline
                ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30'
                : 'border-border text-text-muted hover:bg-bg-hover',
            )}
          >
            U
          </button>
        </div>
      </div>
      <div>
        <Label>Color</Label>
        <input
          type="color"
          value={section.color ?? defaultColor}
          onChange={(e) => set('color', e.target.value)}
          className="w-full h-8 rounded-md border border-border cursor-pointer"
        />
      </div>
    </>
  );
}

// ── Image picker modal ────────────────────────────────────────────────────────

/** Returns the authenticated download URL for a stored file (same pattern as the file manager). */
function fileDownloadUrl(id: string) {
  const token = useAuthStore.getState().accessToken;
  const base  = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/files/${id}/download`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

function ImagePickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles]         = useState<FileItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [query, setQuery]         = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    // Do NOT pass q: '' — the backend Zod schema rejects empty strings.
    // Fetch all files and filter client-side by category and search query.
    api.get<FileItem[]>('/files', { _skipErrorToast: true })
      .then((r) => setFiles(r.data.filter((f) => f.category === 'image')))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = query.trim()
    ? files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : files;

  const pick = async (file: FileItem) => {
    setLoadingId(file._id);
    try {
      const res = await api.get(`/files/${file._id}/download`, { responseType: 'blob' });
      const reader = new FileReader();
      reader.onload = () => {
        onSelect(reader.result as string);
        onClose();
      };
      reader.readAsDataURL(res.data);
    } catch {
      setLoadingId(null);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-[480px] max-h-[520px] flex flex-col animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accent-600" />
            <span className="text-sm font-semibold">Choose image</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover transition-colors">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-bg-input">
            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search images…"
              className="flex-1 text-xs bg-transparent outline-none text-text placeholder:text-text-muted"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-text-muted hover:text-text">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-muted gap-2">
              <FolderOpen className="w-8 h-8 opacity-30" />
              <p className="text-xs">{query ? 'No images match your search' : 'No images in file manager'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {filtered.map((file) => (
                <button
                  key={file._id}
                  onClick={() => pick(file)}
                  disabled={!!loadingId}
                  className="group relative flex flex-col gap-1.5 rounded-lg border border-border hover:border-accent-400 bg-bg-subtle hover:bg-accent-50 dark:hover:bg-accent-950/20 transition-all overflow-hidden disabled:opacity-60"
                  title={file.name}
                >
                  <div className="aspect-square w-full flex items-center justify-center overflow-hidden bg-bg-card">
                    {loadingId === file._id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-accent-500" />
                    ) : (
                      <img
                        src={fileDownloadUrl(file._id)}
                        alt={file.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                  </div>
                  <p className="px-1.5 pb-1.5 text-[10px] text-text-sub truncate w-full text-left leading-tight">
                    {file.name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Image section editor ──────────────────────────────────────────────────────

function ImageSectionEditor({
  section,
  onChange,
}: {
  section: HFSection;
  onChange: (s: HFSection) => void;
}) {
  const set = <K extends keyof HFSection>(k: K, v: HFSection[K]) => onChange({ ...section, [k]: v });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]   = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      onChange({ ...section, imageUrl: reader.result as string });
      setUploading(false);
    };
    reader.onerror = () => setUploading(false);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <>
      {/* URL row */}
      <div>
        <Label>Image URL</Label>
        <input
          type="url"
          value={section.imageUrl?.startsWith('data:') ? '' : (section.imageUrl ?? '')}
          onChange={(e) => set('imageUrl', e.target.value)}
          placeholder="https://example.com/logo.png"
          className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
        />
      </div>

      {/* Upload + Choose buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-md border border-border bg-bg-subtle hover:border-accent-400 hover:text-accent-600 transition-colors disabled:opacity-50"
        >
          {uploading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <ImageUp className="w-3.5 h-3.5" />}
          Upload file
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-md border border-border bg-bg-subtle hover:border-accent-400 hover:text-accent-600 transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Choose image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Preview */}
      {section.imageUrl && (
        <div className="relative flex items-center justify-center h-14 rounded-md border border-dashed border-border bg-bg-subtle overflow-hidden group">
          <img
            src={section.imageUrl}
            alt="Preview"
            className="max-h-full max-w-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <button
            type="button"
            onClick={() => set('imageUrl', undefined)}
            title="Remove image"
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded bg-black/40 hover:bg-black/60 text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* W / H */}
      <div className="grid grid-cols-2 gap-2">
        <NumInput
          label="Width"
          value={section.imageWidth ?? 0}
          onChange={(v) => set('imageWidth', v > 0 ? v : undefined)}
          min={0}
          max={800}
        />
        <NumInput
          label="Height"
          value={section.imageHeight ?? 32}
          onChange={(v) => set('imageHeight', v)}
          min={8}
          max={200}
        />
      </div>
      <p className="text-[10px] text-text-muted -mt-1 leading-snug">
        Width 0 = auto. Height sets the image row size.
      </p>

      {/* Fit */}
      <div>
        <Label>Fit</Label>
        <div className="flex gap-1">
          {(['contain', 'cover', 'fill'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => set('imageFit', v)}
              className={cn(
                'flex-1 py-1.5 text-[10px] font-semibold rounded-md border capitalize transition-colors',
                (section.imageFit ?? 'contain') === v
                  ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                  : 'border-border text-text-muted hover:text-text hover:bg-bg-hover',
              )}
            >
              {v === 'fill' ? 'Stretch' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Picker modal */}
      {pickerOpen && (
        <ImagePickerModal
          onSelect={(dataUrl) => onChange({ ...section, imageUrl: dataUrl })}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

// ── Section editor ────────────────────────────────────────────────────────────

const EMPTY_SECTION: HFSection = { type: 'empty' };

function SectionEditor({
  section,
  onChange,
  showPageNumber = true,
}: {
  section: HFSection;
  onChange: (s: HFSection) => void;
  showPageNumber?: boolean;
}) {
  const set = <K extends keyof HFSection>(k: K, v: HFSection[K]) => onChange({ ...section, [k]: v });

  return (
    <div className="space-y-2.5">
      {/* Type selector */}
      <div>
        <Label>Content type</Label>
        <div className="flex gap-0.5 p-0.5 bg-bg-subtle rounded-lg">
          <TypePill value="empty"       current={section.type} onClick={() => onChange(EMPTY_SECTION)}               title="Empty">—</TypePill>
          <TypePill value="text"        current={section.type} onClick={() => onChange({ ...section, type: 'text' })}         title="Text">T</TypePill>
          <TypePill value="image"       current={section.type} onClick={() => onChange({ ...section, type: 'image' })}        title="Image">🖼</TypePill>
          <TypePill value="date"        current={section.type} onClick={() => onChange({ ...section, type: 'date' })}         title="Current date">📅</TypePill>
          {showPageNumber && (
            <TypePill value="page-number" current={section.type} onClick={() => onChange({ ...section, type: 'page-number' })} title="Page number">#</TypePill>
          )}
        </div>
      </div>

      {/* ── Text ── */}
      {section.type === 'text' && (
        <>
          <div>
            <Label>Text content</Label>
            <textarea
              value={section.text ?? ''}
              onChange={(e) => set('text', e.target.value)}
              rows={2}
              placeholder="Enter text…"
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors resize-none"
            />
          </div>
          <StyleRow section={section} onChange={onChange} />
          <div>
            <Label>Alignment</Label>
            <AlignButtons value={section.align ?? 'left'} onChange={(v) => set('align', v)} />
          </div>
        </>
      )}

      {/* ── Image ── */}
      {section.type === 'image' && (
        <ImageSectionEditor section={section} onChange={onChange} />
      )}

      {/* ── Date ── */}
      {section.type === 'date' && (
        <>
          <div>
            <Label>Date format</Label>
            <select
              value={section.dateFormat ?? 'full'}
              onChange={(e) => set('dateFormat', e.target.value as HFSection['dateFormat'])}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
            >
              <option value="full">January 15, 2025</option>
              <option value="short">1/15/2025</option>
              <option value="month-year">January 2025</option>
              <option value="year">2025</option>
            </select>
          </div>
          <StyleRow section={section} onChange={onChange} defaultColor="#6b7280" />
        </>
      )}

      {/* ── Page number ── */}
      {section.type === 'page-number' && (
        <>
          <div>
            <Label>Preset format</Label>
            <select
              value={section.pageNumberFormat ?? 'x-of-y'}
              onChange={(e) => set('pageNumberFormat', e.target.value as HFSection['pageNumberFormat'])}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              disabled={!!section.pageNumberTemplate}
            >
              <option value="page-x">Page 1</option>
              <option value="x-of-y">1 of 5</option>
              <option value="x">1</option>
            </select>
          </div>
          <div>
            <Label>Custom template (overrides preset)</Label>
            <input
              type="text"
              value={section.pageNumberTemplate ?? ''}
              onChange={(e) => set('pageNumberTemplate', e.target.value || undefined)}
              placeholder="e.g.  ទំព័រ {n}  or  Note · {n}/{total}"
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
            />
            <p className="text-[10px] text-text-muted mt-1 leading-snug">
              <code className="bg-bg-subtle px-0.5 rounded">{'{n}'}</code> = current page,{' '}
              <code className="bg-bg-subtle px-0.5 rounded">{'{total}'}</code> = total pages.
              Leave empty to use preset.
            </p>
          </div>
          <StyleRow section={section} onChange={onChange} defaultColor="#6b7280" />
        </>
      )}
    </div>
  );
}

// ── Header sub-panel ──────────────────────────────────────────────────────────

function HeaderPanel({
  header,
  onChange,
  pageCount,
}: {
  header: ReportHeader;
  onChange: (h: ReportHeader) => void;
  pageCount: number;
}) {
  const [tab, setTab] = useState<'left' | 'center' | 'right'>('left');
  const set = <K extends keyof ReportHeader>(k: K, v: ReportHeader[K]) =>
    onChange({ ...header, [k]: v });

  const currentSection: HFSection = (header[tab] as HFSection | undefined) ?? EMPTY_SECTION;
  const hasDot = (side: 'left' | 'center' | 'right') => {
    const s = header[side] as HFSection | undefined;
    return !!(s && s.type !== 'empty');
  };

  const showOn    = header.showOn ?? 'all';
  const skipPages = header.skipPages ?? [];
  const togglePage = (i: number) => {
    const next = skipPages.includes(i) ? skipPages.filter((p) => p !== i) : [...skipPages, i];
    set('skipPages', next);
  };

  return (
    <div className="space-y-3">
      <Toggle
        checked={header.enabled}
        onChange={(v) => set('enabled', v)}
        label="Enable header"
      />

      {header.enabled && (
        <>
          {/* Show on */}
          <div>
            <Label>Show on</Label>
            <select
              value={showOn}
              onChange={(e) => set('showOn', e.target.value as ReportHeader['showOn'])}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
            >
              <option value="all">All pages</option>
              <option value="except-first">All except first page</option>
              <option value="custom">Custom…</option>
            </select>
          </div>

          {showOn === 'custom' && (
            <div>
              <Label>Pages with header</Label>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: pageCount }, (_, i) => {
                  const visible = !skipPages.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => togglePage(i)}
                      title={`Page ${i + 1}: ${visible ? 'visible — click to hide' : 'hidden — click to show'}`}
                      className={cn(
                        'w-8 h-7 text-[11px] font-semibold rounded border transition-colors',
                        visible
                          ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                          : 'border-border text-text-muted bg-bg-subtle line-through',
                      )}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-snug">
                Highlighted = header shown. Click a page to toggle.
              </p>
            </div>
          )}

          {/* Height */}
          <NumInput label="Height" value={header.height} onChange={(v) => set('height', v)} min={20} max={300} />

          {/* Per-side padding */}
          <div>
            <Label>Padding</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput label="Top"    value={header.paddingTop    ?? 0}              onChange={(v) => set('paddingTop',    v)} min={0} max={60} />
              <NumInput label="Bottom" value={header.paddingBottom ?? 0}              onChange={(v) => set('paddingBottom', v)} min={0} max={60} />
              <NumInput label="Left"   value={header.paddingLeft   ?? header.padding ?? 12} onChange={(v) => set('paddingLeft',  v)} min={0} max={60} />
              <NumInput label="Right"  value={header.paddingRight  ?? header.padding ?? 12} onChange={(v) => set('paddingRight', v)} min={0} max={60} />
            </div>
          </div>

          {/* Background */}
          <div>
            <Label>Background</Label>
            <input
              type="color"
              value={header.background}
              onChange={(e) => set('background', e.target.value)}
              className="w-full h-8 rounded-md border border-border cursor-pointer"
            />
          </div>

          {/* Border bottom */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Border bottom</span>
              <Toggle checked={!!header.borderBottom} onChange={(v) => set('borderBottom', v)} label="" />
            </div>
            {header.borderBottom && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Color</Label>
                  <input
                    type="color"
                    value={header.borderColor ?? '#e5e7eb'}
                    onChange={(e) => set('borderColor', e.target.value)}
                    className="w-full h-8 rounded-md border border-border cursor-pointer"
                  />
                </div>
                <NumInput
                  label="Width"
                  value={header.borderWidth ?? 1}
                  onChange={(v) => set('borderWidth', v)}
                  min={1}
                  max={8}
                />
              </div>
            )}
          </div>

          {/* Section column tabs */}
          <SectionHeader>Content columns</SectionHeader>
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'center', 'right'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'relative py-1.5 text-[11px] font-semibold rounded-md border capitalize transition-colors',
                  tab === t
                    ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                    : 'border-border text-text-muted hover:bg-bg-hover',
                )}
              >
                {t}
                {hasDot(t) && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-500" />
                )}
              </button>
            ))}
          </div>

          <SectionEditor
            section={currentSection}
            onChange={(s) => set(tab, s)}
            showPageNumber
          />
        </>
      )}
    </div>
  );
}

// ── Footer sub-panel ──────────────────────────────────────────────────────────

function FooterPanel({
  footer,
  onChange,
  pageCount,
}: {
  footer: ReportFooter;
  onChange: (f: ReportFooter) => void;
  pageCount: number;
}) {
  const [tab, setTab] = useState<'left' | 'center' | 'right'>('right');
  const set = <K extends keyof ReportFooter>(k: K, v: ReportFooter[K]) =>
    onChange({ ...footer, [k]: v });

  const currentSection: HFSection = (footer[tab] as HFSection | undefined) ?? EMPTY_SECTION;
  const hasDot = (side: 'left' | 'center' | 'right') => {
    const s = footer[side] as HFSection | undefined;
    return !!(s && s.type !== 'empty');
  };

  const showOn    = footer.showOn ?? 'all';
  const skipPages = footer.skipPages ?? [];
  const togglePage = (i: number) => {
    const next = skipPages.includes(i) ? skipPages.filter((p) => p !== i) : [...skipPages, i];
    set('skipPages', next);
  };

  return (
    <div className="space-y-3">
      <Toggle
        checked={footer.enabled}
        onChange={(v) => set('enabled', v)}
        label="Enable footer"
      />

      {footer.enabled && (
        <>
          {/* Show on */}
          <div>
            <Label>Show on</Label>
            <select
              value={showOn}
              onChange={(e) => set('showOn', e.target.value as ReportFooter['showOn'])}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
            >
              <option value="all">All pages</option>
              <option value="except-first">All except first page</option>
              <option value="custom">Custom…</option>
            </select>
          </div>

          {showOn === 'custom' && (
            <div>
              <Label>Pages with footer</Label>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: pageCount }, (_, i) => {
                  const visible = !skipPages.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => togglePage(i)}
                      title={`Page ${i + 1}: ${visible ? 'visible — click to hide' : 'hidden — click to show'}`}
                      className={cn(
                        'w-8 h-7 text-[11px] font-semibold rounded border transition-colors',
                        visible
                          ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                          : 'border-border text-text-muted bg-bg-subtle line-through',
                      )}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-snug">
                Highlighted = footer shown. Click a page to toggle.
              </p>
            </div>
          )}

          {/* Height */}
          <NumInput label="Height" value={footer.height} onChange={(v) => set('height', v)} min={20} max={300} />

          {/* Per-side padding */}
          <div>
            <Label>Padding</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput label="Top"    value={footer.paddingTop    ?? 0}              onChange={(v) => set('paddingTop',    v)} min={0} max={60} />
              <NumInput label="Bottom" value={footer.paddingBottom ?? 0}              onChange={(v) => set('paddingBottom', v)} min={0} max={60} />
              <NumInput label="Left"   value={footer.paddingLeft   ?? footer.padding ?? 12} onChange={(v) => set('paddingLeft',  v)} min={0} max={60} />
              <NumInput label="Right"  value={footer.paddingRight  ?? footer.padding ?? 12} onChange={(v) => set('paddingRight', v)} min={0} max={60} />
            </div>
          </div>

          {/* Background */}
          <div>
            <Label>Background</Label>
            <input
              type="color"
              value={footer.background}
              onChange={(e) => set('background', e.target.value)}
              className="w-full h-8 rounded-md border border-border cursor-pointer"
            />
          </div>

          {/* Border top */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Border top</span>
              <Toggle checked={!!footer.borderTop} onChange={(v) => set('borderTop', v)} label="" />
            </div>
            {footer.borderTop && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Color</Label>
                  <input
                    type="color"
                    value={footer.borderColor ?? '#e5e7eb'}
                    onChange={(e) => set('borderColor', e.target.value)}
                    className="w-full h-8 rounded-md border border-border cursor-pointer"
                  />
                </div>
                <NumInput
                  label="Width"
                  value={footer.borderWidth ?? 1}
                  onChange={(v) => set('borderWidth', v)}
                  min={1}
                  max={8}
                />
              </div>
            )}
          </div>

          {/* Section column tabs */}
          <SectionHeader>Content columns</SectionHeader>
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'center', 'right'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'relative py-1.5 text-[11px] font-semibold rounded-md border capitalize transition-colors',
                  tab === t
                    ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                    : 'border-border text-text-muted hover:bg-bg-hover',
                )}
              >
                {t}
                {hasDot(t) && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-500" />
                )}
              </button>
            ))}
          </div>

          <SectionEditor
            section={currentSection}
            onChange={(s) => set(tab, s)}
            showPageNumber
          />
        </>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  template: ReportTemplate;
  onChange: (patch: Partial<ReportTemplate>) => void;
}

export function PageSetupPanel({ template, onChange }: Props) {
  const margins = template.margins ?? DEFAULT_MARGINS;
  const header  = template.header  ?? DEFAULT_HEADER;
  const footer  = template.footer  ?? DEFAULT_FOOTER;

  const setMargin = (k: keyof ReportMargins, v: number) =>
    onChange({ margins: { ...margins, [k]: v } });

  return (
    <div className="p-3 space-y-4">

      {/* ── Global-settings notice ─────────────────────────────────────────── */}
      <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-accent-50 dark:bg-accent-950/25 border border-accent-200 dark:border-accent-700/50">
        <Globe className="w-3 h-3 text-accent-500 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-accent-700 dark:text-accent-400 leading-snug">
          <strong>Set once — applies to all pages.</strong>{' '}
          Margins, header, and footer are shared across every page in this report.
        </p>
      </div>

      {/* Margins */}
      <SectionHeader>Page margins</SectionHeader>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <NumInput label="Top"    value={margins.top}    onChange={(v) => setMargin('top', v)} />
        <NumInput label="Bottom" value={margins.bottom} onChange={(v) => setMargin('bottom', v)} />
        <NumInput label="Left"   value={margins.left}   onChange={(v) => setMargin('left', v)} />
        <NumInput label="Right"  value={margins.right}  onChange={(v) => setMargin('right', v)} />
      </div>
      <p className="text-[10px] text-text-muted leading-relaxed">
        Margins create a safe zone around the page content and appear as dashed guides in the editor.
      </p>

      {/* Header */}
      <SectionHeader>Header</SectionHeader>
      <HeaderPanel
        header={header}
        onChange={(h) => onChange({ header: h })}
        pageCount={template.pages?.length ?? 1}
      />

      {/* Footer */}
      <SectionHeader>Footer</SectionHeader>
      <FooterPanel
        footer={footer}
        onChange={(f) => onChange({ footer: f })}
        pageCount={template.pages?.length ?? 1}
      />
    </div>
  );
}
