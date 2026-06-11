'use client';
import { useEffect, useState } from 'react';
import type { ReportElement, ReportTemplate } from '@/schemas/report';
import { SchedulePanel } from './schedule-panel';
import { RecipientsPanel } from './recipients-panel';
import { DataSourcePanel } from './data-source-panel';
import { WidgetDataSourcePanel } from './widget-datasource-panel';
import { ChartDataSourcePanel } from './chart-datasource-panel';
import { GROUPED_TABLE_DEFAULT_COLUMNS } from './element-grouped-table';
import { TextDataSourcePanel } from './text-datasource-panel';
import { runScript } from '@/lib/reports/script-runner';
import { AlignCenter, AlignLeft, AlignRight, ChevronLeft, ChevronRight, MousePointer2, PanelRightClose, PanelRightOpen, Play, Plus, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Table style presets ───────────────────────────────────────────────────────

const TABLE_PRESETS: { label: string; dot: string; patch: Record<string, unknown> }[] = [
  {
    label: 'Light',
    dot: '#f9fafb',
    patch: {
      headerBg: '#f9fafb', headerColor: '#374151', headerFontWeight: '600',
      headerTextTransform: 'none', headerBottomBorder: false,
      stripedRows: false, rowBg: '', rowAltBg: '',
      showTotalRow: false, borderColor: '#e5e7eb', borderStyle: 'solid',
      outerBorder: false, showColBorders: true, showRowBorders: true,
    },
  },
  {
    label: 'Dark Navy',
    dot: '#0f2544',
    patch: {
      headerBg: '#0f2544', headerColor: '#ffffff', headerFontWeight: '700',
      headerTextTransform: 'none', headerBottomBorder: false,
      stripedRows: false, rowBg: '', rowAltBg: '',
      showTotalRow: true, totalRowBg: '#e2e8f0', totalRowColor: '#0f2544', totalRowBold: true,
      borderColor: '#e2e8f0', borderStyle: 'solid',
      outerBorder: true, showColBorders: false, showRowBorders: true,
    },
  },
  {
    label: 'Striped',
    dot: '#1e293b',
    patch: {
      headerBg: '#1e293b', headerColor: '#ffffff', headerFontWeight: '600',
      headerTextTransform: 'none', headerBottomBorder: false,
      stripedRows: true, rowBg: '#ffffff', rowAltBg: '#f8fafc',
      showTotalRow: false, borderColor: '#e2e8f0', borderStyle: 'solid',
      outerBorder: false, showColBorders: false, showRowBorders: true,
    },
  },
  {
    label: 'Minimal',
    dot: '#ffffff',
    patch: {
      headerBg: 'transparent', headerColor: '#6b7280', headerFontWeight: '600',
      headerTextTransform: 'uppercase', headerBottomBorder: true, headerBottomBorderColor: '#e5e7eb',
      stripedRows: false, rowBg: '', rowAltBg: '',
      showTotalRow: false, borderColor: '#e5e7eb', borderStyle: 'solid',
      outerBorder: false, showColBorders: false, showRowBorders: true,
    },
  },
  {
    label: 'Violet',
    dot: '#6366f1',
    patch: {
      headerBg: '#6366f1', headerColor: '#ffffff', headerFontWeight: '600',
      headerTextTransform: 'none', headerBottomBorder: false,
      stripedRows: true, rowBg: '#ffffff', rowAltBg: '#ede9fe',
      showTotalRow: false, borderColor: '#c4b5fd', borderStyle: 'solid',
      outerBorder: true, showColBorders: false, showRowBorders: true,
    },
  },
  {
    label: 'Forest',
    dot: '#166534',
    patch: {
      headerBg: '#166534', headerColor: '#ffffff', headerFontWeight: '700',
      headerTextTransform: 'none', headerBottomBorder: false,
      stripedRows: true, rowBg: '#ffffff', rowAltBg: '#f0fdf4',
      showTotalRow: true, totalRowBg: '#dcfce7', totalRowColor: '#166534', totalRowBold: true,
      borderColor: '#d1fae5', borderStyle: 'solid',
      outerBorder: true, showColBorders: false, showRowBorders: true,
    },
  },
];

type Tab = 'element' | 'datasource' | 'schedule' | 'recipients';

interface Props {
  selected: ReportElement | null;
  template: ReportTemplate;
  onElementChange: (props: Record<string, unknown>) => void;
  onTemplateChange: (patch: Partial<ReportTemplate>) => void;
  wide?: boolean;
  onToggleWide?: () => void;
}

// ── Shared micro-components ───────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
      {children}
    </span>
  );
}

function PanelInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full min-w-0 px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors',
        props.className,
      )}
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 rounded-md border border-border cursor-pointer"
    />
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn('flex items-center gap-2 select-none', disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}>
      <div
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'w-8 h-4 rounded-full relative transition-colors',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
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
      <span className="text-xs text-text-sub">{label}</span>
    </label>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PropertiesPanel({ selected, template, onElementChange, onTemplateChange, wide, onToggleWide }: Props) {
  const [tab, setTab] = useState<Tab>('element');
  const [scriptOutput, setScriptOutput] = useState<string | null>(null);
  const p = selected?.props as Record<string, unknown> | undefined;

  // Reset to Element tab whenever a different element is selected
  useEffect(() => { setTab('element'); }, [selected?.id]);

  const set = (patch: Partial<Record<string, unknown>>) =>
    onElementChange({ ...(p ?? {}), ...patch });

  const isTable       = selected?.type === 'table';
  const isWidget      = selected?.type === 'data-widget';
  const isChart       = selected?.type === 'chart';
  const isText        = selected?.type === 'text' || selected?.type === 'heading';
  const isProgressBar = selected?.type === 'progress-bar';
  const isGroupedTable   = selected?.type === 'grouped-table';
  const hasDatasourceTab = isTable || isWidget || isChart || isText;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'element',    label: 'Element' },
    ...(hasDatasourceTab ? [{ id: 'datasource' as Tab, label: 'Data Source' }] : []),
    { id: 'schedule',   label: 'Schedule' },
    { id: 'recipients', label: 'Recipients' },
  ];

  return (
    <div className="w-full h-full bg-bg-card border-l border-border flex flex-col text-sm overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-border flex-shrink-0 items-stretch">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 py-2.5 text-[11px] font-semibold transition-colors border-b-2 overflow-hidden',
              tab === t.id
                ? 'border-accent-600 text-accent-700 dark:text-accent-400'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            <span className="block truncate">{t.label}</span>
          </button>
        ))}
        {onToggleWide && (
          <button
            onClick={onToggleWide}
            title={wide ? 'Narrow panel' : 'Widen panel'}
            className="flex-shrink-0 px-2 border-b-2 border-transparent text-text-muted hover:text-accent-600 transition-colors"
          >
            {wide
              ? <PanelRightClose className="w-3.5 h-3.5" />
              : <PanelRightOpen className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
        {/* ── Element tab ── */}
        {tab === 'element' && (
          <div className="p-3 space-y-3">
            {!selected && (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-text-muted">
                <MousePointer2 className="w-7 h-7 opacity-30" />
                <p className="text-xs text-center leading-relaxed opacity-60">
                  Click an element to edit its properties
                </p>
              </div>
            )}

            {selected && (
              <>
                {/* Transform */}
                <SectionHeader>Transform</SectionHeader>
                <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                  {([
                    { key: '_x', label: 'X', val: Math.round(selected.x) },
                    { key: '_y', label: 'Y', val: Math.round(selected.y) },
                    { key: '_w', label: 'W', val: Math.round(selected.w) },
                    { key: '_h', label: 'H', val: Math.round(selected.h) },
                  ] as const).map(({ key, label, val }) => {
                    const isAutoW = key === '_w' && !!(p as Record<string, unknown>)?.autoWidth;
                    return (
                    <div key={key}>
                      <Label>{label}{isAutoW ? ' (auto)' : ''}</Label>
                      <PanelInput
                        type="number"
                        value={val}
                        disabled={isAutoW}
                        onChange={(e) => onElementChange({ ...p, [key]: Number(e.target.value) })}
                        className={isAutoW ? 'opacity-40 cursor-not-allowed' : ''}
                      />
                    </div>
                    );
                  })}
                </div>
                <div>
                  <Label>Rotation °</Label>
                  <PanelInput
                    type="number"
                    value={selected.rotation ?? 0}
                    onChange={(e) => onElementChange({ ...p, _rotation: Number(e.target.value) })}
                    min={-360} max={360}
                  />
                </div>

                {/* ── Text / Heading ── */}
                {(selected.type === 'text' || selected.type === 'heading') && (
                  <>
                    <SectionHeader>Content</SectionHeader>
                    <div>
                      <textarea
                        value={(p?.content as string) ?? ''}
                        onChange={(e) => set({ content: e.target.value })}
                        rows={4}
                        placeholder="Type your text here… (or double-click element on canvas)"
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors resize-none leading-relaxed"
                      />
                    </div>
                    <Toggle
                      checked={!!(p?.autoWidth)}
                      onChange={(v) => set({ autoWidth: v })}
                      label="Auto width (fit text)"
                    />

                    <SectionHeader>Typography</SectionHeader>
                    <div>
                      <Label>Font family</Label>
                      <select
                        value={(p?.fontFamily as string) ?? ''}
                        onChange={(e) => set({ fontFamily: e.target.value || undefined })}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      >
                        <option value="">Default (Inter)</option>
                        <optgroup label="Khmer">
                          <option value="var(--font-koh-santepheap), 'Koh Santepheap', sans-serif">Koh Santepheap</option>
                          <option value="var(--font-khmer), 'Kantumruy Pro', sans-serif">Kantumruy Pro</option>
                        </optgroup>
                        <optgroup label="Latin">
                          <option value="Arial, sans-serif">Arial</option>
                          <option value="'Helvetica Neue', Helvetica, sans-serif">Helvetica</option>
                          <option value="Georgia, serif">Georgia</option>
                          <option value="'Times New Roman', Times, serif">Times New Roman</option>
                          <option value="'Courier New', Courier, monospace">Courier New</option>
                          <option value="Impact, Charcoal, sans-serif">Impact</option>
                          <option value="Verdana, Geneva, sans-serif">Verdana</option>
                          <option value="Tahoma, Geneva, sans-serif">Tahoma</option>
                          <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
                        </optgroup>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Size</Label>
                        <PanelInput
                          type="number"
                          value={(p?.fontSize as number) ?? (selected.type === 'heading' ? 28 : 14)}
                          onChange={(e) => set({ fontSize: Number(e.target.value) })}
                          min={8} max={120}
                        />
                      </div>
                      <div>
                        <Label>Line height</Label>
                        <PanelInput
                          type="number"
                          value={(p?.lineHeight as number) ?? (selected.type === 'heading' ? 1.2 : 1.5)}
                          onChange={(e) => set({ lineHeight: Number(e.target.value) })}
                          min={0.8} max={4} step={0.1}
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Letter spacing</Label>
                      <PanelInput
                        type="number"
                        value={(p?.letterSpacing as number) ?? 0}
                        onChange={(e) => set({ letterSpacing: Number(e.target.value) })}
                        min={-5} max={20} step={0.5}
                      />
                    </div>

                    <div>
                      <Label>Color</Label>
                      <ColorInput
                        value={(p?.color as string) ?? '#111111'}
                        onChange={(v) => set({ color: v })}
                      />
                    </div>

                    <div>
                      <Label>Background</Label>
                      <ColorInput
                        value={(p?.background as string) ?? '#ffffff'}
                        onChange={(v) => set({ background: v === '#ffffff' ? 'transparent' : v })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Pad X</Label>
                        <PanelInput
                          type="number"
                          value={(p?.paddingX as number) ?? 0}
                          onChange={(e) => set({ paddingX: Number(e.target.value) })}
                          min={0} max={60}
                        />
                      </div>
                      <div>
                        <Label>Pad Y</Label>
                        <PanelInput
                          type="number"
                          value={(p?.paddingY as number) ?? 0}
                          onChange={(e) => set({ paddingY: Number(e.target.value) })}
                          min={0} max={60}
                        />
                      </div>
                    </div>

                    {/* Style toggles */}
                    <div>
                      <Label>Style</Label>
                      <div className="flex gap-1">
                        {(['bold', 'italic', 'underline'] as const).map((f) => (
                          <button
                            key={f}
                            onClick={() => set({ [f]: !p?.[f] })}
                            className={cn(
                              'flex-1 py-1.5 text-xs rounded-md border transition-colors font-medium',
                              p?.[f]
                                ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                : 'border-border text-text-muted hover:text-text',
                            )}
                          >
                            {f === 'bold' ? 'B' : f === 'italic' ? 'I' : 'U'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Bold weight — only shown when bold is active */}
                    {p?.bold && (
                      <div>
                        <Label>Bold weight</Label>
                        <div className="flex gap-1">
                          {([
                            { w: 500, label: '500' },
                            { w: 600, label: '600' },
                            { w: 700, label: '700' },
                            { w: 800, label: '800' },
                          ] as const).map(({ w, label }) => (
                            <button
                              key={w}
                              onClick={() => set({ boldWeight: w })}
                              className={cn(
                                'flex-1 py-1.5 text-xs rounded-md border transition-colors',
                                ((p?.boldWeight as number) ?? 600) === w
                                  ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                  : 'border-border text-text-muted hover:text-text',
                              )}
                              style={{ fontWeight: w }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <Label>Align</Label>
                      <div className="flex gap-1">
                        {([
                          { v: 'left',   Icon: AlignLeft },
                          { v: 'center', Icon: AlignCenter },
                          { v: 'right',  Icon: AlignRight },
                        ] as const).map(({ v, Icon }) => (
                          <button
                            key={v}
                            onClick={() => set({ textAlign: v })}
                            className={cn(
                              'flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors',
                              (p?.textAlign ?? 'left') === v
                                ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                : 'border-border text-text-muted hover:text-text',
                            )}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Shape ── */}
                {selected.type === 'shape' && (
                  <>
                    <SectionHeader>Shape</SectionHeader>
                    <div>
                      <Label>Type</Label>
                      <select
                        value={(p?.shape as string) ?? 'rect'}
                        onChange={(e) => set({ shape: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      >
                        <option value="rect">Rectangle</option>
                        <option value="circle">Circle</option>
                        <option value="triangle">Triangle</option>
                        <option value="line">Line</option>
                      </select>
                    </div>

                    <div>
                      <Label>Fill color</Label>
                      <ColorInput
                        value={(p?.fill as string) ?? '#6366f1'}
                        onChange={(v) => set({ fill: v })}
                      />
                    </div>

                    {(p?.shape as string) === 'rect' && (
                      <div>
                        <Label>Corner radius</Label>
                        <PanelInput
                          type="number"
                          value={(p?.borderRadius as number) ?? 4}
                          onChange={(e) => set({ borderRadius: Number(e.target.value) })}
                          min={0} max={200}
                        />
                      </div>
                    )}

                    <SectionHeader>Stroke</SectionHeader>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Color</Label>
                        <ColorInput
                          value={(p?.stroke as string) ?? '#6366f1'}
                          onChange={(v) => set({ stroke: v })}
                        />
                      </div>
                      <div>
                        <Label>Width</Label>
                        <PanelInput
                          type="number"
                          value={(p?.strokeWidth as number) ?? 0}
                          onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
                          min={0} max={20}
                        />
                      </div>
                    </div>

                    <SectionHeader>Effects</SectionHeader>
                    <div>
                      <Label>Opacity %</Label>
                      <PanelInput
                        type="number"
                        value={Math.round(((p?.opacity as number) ?? 1) * 100)}
                        onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                        min={0} max={100}
                      />
                    </div>
                    <Toggle
                      checked={!!(p?.shadow)}
                      onChange={(v) => set({ shadow: v })}
                      label="Drop shadow"
                    />
                    <Toggle
                      checked={!!(p?.gradient)}
                      onChange={(v) => set({ gradient: v })}
                      label="Gradient fill"
                    />
                    {p?.gradient && (
                      <>
                        <div>
                          <Label>Gradient end</Label>
                          <ColorInput
                            value={(p?.gradientEnd as string) ?? '#a855f7'}
                            onChange={(v) => set({ gradientEnd: v })}
                          />
                        </div>
                        <div>
                          <Label>Direction</Label>
                          <select
                            value={(p?.gradientDir as string) ?? 'to right'}
                            onChange={(e) => set({ gradientDir: e.target.value })}
                            className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                          >
                            <option value="to right">→ Horizontal</option>
                            <option value="to bottom">↓ Vertical</option>
                            <option value="to bottom right">↘ Diagonal</option>
                          </select>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ── Image ── */}
                {selected.type === 'image' && (
                  <>
                    <SectionHeader>Image</SectionHeader>
                    <div>
                      <Label>Upload file</Label>
                      <label className="flex items-center justify-center gap-2 w-full py-2 rounded-md border border-dashed border-border bg-bg-input hover:border-accent-400 cursor-pointer text-xs text-text-muted hover:text-accent-600 transition-colors">
                        <Upload className="w-3.5 h-3.5" />
                        Choose image
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => set({ src: ev.target?.result as string });
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-text-muted flex-shrink-0">or URL</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div>
                      <PanelInput
                        type="text"
                        value={((p?.src as string) ?? '').startsWith('data:') ? '' : ((p?.src as string) ?? '')}
                        onChange={(e) => set({ src: e.target.value })}
                        placeholder="https://example.com/image.png"
                      />
                    </div>
                    <div>
                      <Label>Caption</Label>
                      <PanelInput
                        type="text"
                        value={(p?.caption as string) ?? ''}
                        onChange={(e) => set({ caption: e.target.value })}
                        placeholder="Optional caption"
                      />
                    </div>
                    <div>
                      <Label>Fit</Label>
                      <select
                        value={(p?.objectFit as string) ?? 'cover'}
                        onChange={(e) => set({ objectFit: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      >
                        <option value="cover">Cover</option>
                        <option value="contain">Contain</option>
                        <option value="fill">Fill</option>
                      </select>
                    </div>
                    <div>
                      <Label>Corner radius</Label>
                      <PanelInput
                        type="number"
                        value={(p?.borderRadius as number) ?? 0}
                        onChange={(e) => set({ borderRadius: Number(e.target.value) })}
                        min={0} max={200}
                      />
                    </div>
                    <div>
                      <Label>Opacity %</Label>
                      <PanelInput
                        type="number"
                        value={Math.round(((p?.opacity as number) ?? 1) * 100)}
                        onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                        min={0} max={100}
                      />
                    </div>
                    <Toggle
                      checked={!!(p?.border)}
                      onChange={(v) => set({ border: v })}
                      label="Show border"
                    />
                    {p?.border && (
                      <div className="grid grid-cols-2 gap-x-2">
                        <div>
                          <Label>Color</Label>
                          <ColorInput
                            value={(p?.borderColor as string) ?? '#e5e7eb'}
                            onChange={(v) => set({ borderColor: v })}
                          />
                        </div>
                        <div>
                          <Label>Width</Label>
                          <PanelInput
                            type="number"
                            value={(p?.borderWidth as number) ?? 2}
                            onChange={(e) => set({ borderWidth: Number(e.target.value) })}
                            min={1} max={16}
                          />
                        </div>
                      </div>
                    )}

                    <SectionHeader>Effects</SectionHeader>
                    <Toggle
                      checked={!!(p?.removeBackground)}
                      onChange={(v) => set({ removeBackground: v })}
                      label="Remove white background"
                    />
                    {p?.removeBackground && (
                      <p className="text-[10px] text-text-muted leading-relaxed -mt-1">
                        Blends the image with the page so white areas become transparent. Works best for logos and charts on white backgrounds.
                      </p>
                    )}
                  </>
                )}

                {/* ── Divider ── */}
                {selected.type === 'divider' && (
                  <>
                    <SectionHeader>Divider</SectionHeader>
                    <div>
                      <Label>Color</Label>
                      <ColorInput
                        value={(p?.color as string) ?? '#e5e7eb'}
                        onChange={(v) => set({ color: v })}
                      />
                    </div>
                    <div>
                      <Label>Thickness</Label>
                      <PanelInput
                        type="number"
                        value={(p?.thickness as number) ?? 1}
                        onChange={(e) => set({ thickness: Number(e.target.value) })}
                        min={1} max={20}
                      />
                    </div>
                    <div>
                      <Label>Style</Label>
                      <select
                        value={(p?.style as string) ?? 'solid'}
                        onChange={(e) => set({ style: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      >
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                      </select>
                    </div>
                    <div>
                      <Label>Label text</Label>
                      <PanelInput
                        type="text"
                        value={(p?.label as string) ?? ''}
                        onChange={(e) => set({ label: e.target.value })}
                        placeholder="Optional center label"
                      />
                    </div>
                  </>
                )}

                {/* ── Table ── */}
                {selected.type === 'table' && (() => {
                  const tCols       = (p?.columns as string[]) ?? [];
                  const colAligns   = (p?.colAligns as Record<string, string>) ?? {};
                  const colWidths   = (p?.colWidths as Record<string, number>) ?? {};
                  const colBgs      = (p?.colBgs as Record<string, string>) ?? {};
                  const colFormats    = (p?.colFormats    as Record<string, string>) ?? {};
                  const colLabels    = (p?.colLabels    as Record<string, string>) ?? {};
                  const colSubLabels = (p?.colSubLabels as Record<string, string>) ?? {};
                  const colFontSizes    = (p?.colFontSizes    as Record<string, number>) ?? {};
                  const colTextColors   = (p?.colTextColors   as Record<string, string>) ?? {};
                  const colFontFamilies = (p?.colFontFamilies as Record<string, string>) ?? {};
                  const statusCols  = (p?.statusColumns as string[]) ?? [];
                  const statusClrs  = (p?.statusColors as Record<string, string>) ?? {};

                  // Rename only updates the display label — the field key (used for data
                  // lookup) stays unchanged so datasource rows keep working after refresh.
                  const renameCol = (fieldKey: string, label: string) => {
                    const nx = { ...colLabels };
                    if (!label || label === fieldKey) {
                      delete nx[fieldKey]; // clear override → fall back to field key
                    } else {
                      nx[fieldKey] = label;
                    }
                    set({ colLabels: nx });
                  };

                  const deleteCol = (name: string) => {
                    const cols = tCols.filter((c) => c !== name);
                    const rows = ((p?.rows as Record<string, string>[]) ?? []).map((row) => { const r = { ...row }; delete r[name]; return r; });
                    const nextAligns      = { ...colAligns };      delete nextAligns[name];
                    const nextWidths      = { ...colWidths };      delete nextWidths[name];
                    const nextBgs         = { ...colBgs };         delete nextBgs[name];
                    const nextFormats     = { ...colFormats };     delete nextFormats[name];
                    const nextLabels      = { ...colLabels };      delete nextLabels[name];
                    const nextSubLabels   = { ...colSubLabels };   delete nextSubLabels[name];
                    const nextFontSizes   = { ...colFontSizes };   delete nextFontSizes[name];
                    const nextTextColors  = { ...colTextColors };  delete nextTextColors[name];
                    const nextFontFamilies = { ...colFontFamilies }; delete nextFontFamilies[name];
                    const nextStCols      = statusCols.filter((c) => c !== name);
                    set({ columns: cols, rows, colAligns: nextAligns, colWidths: nextWidths, colBgs: nextBgs, colFormats: nextFormats, colLabels: nextLabels, colSubLabels: nextSubLabels, colFontSizes: nextFontSizes, colTextColors: nextTextColors, colFontFamilies: nextFontFamilies, statusColumns: nextStCols });
                  };

                  const moveCol = (name: string, dir: -1 | 1) => {
                    const cols = [...tCols];
                    const idx  = cols.indexOf(name);
                    const to   = idx + dir;
                    if (to < 0 || to >= cols.length) return;
                    [cols[idx], cols[to]] = [cols[to], cols[idx]];
                    set({ columns: cols });
                  };

                  return (
                    <>
                      {/* Style Presets */}
                      <SectionHeader>Style Preset</SectionHeader>
                      <div className="grid grid-cols-3 gap-1">
                        {TABLE_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            onClick={() => set(preset.patch)}
                            title={preset.label}
                            className="flex items-center gap-1 px-2 py-1.5 text-[10px] rounded-md border border-border text-text-muted hover:text-text hover:border-accent-400 transition-colors truncate"
                          >
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-black/10" style={{ background: preset.dot }} />
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Header */}
                      <SectionHeader>Header</SectionHeader>
                      <div className="grid grid-cols-2 gap-x-2">
                        <div>
                          <Label>Background</Label>
                          <ColorInput value={(p?.headerBg as string) || '#f9fafb'} onChange={(v) => set({ headerBg: v })} />
                        </div>
                        <div>
                          <Label>Text color</Label>
                          <ColorInput value={(p?.headerColor as string) || '#374151'} onChange={(v) => set({ headerColor: v })} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2">
                        <div>
                          <Label>Font size</Label>
                          <PanelInput type="number" value={(p?.headerFontSize as number) ?? (p?.fontSize as number) ?? 12} onChange={(e) => set({ headerFontSize: Number(e.target.value) })} min={8} max={24} />
                        </div>
                        <div>
                          <Label>Weight</Label>
                          <select value={(p?.headerFontWeight as string) ?? '600'} onChange={(e) => set({ headerFontWeight: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                            <option value="400">Normal</option>
                            <option value="600">Semi-bold</option>
                            <option value="700">Bold</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2">
                        <div>
                          <Label>Transform</Label>
                          <select value={(p?.headerTextTransform as string) ?? 'none'} onChange={(e) => set({ headerTextTransform: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                            <option value="none">None</option>
                            <option value="uppercase">UPPER</option>
                            <option value="capitalize">Title</option>
                          </select>
                        </div>
                        <div>
                          <Label>Pad Y</Label>
                          <PanelInput type="number" value={(p?.headerPaddingY as number) ?? 8} onChange={(e) => set({ headerPaddingY: Number(e.target.value) })} min={2} max={32} />
                        </div>
                      </div>
                      <div>
                        <Label>Align</Label>
                        <div className="flex gap-1">
                          {(['left', 'center', 'right'] as const).map((a) => {
                            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
                            return (
                              <button key={a} onClick={() => set({ headerTextAlign: a })} className={cn('flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors', (p?.headerTextAlign ?? 'left') === a ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400' : 'border-border text-text-muted hover:text-text')}>
                                <Icon className="w-3 h-3" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <Toggle checked={!!(p?.headerBottomBorder)} onChange={(v) => set({ headerBottomBorder: v })} label="Bottom accent border" />
                      {!!(p?.headerBottomBorder) && (
                        <div>
                          <Label>Accent color</Label>
                          <ColorInput value={(p?.headerBottomBorderColor as string) || '#e5e7eb'} onChange={(v) => set({ headerBottomBorderColor: v })} />
                        </div>
                      )}
                      <Toggle checked={!!(p?.headerWrapText)} onChange={(v) => set({ headerWrapText: v })} label="Wrap header text" />

                      {/* Rows */}
                      <SectionHeader>Rows</SectionHeader>
                      <Toggle checked={!!(p?.stripedRows)} onChange={(v) => set({ stripedRows: v })} label="Striped rows" />
                      {p?.stripedRows ? (
                        <div className="grid grid-cols-2 gap-x-2">
                          <div>
                            <Label>Odd row</Label>
                            <ColorInput value={(p?.rowBg as string) || '#ffffff'} onChange={(v) => set({ rowBg: v === '#ffffff' ? '' : v })} />
                          </div>
                          <div>
                            <Label>Even row</Label>
                            <ColorInput value={(p?.rowAltBg as string) || '#f8fafc'} onChange={(v) => set({ rowAltBg: v })} />
                          </div>
                        </div>
                      ) : (
                        <div>
                          <Label>Row background</Label>
                          <ColorInput value={(p?.rowBg as string) || '#ffffff'} onChange={(v) => set({ rowBg: v === '#ffffff' ? '' : v })} />
                        </div>
                      )}

                      {/* Total Row */}
                      <SectionHeader>Total Row</SectionHeader>
                      <Toggle checked={!!(p?.showTotalRow)} onChange={(v) => set({ showTotalRow: v })} label="Highlight last row" />
                      {!!(p?.showTotalRow) && (
                        <>
                          <div className="grid grid-cols-2 gap-x-2">
                            <div>
                              <Label>Background</Label>
                              <ColorInput value={(p?.totalRowBg as string) || '#f1f5f9'} onChange={(v) => set({ totalRowBg: v })} />
                            </div>
                            <div>
                              <Label>Text color</Label>
                              <ColorInput value={(p?.totalRowColor as string) || '#0f172a'} onChange={(v) => set({ totalRowColor: v })} />
                            </div>
                          </div>
                          <Toggle checked={(p?.totalRowBold as boolean) !== false} onChange={(v) => set({ totalRowBold: v })} label="Bold text" />
                        </>
                      )}

                      {/* Footer Row */}
                      <SectionHeader>Footer Row</SectionHeader>
                      <Toggle checked={!!(p?.footerRowEnabled)} onChange={(v) => set({ footerRowEnabled: v })} label="Add summary footer row" />
                      {!!(p?.footerRowEnabled) && (() => {
                        const footerCells = (p?.footerCells as Record<string, { fn: string; custom?: string; decimals?: number }>) ?? {};
                        const FOOTER_FNS = ['none', 'sum', 'count', 'avg', 'min', 'max', 'custom'] as const;
                        return (
                          <>
                            <div>
                              <Label>Label text</Label>
                              <PanelInput
                                type="text"
                                value={(p?.footerRowLabel as string) ?? 'Total'}
                                onChange={(e) => set({ footerRowLabel: e.target.value })}
                                placeholder="Total"
                              />
                            </div>

                            {tCols.length > 0 && (
                              <div>
                                <Label>Per-column aggregate</Label>
                                <div className="flex flex-col gap-1 mt-1">
                                  {tCols.map((col) => {
                                    const cfg = footerCells[col] ?? { fn: 'none' };
                                    return (
                                      <div key={col} className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[10px] text-text-muted truncate flex-1 min-w-0">{col}</span>
                                        <select
                                          data-no-csel
                                          value={cfg.fn}
                                          onChange={(e) => set({ footerCells: { ...footerCells, [col]: { ...cfg, fn: e.target.value } } })}
                                          className="text-[10px] px-1.5 py-1 rounded border border-border bg-bg-input flex-shrink-0 w-20"
                                        >
                                          {FOOTER_FNS.map(fn => (
                                            <option key={fn} value={fn}>{fn === 'none' ? 'None' : fn.toUpperCase()}</option>
                                          ))}
                                        </select>
                                        {cfg.fn === 'custom' && (
                                          <input
                                            type="text"
                                            value={cfg.custom ?? ''}
                                            onChange={(e) => set({ footerCells: { ...footerCells, [col]: { ...cfg, custom: e.target.value } } })}
                                            placeholder="text"
                                            className="text-[10px] px-1.5 py-1 rounded border border-border bg-bg-input flex-shrink-0 w-16"
                                          />
                                        )}
                                        {['sum', 'avg', 'min', 'max'].includes(cfg.fn) && (
                                          <input
                                            type="number"
                                            value={cfg.decimals ?? 2}
                                            onChange={(e) => set({ footerCells: { ...footerCells, [col]: { ...cfg, decimals: Number(e.target.value) } } })}
                                            title="Decimal places"
                                            min={0}
                                            max={8}
                                            className="text-[10px] px-1 py-1 rounded border border-border bg-bg-input flex-shrink-0 w-10"
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-x-2">
                              <div>
                                <Label>Background</Label>
                                <ColorInput value={(p?.footerRowBg as string) || '#f1f5f9'} onChange={(v) => set({ footerRowBg: v })} />
                              </div>
                              <div>
                                <Label>Text color</Label>
                                <ColorInput value={(p?.footerRowColor as string) || '#0f172a'} onChange={(v) => set({ footerRowColor: v })} />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 items-end">
                              <div>
                                <Label>Font size (px)</Label>
                                <PanelInput
                                  type="number"
                                  value={(p?.footerRowFontSize as number) ?? ''}
                                  onChange={(e) => set({ footerRowFontSize: e.target.value ? Number(e.target.value) : undefined })}
                                  placeholder="auto"
                                  min={7}
                                  max={48}
                                />
                              </div>
                              <Toggle checked={(p?.footerRowBold as boolean) !== false} onChange={(v) => set({ footerRowBold: v })} label="Bold" />
                            </div>
                          </>
                        );
                      })()}

                      {/* Cell padding */}
                      <SectionHeader>Cell Padding</SectionHeader>
                      <div className="grid grid-cols-2 gap-x-2">
                        <div>
                          <Label>Pad X</Label>
                          <PanelInput type="number" value={(p?.cellPaddingX as number) ?? 12} onChange={(e) => set({ cellPaddingX: Number(e.target.value) })} min={2} max={40} />
                        </div>
                        <div>
                          <Label>Pad Y</Label>
                          <PanelInput type="number" value={(p?.cellPaddingY as number) ?? 6} onChange={(e) => set({ cellPaddingY: Number(e.target.value) })} min={2} max={40} />
                        </div>
                      </div>

                      {/* Borders */}
                      <SectionHeader>Borders</SectionHeader>
                      <div className="grid grid-cols-3 gap-x-2">
                        <div>
                          <Label>Color</Label>
                          <ColorInput value={(p?.borderColor as string) || '#e5e7eb'} onChange={(v) => set({ borderColor: v })} />
                        </div>
                        <div>
                          <Label>Style</Label>
                          <select value={(p?.borderStyle as string) ?? 'solid'} onChange={(e) => set({ borderStyle: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                          </select>
                        </div>
                        <div>
                          <Label>Width</Label>
                          <PanelInput type="number" value={(p?.borderWidth as number) ?? 1} onChange={(e) => set({ borderWidth: Number(e.target.value) })} min={0} max={6} step={0.25} />
                        </div>
                      </div>
                      <Toggle checked={!!(p?.outerBorder)} onChange={(v) => set({ outerBorder: v })} label="Outer border" />
                      <Toggle checked={(p?.showColBorders as boolean) !== false} onChange={(v) => set({ showColBorders: v })} label="Column borders" />
                      <Toggle checked={(p?.showRowBorders as boolean) !== false} onChange={(v) => set({ showRowBorders: v })} label="Row borders" />
                      <Toggle checked={!!(p?.headerBottomBorder)} onChange={(v) => set({ headerBottomBorder: v })} label="Header bottom line" />
                      {!!(p?.headerBottomBorder) && (
                        <div>
                          <Label>Header line color</Label>
                          <ColorInput value={(p?.headerBottomBorderColor as string) || '#e5e7eb'} onChange={(v) => set({ headerBottomBorderColor: v })} />
                        </div>
                      )}

                      {/* Row Height */}
                      <SectionHeader>Row Height</SectionHeader>
                      <Toggle checked={!!(p?.equalRowHeight)} onChange={(v) => set({ equalRowHeight: v, rowHeight: v ? ((p?.rowHeight as number) ?? 36) : undefined })} label="Equal row height" />
                      {!!(p?.equalRowHeight) && (
                        <div>
                          <Label>Row height (px)</Label>
                          <PanelInput type="number" value={(p?.rowHeight as number) ?? 36} onChange={(e) => set({ rowHeight: Number(e.target.value) })} min={20} max={200} />
                        </div>
                      )}

                      {/* Font */}
                      <SectionHeader>Font</SectionHeader>
                      <div>
                        <Label>Family</Label>
                        <select value={(p?.fontFamily as string) ?? ''} onChange={(e) => set({ fontFamily: e.target.value || undefined })} className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                          <option value="">Default (Inter)</option>
                          <optgroup label="Khmer">
                            <option value="var(--font-koh-santepheap), 'Koh Santepheap', sans-serif">Koh Santepheap</option>
                            <option value="var(--font-khmer), 'Kantumruy Pro', sans-serif">Kantumruy Pro</option>
                          </optgroup>
                          <optgroup label="Latin">
                            <option value="Arial, sans-serif">Arial</option>
                            <option value="Georgia, serif">Georgia</option>
                            <option value="'Times New Roman', serif">Times New Roman</option>
                            <option value="'Courier New', monospace">Courier New</option>
                            <option value="Verdana, sans-serif">Verdana</option>
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <Label>Body font size</Label>
                        <PanelInput type="number" value={(p?.fontSize as number) ?? 12} onChange={(e) => set({ fontSize: Number(e.target.value) })} min={8} max={20} />
                      </div>

                      {/* Row numbers */}
                      <SectionHeader>Row Numbers</SectionHeader>
                      <Toggle checked={!!(p?.showRowNumbers)} onChange={(v) => set({ showRowNumbers: v })} label="Show row numbers" />
                      {!!(p?.showRowNumbers) && (
                        <div>
                          <Label>Header label</Label>
                          <PanelInput value={(p?.rowNumberLabel as string) ?? '#'} onChange={(e) => set({ rowNumberLabel: e.target.value })} placeholder="#" />
                        </div>
                      )}

                      {/* Column settings */}
                      {tCols.length > 0 && (
                        <>
                          <SectionHeader>Column Settings</SectionHeader>
                          <p className="text-[9px] text-text-muted -mt-1">Align · Width % · Bg</p>
                          <div className="space-y-2">
                            {tCols.map((col, ci) => (
                              <div key={col}>
                                {/* Column name + move buttons */}
                                <div className="flex items-center gap-1 mb-0.5">
                                  <p className="text-[9px] font-semibold text-text-muted truncate flex-1 min-w-0">{col}</p>
                                  <button
                                    onClick={() => moveCol(col, -1)}
                                    disabled={ci === 0}
                                    title="Move left"
                                    className="flex items-center justify-center w-5 h-5 rounded border border-border text-text-muted hover:text-accent-600 hover:border-accent-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                                  >
                                    <ChevronLeft className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => moveCol(col, 1)}
                                    disabled={ci === tCols.length - 1}
                                    title="Move right"
                                    className="flex items-center justify-center w-5 h-5 rounded border border-border text-text-muted hover:text-accent-600 hover:border-accent-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                                  >
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                </div>
                                {/* Column style controls */}
                                <div className="flex gap-1 items-center">
                                  <select
                                    value={colAligns[col] ?? 'left'}
                                    onChange={(e) => set({ colAligns: { ...colAligns, [col]: e.target.value } })}
                                    className="flex-1 px-1 py-1 text-[10px] rounded border border-border bg-bg-input focus:outline-none min-w-0"
                                  >
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                  </select>
                                  <input
                                    type="number"
                                    placeholder="W%"
                                    value={colWidths[col] ?? ''}
                                    onChange={(e) => {
                                      const v  = e.target.value === '' ? undefined : Number(e.target.value);
                                      const nx = { ...colWidths };
                                      if (v == null) delete nx[col]; else nx[col] = v;
                                      set({ colWidths: nx });
                                    }}
                                    min={5} max={100}
                                    className="w-12 px-1 py-1 text-[10px] rounded border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                                  />
                                  <input
                                    type="color"
                                    title="Column background"
                                    value={colBgs[col] ?? '#ffffff'}
                                    onChange={(e) => {
                                      const nx = { ...colBgs };
                                      if (e.target.value === '#ffffff') delete nx[col]; else nx[col] = e.target.value;
                                      set({ colBgs: nx });
                                    }}
                                    className="w-7 h-7 rounded border border-border cursor-pointer flex-shrink-0 p-0"
                                  />
                                </div>
                                {/* Number format */}
                                <select
                                  value={colFormats[col] ?? 'none'}
                                  onChange={(e) => {
                                    const nx = { ...colFormats };
                                    if (e.target.value === 'none') delete nx[col]; else nx[col] = e.target.value;
                                    set({ colFormats: nx });
                                  }}
                                  className="w-full mt-0.5 px-1 py-1 text-[10px] rounded border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                                >
                                  <option value="none">— No format</option>
                                  <option value="int">1,234,567</option>
                                  <option value="dec1">1,234,567.0</option>
                                  <option value="dec2">1,234,567.00</option>
                                  <option value="dec3">1,234,567.000</option>
                                  <option value="pct">12.5%</option>
                                </select>
                                {/* Sub-label (small text below header) */}
                                <PanelInput
                                  value={colSubLabels[col] ?? ''}
                                  onChange={(e) => {
                                    const nx = { ...colSubLabels };
                                    if (!e.target.value) delete nx[col]; else nx[col] = e.target.value;
                                    set({ colSubLabels: nx });
                                  }}
                                  placeholder="Sub-label e.g. (kWh)"
                                  className="mt-0.5"
                                />
                                {/* Per-column cell styling: text color · font size · font */}
                                <div className="flex gap-1 items-center mt-0.5">
                                  <input
                                    type="color"
                                    title="Cell text color"
                                    value={colTextColors[col] ?? '#000000'}
                                    onChange={(e) => {
                                      const nx = { ...colTextColors };
                                      if (e.target.value === '#000000') delete nx[col]; else nx[col] = e.target.value;
                                      set({ colTextColors: nx });
                                    }}
                                    className="w-7 h-7 rounded border border-border cursor-pointer flex-shrink-0 p-0"
                                  />
                                  <input
                                    type="number"
                                    title="Cell font size"
                                    placeholder="px"
                                    value={colFontSizes[col] ?? ''}
                                    onChange={(e) => {
                                      const nx = { ...colFontSizes };
                                      if (!e.target.value) delete nx[col]; else nx[col] = Number(e.target.value);
                                      set({ colFontSizes: nx });
                                    }}
                                    min={7} max={24}
                                    className="w-12 px-1 py-1 text-[10px] rounded border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                                  />
                                  <select
                                    title="Cell font family"
                                    value={colFontFamilies[col] ?? ''}
                                    onChange={(e) => {
                                      const nx = { ...colFontFamilies };
                                      if (!e.target.value) delete nx[col]; else nx[col] = e.target.value;
                                      set({ colFontFamilies: nx });
                                    }}
                                    className="flex-1 px-1 py-1 text-[10px] rounded border border-border bg-bg-input focus:outline-none min-w-0"
                                  >
                                    <option value="">— default</option>
                                    <optgroup label="Khmer">
                                      <option value="var(--font-noto-khmer), 'Noto Sans Khmer', sans-serif">Noto Sans Khmer</option>
                                      <option value="var(--font-battambang), 'Battambang', serif">Battambang</option>
                                      <option value="var(--font-koh-santepheap), 'Koh Santepheap', serif">Koh Santepheap</option>
                                      <option value="var(--font-khmer), 'Kantumruy Pro', sans-serif">Kantumruy Pro</option>
                                    </optgroup>
                                    <optgroup label="Latin">
                                      <option value="Arial, sans-serif">Arial</option>
                                      <option value="Georgia, serif">Georgia</option>
                                      <option value="'Times New Roman', serif">Times New Roman</option>
                                      <option value="Verdana, sans-serif">Verdana</option>
                                    </optgroup>
                                  </select>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {/* Status badges */}
                      <SectionHeader>Status Badges</SectionHeader>
                      {tCols.length > 0 ? (
                        <>
                          <div>
                            <Label>Badge columns</Label>
                            <div className="space-y-1">
                              {tCols.map((col) => (
                                <label key={col} className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={statusCols.includes(col)}
                                    onChange={(e) => set({ statusColumns: e.target.checked ? [...statusCols, col] : statusCols.filter((c) => c !== col) })}
                                    className="w-3 h-3 accent-accent-600"
                                  />
                                  <span className="text-xs text-text-sub truncate">{col}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          {statusCols.length > 0 && (
                            <div>
                              <Label>Value → color map</Label>
                              <div className="space-y-1">
                                {Object.entries(statusClrs).map(([val, color]) => (
                                  <div key={val} className="flex gap-1 items-center">
                                    <PanelInput
                                      value={val}
                                      onChange={(e) => {
                                        const nx = { ...statusClrs };
                                        delete nx[val];
                                        if (e.target.value) nx[e.target.value] = color;
                                        set({ statusColors: nx });
                                      }}
                                      placeholder="Value"
                                      className="flex-1 min-w-0"
                                    />
                                    <input
                                      type="color"
                                      value={color}
                                      onChange={(e) => set({ statusColors: { ...statusClrs, [val]: e.target.value } })}
                                      className="w-7 h-7 rounded border border-border cursor-pointer flex-shrink-0 p-0"
                                    />
                                    <button
                                      onClick={() => { const nx = { ...statusClrs }; delete nx[val]; set({ statusColors: nx }); }}
                                      className="text-text-muted hover:text-red-500 transition-colors flex-shrink-0"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  onClick={() => set({ statusColors: { ...statusClrs, [`Value ${Object.keys(statusClrs).length + 1}`]: '#84cc16' } })}
                                  className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors"
                                >
                                  <Plus className="w-3 h-3" /> Add color rule
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] text-text-muted">Add columns first</p>
                      )}

                      {/* Merge Cells */}
                      <SectionHeader>Merge Cells</SectionHeader>
                      {tCols.length > 0 ? (
                        <div>
                          <Label>ច្របាច់ ក្រឡាដូចគ្នា (Merge same consecutive values)</Label>
                          <div className="space-y-1 mt-1">
                            {tCols.map((col) => {
                              const mergeCols = (p?.mergeCols as string[]) ?? [];
                              return (
                                <label key={col} className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={mergeCols.includes(col)}
                                    onChange={(e) => set({
                                      mergeCols: e.target.checked
                                        ? [...mergeCols, col]
                                        : mergeCols.filter((c) => c !== col),
                                    })}
                                    className="w-3 h-3 accent-accent-600"
                                  />
                                  <span className="text-xs text-text-sub truncate">{col}</span>
                                </label>
                              );
                            })}
                          </div>
                          {((p?.mergeCols as string[]) ?? []).length > 0 && (
                            <p className="text-[9px] text-text-muted mt-1.5 leading-relaxed">
                              Consecutive rows with the same value in checked columns are merged into one cell (rowspan).
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-text-muted">Add columns first</p>
                      )}

                      {/* Auto Layout */}
                      <SectionHeader>Auto Layout</SectionHeader>

                      {/* Height follows row data */}
                      <Toggle
                        checked={!!(p?.autoHeight)}
                        onChange={(v) => set({ autoHeight: v, ...(v ? { autoPageBreak: false } : { autoPageBreak: true }) })}
                        label="Height follows row data"
                      />
                      {!!(p?.autoHeight) && (
                        <div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 px-2.5 py-2 space-y-1">
                          <p className="text-[10px] font-semibold text-green-700 dark:text-green-400">Active</p>
                          <p className="text-[9px] text-green-600 dark:text-green-500 leading-relaxed">
                            The table height resizes automatically to fit all rows. Disable to set a fixed height.
                          </p>
                        </div>
                      )}

                      {/* Auto page break — disabled when autoHeight is on */}
                      <Toggle
                        checked={p?.autoPageBreak !== false}
                        onChange={(v) => set({ autoPageBreak: v, ...(v ? { autoHeight: false } : {}) })}
                        label="Auto page break"
                        disabled={!!(p?.autoHeight)}
                      />
                      {p?.autoPageBreak !== false && !(p?.autoHeight) && (
                        <div className="rounded-md bg-accent-50 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-800 px-2.5 py-2 space-y-1">
                          <p className="text-[10px] font-semibold text-accent-700 dark:text-accent-400">Active</p>
                          <p className="text-[9px] text-accent-600 dark:text-accent-500 leading-relaxed">
                            When rows exceed the table height, new pages are added automatically. Elements below this table are moved to the last overflow page.
                          </p>
                        </div>
                      )}

                      {/* Columns editor */}
                      <SectionHeader>Columns</SectionHeader>
                      <div className="space-y-1">
                        {tCols.map((col, ci) => (
                          <div key={ci} className="flex gap-1 items-center">
                            <div className="flex-1 min-w-0">
                              <PanelInput
                                value={colLabels[col] ?? col}
                                onChange={(e) => renameCol(col, e.target.value)}
                                placeholder={`Column ${ci + 1}`}
                              />
                              {colLabels[col] && colLabels[col] !== col && (
                                <p className="text-[10px] text-text-muted px-1 mt-0.5 truncate">field: {col}</p>
                              )}
                            </div>
                            <button onClick={() => deleteCol(col)} className="text-text-muted hover:text-red-500 transition-colors flex-shrink-0">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newCol = `Column ${tCols.length + 1}`;
                            const rows = ((p?.rows as Record<string, string>[]) ?? []).map((row) => ({ ...row, [newCol]: '' }));
                            set({ columns: [...tCols, newCol], rows });
                          }}
                          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors"
                        >
                          <Plus className="w-3 h-3" /> Add column
                        </button>
                      </div>

                      {/* Row data editor */}
                      <SectionHeader>Data</SectionHeader>
                      <div className="overflow-auto rounded-md border border-border max-h-36">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr>
                              {tCols.map((col) => (
                                <th key={col} className="px-1 py-0.5 text-[9px] font-semibold text-text-muted bg-bg-subtle border-b border-r border-border text-left truncate max-w-[60px]">
                                  {col}
                                </th>
                              ))}
                              <th className="w-5 bg-bg-subtle border-b border-border" />
                            </tr>
                          </thead>
                          <tbody>
                            {((p?.rows as Record<string, string>[]) ?? []).map((row, ri) => (
                              <tr key={ri}>
                                {tCols.map((col) => (
                                  <td key={col} className="border-b border-r border-border/60 p-0">
                                    <input
                                      value={String(row[col] ?? '')}
                                      onChange={(e) => {
                                        const rows = [...((p?.rows as Record<string, string>[]) ?? [])];
                                        rows[ri] = { ...rows[ri], [col]: e.target.value };
                                        set({ rows });
                                      }}
                                      className="w-full px-1.5 py-0.5 text-[10px] bg-transparent focus:outline-none focus:bg-accent-50 dark:focus:bg-accent-950/20 min-w-0"
                                    />
                                  </td>
                                ))}
                                <td className="border-b border-border/60 p-0.5 text-center">
                                  <button
                                    onClick={() => set({ rows: ((p?.rows as Record<string, string>[]) ?? []).filter((_, j) => j !== ri) })}
                                    className="text-text-muted hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button
                        onClick={() => {
                          const newRow: Record<string, string> = {};
                          tCols.forEach((c) => { newRow[c] = ''; });
                          set({ rows: [...((p?.rows as Record<string, string>[]) ?? []), newRow] });
                        }}
                        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Add row
                      </button>
                    </>
                  );
                })()}

                {/* ── Data widget / Chart ── */}
                {(selected.type === 'data-widget' || selected.type === 'chart') && (
                  <>
                    <SectionHeader>Widget</SectionHeader>
                    <div>
                      <Label>Title override</Label>
                      <PanelInput
                        type="text"
                        value={(p?.title as string) ?? ''}
                        onChange={(e) => set({ title: e.target.value })}
                        placeholder="Auto from widget type"
                      />
                    </div>
                    <div>
                      <Label>Accent color</Label>
                      <ColorInput
                        value={(p?.colorScheme as string) ?? '#6366f1'}
                        onChange={(v) => set({ colorScheme: v })}
                      />
                    </div>
                    {selected.type === 'chart' && (() => {
                      const ct = (p?.chartType as string) ?? 'bar';
                      const isDualAxis = ct === 'bar-line';
                      const isHBar     = ct === 'bar-h';
                      return (
                        <>
                          <div>
                            <Label>Chart type</Label>
                            <select
                              value={ct}
                              onChange={(e) => set({ chartType: e.target.value })}
                              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                            >
                              <option value="bar">Bar chart</option>
                              <option value="line">Line chart</option>
                              <option value="pie">Pie chart</option>
                              <option value="bar-line">Bar + Line (dual axis)</option>
                              <option value="bar-h">Horizontal bar</option>
                            </select>
                          </div>

                          {/* Dual-axis options */}
                          {isDualAxis && (
                            <>
                              <SectionHeader>Dual-Axis Series</SectionHeader>
                              <div>
                                <Label>Bar series label</Label>
                                <PanelInput value={(p?.barLabel as string) ?? ''} onChange={(e) => set({ barLabel: e.target.value })} placeholder="Count" />
                              </div>
                              <div>
                                <Label>Line series label</Label>
                                <PanelInput value={(p?.lineLabel as string) ?? ''} onChange={(e) => set({ lineLabel: e.target.value })} placeholder="Value" />
                              </div>
                              <div>
                                <Label>Bar color</Label>
                                <ColorInput value={(p?.colorScheme as string) ?? '#5b9bd5'} onChange={(v) => set({ colorScheme: v })} />
                              </div>
                              <div>
                                <Label>Line color</Label>
                                <ColorInput value={(p?.lineColor as string) ?? '#f59e0b'} onChange={(v) => set({ lineColor: v })} />
                              </div>
                              <SectionHeader>Axis Labels</SectionHeader>
                              <div>
                                <Label>Left Y-axis label</Label>
                                <PanelInput value={(p?.leftAxisLabel as string) ?? ''} onChange={(e) => set({ leftAxisLabel: e.target.value })} placeholder="e.g. ចំនួន" />
                              </div>
                              <div>
                                <Label>Right Y-axis label</Label>
                                <PanelInput value={(p?.rightAxisLabel as string) ?? ''} onChange={(e) => set({ rightAxisLabel: e.target.value })} placeholder="e.g. ចំាពណ (kWh)" />
                              </div>
                              <div>
                                <Label>X-axis label</Label>
                                <PanelInput value={(p?.xAxisLabel as string) ?? ''} onChange={(e) => set({ xAxisLabel: e.target.value })} placeholder="e.g. ម៉ោង" />
                              </div>

                              {/* ── Bar-line Typography ── */}
                              <SectionHeader>Title</SectionHeader>
                              <div className="grid grid-cols-2 gap-x-2">
                                <div>
                                  <Label>Size</Label>
                                  <PanelInput type="number" value={(p?.titleFontSize as number) ?? 12} onChange={(e) => set({ titleFontSize: Number(e.target.value) })} min={8} max={36} />
                                </div>
                                <div>
                                  <Label>Color</Label>
                                  <ColorInput value={(p?.titleColor as string) ?? '#111111'} onChange={(v) => set({ titleColor: v })} />
                                </div>
                              </div>
                              <div>
                                <Label>Align</Label>
                                <div className="flex gap-1">
                                  {([
                                    { v: 'left',   Icon: AlignLeft },
                                    { v: 'center', Icon: AlignCenter },
                                    { v: 'right',  Icon: AlignRight },
                                  ] as const).map(({ v, Icon }) => (
                                    <button key={v} onClick={() => set({ titleAlign: v })}
                                      className={cn('flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors',
                                        (p?.titleAlign ?? 'left') === v ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400' : 'border-border text-text-muted hover:text-text')}
                                    ><Icon className="w-3.5 h-3.5" /></button>
                                  ))}
                                </div>
                              </div>

                              <SectionHeader>Typography</SectionHeader>
                              <div>
                                <Label>Font family</Label>
                                <select value={(p?.labelFontFamily as string) ?? ''} onChange={(e) => set({ labelFontFamily: e.target.value || undefined })}
                                  className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                                  <option value="">Default</option>
                                  <optgroup label="Khmer">
                                    <option value="var(--font-koh-santepheap), 'Koh Santepheap', sans-serif">Koh Santepheap</option>
                                    <option value="var(--font-khmer), 'Kantumruy Pro', sans-serif">Kantumruy Pro</option>
                                  </optgroup>
                                  <optgroup label="Latin">
                                    <option value="Arial, sans-serif">Arial</option>
                                    <option value="Georgia, serif">Georgia</option>
                                    <option value="'Times New Roman', serif">Times New Roman</option>
                                    <option value="Verdana, sans-serif">Verdana</option>
                                  </optgroup>
                                </select>
                              </div>
                              <div className="grid grid-cols-2 gap-x-2">
                                <div>
                                  <Label>Tick size</Label>
                                  <PanelInput type="number" value={(p?.labelFontSize as number) ?? 9} onChange={(e) => set({ labelFontSize: Number(e.target.value) })} min={6} max={20} />
                                </div>
                                <div>
                                  <Label>Tick color</Label>
                                  <ColorInput value={(p?.labelColor as string) ?? '#6b7280'} onChange={(v) => set({ labelColor: v })} />
                                </div>
                              </div>
                            </>
                          )}

                          {/* Horizontal bar options */}
                          {isHBar && (
                            <>
                              <SectionHeader>Horizontal Bar Options</SectionHeader>
                              <Toggle checked={!!(p?.sortDesc)}      onChange={(v) => set({ sortDesc: v })}      label="Sort by value (desc)" />
                              <Toggle checked={!!(p?.showBarValues)} onChange={(v) => set({ showBarValues: v })} label="Show value labels" />
                              <Toggle checked={!!(p?.singleColor)}   onChange={(v) => set({ singleColor: v })}   label="Single color for all bars" />
                              <Toggle checked={!!(p?.showBarTrack)}  onChange={(v) => set({ showBarTrack: v })}  label="Show background track" />
                              <Toggle checked={!!(p?.boldLabels)}    onChange={(v) => set({ boldLabels: v })}    label="Bold row labels" />

                              {/* Value label format */}
                              {!!(p?.showBarValues) && (
                                <>
                                  <div className="grid grid-cols-2 gap-x-2">
                                    <div>
                                      <Label>Value suffix</Label>
                                      <PanelInput
                                        type="text"
                                        placeholder="e.g. kWh"
                                        value={(p?.valueSuffix as string) ?? ''}
                                        onChange={(e) => set({ valueSuffix: e.target.value || undefined })}
                                      />
                                    </div>
                                    <div>
                                      <Label>2nd value suffix</Label>
                                      <PanelInput
                                        type="text"
                                        placeholder="e.g. sessions"
                                        value={(p?.value2Suffix as string) ?? ''}
                                        onChange={(e) => set({ value2Suffix: e.target.value || undefined })}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <Label>Right margin (px)</Label>
                                    <PanelInput
                                      type="number"
                                      value={(p?.valueRightMargin as number) ?? 160}
                                      onChange={(e) => set({ valueRightMargin: Number(e.target.value) })}
                                      min={40} max={400}
                                    />
                                  </div>
                                </>
                              )}

                              {/* Row height per bar + element height side-by-side */}
                              <div className="grid grid-cols-2 gap-x-2">
                                <div>
                                  <Label>Row height (px)</Label>
                                  <PanelInput
                                    type="number"
                                    value={(p?.barRowHeight as number) ?? 26}
                                    onChange={(e) => set({ barRowHeight: Number(e.target.value) })}
                                    min={16} max={80}
                                  />
                                </div>
                                <div>
                                  <Label>Element height (px)</Label>
                                  <PanelInput
                                    type="number"
                                    value={Math.round(selected.h)}
                                    onChange={(e) => onElementChange({ ...(p ?? {}), _h: Number(e.target.value) })}
                                    min={60} max={2000}
                                  />
                                </div>
                              </div>

                              <SectionHeader>Title</SectionHeader>

                              {/* Title alignment + size */}
                              <div className="grid grid-cols-2 gap-x-2">
                                <div>
                                  <Label>Size</Label>
                                  <PanelInput
                                    type="number"
                                    value={(p?.titleFontSize as number) ?? 12}
                                    onChange={(e) => set({ titleFontSize: Number(e.target.value) })}
                                    min={8} max={36}
                                  />
                                </div>
                                <div>
                                  <Label>Color</Label>
                                  <ColorInput
                                    value={(p?.titleColor as string) ?? '#111111'}
                                    onChange={(v) => set({ titleColor: v })}
                                  />
                                </div>
                              </div>
                              <div>
                                <Label>Align</Label>
                                <div className="flex gap-1">
                                  {([
                                    { v: 'left',   Icon: AlignLeft },
                                    { v: 'center', Icon: AlignCenter },
                                    { v: 'right',  Icon: AlignRight },
                                  ] as const).map(({ v, Icon }) => (
                                    <button
                                      key={v}
                                      onClick={() => set({ titleAlign: v })}
                                      className={cn(
                                        'flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors',
                                        (p?.titleAlign ?? 'left') === v
                                          ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                          : 'border-border text-text-muted hover:text-text',
                                      )}
                                    >
                                      <Icon className="w-3.5 h-3.5" />
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <SectionHeader>Typography</SectionHeader>

                              {/* Font family */}
                              <div>
                                <Label>Font family</Label>
                                <select
                                  value={(p?.labelFontFamily as string) ?? ''}
                                  onChange={(e) => set({ labelFontFamily: e.target.value || undefined })}
                                  className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                                >
                                  <option value="">Default</option>
                                  <optgroup label="Khmer">
                                    <option value="var(--font-koh-santepheap), 'Koh Santepheap', sans-serif">Koh Santepheap</option>
                                    <option value="var(--font-khmer), 'Kantumruy Pro', sans-serif">Kantumruy Pro</option>
                                  </optgroup>
                                  <optgroup label="Latin">
                                    <option value="Arial, sans-serif">Arial</option>
                                    <option value="Georgia, serif">Georgia</option>
                                    <option value="'Times New Roman', serif">Times New Roman</option>
                                    <option value="Verdana, sans-serif">Verdana</option>
                                    <option value="'Courier New', monospace">Courier New</option>
                                  </optgroup>
                                </select>
                              </div>

                              {/* Label size + label column width */}
                              <div className="grid grid-cols-2 gap-x-2">
                                <div>
                                  <Label>Label size</Label>
                                  <PanelInput
                                    type="number"
                                    value={(p?.labelFontSize as number) ?? 10}
                                    onChange={(e) => set({ labelFontSize: Number(e.target.value) })}
                                    min={7} max={28}
                                  />
                                </div>
                                <div>
                                  <Label>Label width</Label>
                                  <PanelInput
                                    type="number"
                                    value={(p?.labelWidth as number) ?? 90}
                                    onChange={(e) => set({ labelWidth: Number(e.target.value) })}
                                    min={30} max={220}
                                  />
                                </div>
                              </div>

                              {/* Value label size + color */}
                              <div className="grid grid-cols-2 gap-x-2">
                                <div>
                                  <Label>Value size</Label>
                                  <PanelInput
                                    type="number"
                                    value={(p?.valueFontSize as number) ?? 10}
                                    onChange={(e) => set({ valueFontSize: Number(e.target.value) })}
                                    min={7} max={28}
                                  />
                                </div>
                                <div>
                                  <Label>Value color</Label>
                                  <ColorInput
                                    value={(p?.valueColor as string) ?? '#6b7280'}
                                    onChange={(v) => set({ valueColor: v })}
                                  />
                                </div>
                              </div>

                              {/* Label color */}
                              <div>
                                <Label>Label color</Label>
                                <ColorInput
                                  value={(p?.labelColor as string) ?? '#374151'}
                                  onChange={(v) => set({ labelColor: v })}
                                />
                              </div>

                              {/* Label alignment */}
                              <div>
                                <Label>Label align</Label>
                                <div className="flex gap-1">
                                  {([
                                    { v: 'left',   Icon: AlignLeft },
                                    { v: 'center', Icon: AlignCenter },
                                    { v: 'right',  Icon: AlignRight },
                                  ] as const).map(({ v, Icon }) => (
                                    <button
                                      key={v}
                                      onClick={() => set({ labelAlign: v })}
                                      className={cn(
                                        'flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors',
                                        (p?.labelAlign ?? 'right') === v
                                          ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                          : 'border-border text-text-muted hover:text-text',
                                      )}
                                    >
                                      <Icon className="w-3.5 h-3.5" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}

                          {/* Vertical bar options */}
                          {ct === 'bar' && (
                            <>
                              <SectionHeader>Bar Options</SectionHeader>
                              <Toggle checked={!!(p?.singleColor)} onChange={(v) => set({ singleColor: v })} label="Single color for all bars" />
                            </>
                          )}

                          {/* ── Pie chart options ── */}
                          {ct === 'pie' && (
                            <>
                              {/* Shape */}
                              <SectionHeader>Shape</SectionHeader>
                              <div>
                                <Label>Style</Label>
                                <div className="flex gap-1">
                                  {(['solid', 'donut'] as const).map((s) => (
                                    <button key={s} onClick={() => set({ pieStyle: s })}
                                      className={cn('flex-1 py-1.5 text-xs rounded-md border capitalize transition-colors',
                                        (p?.pieStyle ?? 'solid') === s ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400' : 'border-border text-text-muted hover:text-text')}
                                    >{s}</button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <Label>Slice gap (°)</Label>
                                <PanelInput type="number" value={(p?.paddingAngle as number) ?? 2} onChange={(e) => set({ paddingAngle: Number(e.target.value) })} min={0} max={10} />
                              </div>

                              {/* Donut inner radius + center label */}
                              {(p?.pieStyle as string) === 'donut' && (
                                <>
                                  <div>
                                    <Label>Inner radius %</Label>
                                    <PanelInput type="number" value={(p?.innerRadius as number) ?? 35} onChange={(e) => set({ innerRadius: Number(e.target.value) })} min={10} max={80} />
                                  </div>

                                  <SectionHeader>Center Label</SectionHeader>
                                  <div>
                                    <Label>Content</Label>
                                    <select value={(p?.centerLabel as string) ?? 'none'} onChange={(e) => set({ centerLabel: e.target.value })}
                                      className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                                      <option value="none">None</option>
                                      <option value="total">Total count</option>
                                      <option value="custom">Custom text</option>
                                    </select>
                                  </div>
                                  {(p?.centerLabel as string) !== 'none' && (p?.centerLabel as string) && (
                                    <>
                                      {(p?.centerLabel as string) === 'custom' && (
                                        <div>
                                          <Label>Text</Label>
                                          <PanelInput value={(p?.centerText as string) ?? ''} onChange={(e) => set({ centerText: e.target.value })} placeholder="e.g. Total" />
                                        </div>
                                      )}
                                      <div className="grid grid-cols-2 gap-x-2">
                                        <div>
                                          <Label>Font size</Label>
                                          <PanelInput type="number" value={(p?.centerFontSize as number) ?? 24} onChange={(e) => set({ centerFontSize: Number(e.target.value) })} min={10} max={72} />
                                        </div>
                                        <div>
                                          <Label>Color</Label>
                                          <ColorInput value={(p?.centerColor as string) ?? '#111111'} onChange={(v) => set({ centerColor: v })} />
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </>
                              )}

                              {/* Labels */}
                              <SectionHeader>Labels</SectionHeader>
                              <div>
                                <Label>Position</Label>
                                <select value={(p?.pieLabel as string) ?? 'outside'} onChange={(e) => set({ pieLabel: e.target.value })}
                                  className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                                  <option value="none">None</option>
                                  <option value="outside">Outside (with lines)</option>
                                  <option value="inside">Inside slice</option>
                                </select>
                              </div>
                              {(p?.pieLabel as string) !== 'none' && (
                                <>
                                  <div>
                                    <Label>Show</Label>
                                    <select value={(p?.labelContent as string) ?? 'name-percent'} onChange={(e) => set({ labelContent: e.target.value })}
                                      className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                                      <option value="name">Name only</option>
                                      <option value="percent">% only</option>
                                      <option value="value">Value only</option>
                                      <option value="name-percent">Name + %</option>
                                      <option value="name-value">Name + value</option>
                                    </select>
                                  </div>
                                  {(p?.pieLabel as string) === 'outside' && (
                                    <Toggle checked={(p?.labelLine as boolean) !== false} onChange={(v) => set({ labelLine: v })} label="Show leader lines" />
                                  )}
                                  {/* Name suffix — appended after the name in the label */}
                                  <div>
                                    <Label>Name suffix</Label>
                                    <PanelInput
                                      type="text"
                                      value={(p?.labelNameSuffix as string) ?? ''}
                                      onChange={(e) => set({ labelNameSuffix: e.target.value || undefined })}
                                      placeholder="e.g.  ស  or  $  (appended after name)"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-2">
                                    <div>
                                      <Label>Font size</Label>
                                      <PanelInput type="number" value={(p?.labelFontSize as number) ?? 10} onChange={(e) => set({ labelFontSize: Number(e.target.value) })} min={6} max={20} />
                                    </div>
                                    <div>
                                      <Label>Color</Label>
                                      <ColorInput value={(p?.labelColor as string) ?? '#374151'} onChange={(v) => set({ labelColor: v })} />
                                    </div>
                                  </div>
                                  <div>
                                    <Label>Font family</Label>
                                    <select value={(p?.labelFontFamily as string) ?? ''} onChange={(e) => set({ labelFontFamily: e.target.value || undefined })}
                                      className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
                                      <option value="">Default</option>
                                      <optgroup label="Khmer">
                                        <option value="var(--font-koh-santepheap), 'Koh Santepheap', sans-serif">Koh Santepheap</option>
                                        <option value="var(--font-khmer), 'Kantumruy Pro', sans-serif">Kantumruy Pro</option>
                                      </optgroup>
                                      <optgroup label="Latin">
                                        <option value="Arial, sans-serif">Arial</option>
                                        <option value="Georgia, serif">Georgia</option>
                                        <option value="Verdana, sans-serif">Verdana</option>
                                      </optgroup>
                                    </select>
                                  </div>
                                </>
                              )}

                              {/* Title */}
                              <SectionHeader>Title</SectionHeader>
                              <div className="grid grid-cols-2 gap-x-2">
                                <div><Label>Size</Label><PanelInput type="number" value={(p?.titleFontSize as number) ?? 12} onChange={(e) => set({ titleFontSize: Number(e.target.value) })} min={8} max={36} /></div>
                                <div><Label>Color</Label><ColorInput value={(p?.titleColor as string) ?? '#111111'} onChange={(v) => set({ titleColor: v })} /></div>
                              </div>
                              <div>
                                <Label>Align</Label>
                                <div className="flex gap-1">
                                  {([{ v: 'left', Icon: AlignLeft }, { v: 'center', Icon: AlignCenter }, { v: 'right', Icon: AlignRight }] as const).map(({ v, Icon }) => (
                                    <button key={v} onClick={() => set({ titleAlign: v })}
                                      className={cn('flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors',
                                        (p?.titleAlign ?? 'left') === v ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400' : 'border-border text-text-muted hover:text-text')}
                                    ><Icon className="w-3.5 h-3.5" /></button>
                                  ))}
                                </div>
                              </div>

                              <SectionHeader>Legend</SectionHeader>
                              <Toggle checked={!!(p?.showLegend)} onChange={(v) => set({ showLegend: v })} label="Show legend" />
                            </>
                          )}

                          {/* Shared display options (not pie) */}
                          {ct !== 'pie' && (
                            <>
                              <SectionHeader>Display</SectionHeader>
                              <Toggle checked={!!(p?.showGrid)} onChange={(v) => set({ showGrid: v })} label="Show grid lines" />
                              <Toggle checked={!!(p?.showLegend)} onChange={(v) => set({ showLegend: v })} label="Show legend" />
                            </>
                          )}
                        </>
                      );
                    })()}

                    {/* Widget — direct KPI value editor */}
                    {selected.type === 'data-widget' && !(p?.dataSource as { url?: string } | undefined)?.url && (
                      <>
                        <SectionHeader>Value</SectionHeader>
                        <div>
                          <Label>Display value</Label>
                          <PanelInput
                            value={(p?.kpiValue as string) ?? ''}
                            onChange={(e) => set({ kpiValue: e.target.value })}
                            placeholder="e.g. 142 or $1.2M"
                          />
                        </div>
                        <div>
                          <Label>Label</Label>
                          <PanelInput
                            value={(p?.kpiLabel as string) ?? ''}
                            onChange={(e) => set({ kpiLabel: e.target.value })}
                            placeholder="e.g. Total Revenue"
                          />
                        </div>
                        <div>
                          <Label>Trend (number)</Label>
                          <PanelInput
                            type="number"
                            value={(p?.kpiTrend as number | undefined) ?? ''}
                            onChange={(e) => set({ kpiTrend: e.target.value === '' ? undefined : Number(e.target.value) })}
                            placeholder="e.g. 12 or -5"
                          />
                        </div>
                        <div>
                          <Label>Trend label</Label>
                          <PanelInput
                            value={(p?.kpiTrendLabel as string) ?? ''}
                            onChange={(e) => set({ kpiTrendLabel: e.target.value })}
                            placeholder="e.g. vs last month"
                          />
                        </div>
                      </>
                    )}

                    {/* Chart — direct series data editor */}
                    {selected.type === 'chart' && !(p?.dataSource as { url?: string } | undefined)?.url && (() => {
                      type SI = { name: string; value: number; value2?: number; color?: string };
                      const PALETTE = ['#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4', '#ec4899'];
                      const isDualAxis = (p?.chartType as string) === 'bar-line';
                      const sd = (p?.seriesData as SI[]) ?? [];
                      const gridCols = isDualAxis ? '1fr 44px 44px 22px 16px' : '1fr 52px 22px 16px';
                      return (
                        <>
                          <SectionHeader>Series Data</SectionHeader>
                          {isDualAxis && (
                            <p className="text-[9px] text-text-muted -mt-1">Label · Bar value · Line value · Color</p>
                          )}
                          <div className="space-y-1.5">
                            {sd.map((item, si) => (
                              <div key={si} className="grid gap-1 items-center" style={{ gridTemplateColumns: gridCols }}>
                                <PanelInput
                                  value={item.name}
                                  onChange={(e) => { const s = [...sd]; s[si] = { ...s[si], name: e.target.value }; set({ seriesData: s }); }}
                                  placeholder="Label"
                                />
                                <PanelInput
                                  type="number"
                                  value={item.value}
                                  onChange={(e) => { const s = [...sd]; s[si] = { ...s[si], value: Number(e.target.value) }; set({ seriesData: s }); }}
                                  placeholder="0"
                                  className="px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                {isDualAxis && (
                                  <PanelInput
                                    type="number"
                                    value={item.value2 ?? 0}
                                    onChange={(e) => { const s = [...sd]; s[si] = { ...s[si], value2: Number(e.target.value) }; set({ seriesData: s }); }}
                                    placeholder="0"
                                    className="px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                  />
                                )}
                                <input
                                  type="color"
                                  value={item.color ?? '#6366f1'}
                                  onChange={(e) => { const s = [...sd]; s[si] = { ...s[si], color: e.target.value }; set({ seriesData: s }); }}
                                  className="w-[22px] h-[22px] rounded cursor-pointer border border-border p-0"
                                />
                                <button
                                  onClick={() => set({ seriesData: sd.filter((_, j) => j !== si) })}
                                  className="text-text-muted hover:text-red-500 transition-colors flex items-center justify-center"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => set({ seriesData: [...sd, { name: `Item ${sd.length + 1}`, value: 0, ...(isDualAxis ? { value2: 0 } : {}), color: PALETTE[sd.length % PALETTE.length] }] })}
                              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors"
                            >
                              <Plus className="w-3 h-3" /> Add item
                            </button>
                          </div>
                        </>
                      );
                    })()}

                    {/* ── Quick presets ── */}
                    <SectionHeader>Quick preset</SectionHeader>
                    <div className="grid grid-cols-2 gap-1">
                      {([
                        { label: 'Card',    patch: { borderRadius: 12, borderSides: ['top','right','bottom','left'], borderColor: '#e2e8f0', borderWidth: 1, borderStyle: 'solid', shadow: true,  background: '' } },
                        { label: 'Outline', patch: { borderRadius: 8,  borderSides: ['top','right','bottom','left'], borderColor: '#6366f1', borderWidth: 2, borderStyle: 'solid', shadow: false, background: '' } },
                        { label: 'Bottom',  patch: { borderRadius: 0,  borderSides: ['bottom'],                     borderColor: '#6366f1', borderWidth: 2, borderStyle: 'solid', shadow: false, background: '' } },
                        { label: 'Flat',    patch: { borderRadius: 4,  borderSides: [],                             borderColor: '#e2e8f0', borderWidth: 1, borderStyle: 'solid', shadow: false, background: '' } },
                      ] as const).map(({ label, patch }) => (
                        <button
                          key={label}
                          onClick={() => set(patch)}
                          className="py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text hover:border-accent-400 transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* ── Appearance ── */}
                    <SectionHeader>Appearance</SectionHeader>
                    <Toggle
                      checked={(p?.background as string) === 'transparent'}
                      onChange={(v) => set({ background: v ? 'transparent' : '' })}
                      label="No background (transparent)"
                    />
                    {(p?.background as string) !== 'transparent' && (
                      <div>
                        <Label>Background</Label>
                        <ColorInput
                          value={(p?.background as string) || '#ffffff'}
                          onChange={(v) => set({ background: v === '#ffffff' ? '' : v })}
                        />
                      </div>
                    )}
                    <div>
                      <Label>Opacity %</Label>
                      <PanelInput
                        type="number"
                        value={Math.round(((p?.opacity as number) ?? 1) * 100)}
                        onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                        min={0} max={100}
                      />
                    </div>
                    <Toggle
                      checked={!!(p?.shadow)}
                      onChange={(v) => set({ shadow: v })}
                      label="Drop shadow"
                    />

                    {/* ── Spacing ── */}
                    <SectionHeader>Spacing</SectionHeader>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Pad X</Label>
                        <PanelInput
                          type="number"
                          value={(p?.paddingX as number) ?? 12}
                          onChange={(e) => set({ paddingX: Number(e.target.value) })}
                          min={0} max={80}
                        />
                      </div>
                      <div>
                        <Label>Pad Y</Label>
                        <PanelInput
                          type="number"
                          value={(p?.paddingY as number) ?? 12}
                          onChange={(e) => set({ paddingY: Number(e.target.value) })}
                          min={0} max={80}
                        />
                      </div>
                    </div>

                    {/* ── Border ── */}
                    <SectionHeader>Border</SectionHeader>
                    <div>
                      <Label>Corner radius</Label>
                      <PanelInput
                        type="number"
                        value={(p?.borderRadius as number) ?? 8}
                        onChange={(e) => set({ borderRadius: Number(e.target.value) })}
                        min={0} max={200}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Color</Label>
                        <ColorInput
                          value={(p?.borderColor as string) ?? '#e2e8f0'}
                          onChange={(v) => set({ borderColor: v })}
                        />
                      </div>
                      <div>
                        <Label>Width</Label>
                        <PanelInput
                          type="number"
                          value={(p?.borderWidth as number) ?? 1}
                          onChange={(e) => set({ borderWidth: Number(e.target.value) })}
                          min={0} max={16}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Style</Label>
                      <select
                        value={(p?.borderStyle as string) ?? 'solid'}
                        onChange={(e) => set({ borderStyle: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      >
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label>Sides</Label>
                        <div className="flex gap-1">
                          {(['All', 'None'] as const).map((q) => (
                            <button
                              key={q}
                              onClick={() => set({ borderSides: q === 'All' ? ['top','right','bottom','left'] : [] })}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                          const sides = (p?.borderSides as string[] | undefined) ?? ['top', 'right', 'bottom', 'left'];
                          const active = sides.includes(side);
                          return (
                            <button
                              key={side}
                              title={side.charAt(0).toUpperCase() + side.slice(1)}
                              onClick={() => {
                                const cur = (p?.borderSides as string[] | undefined) ?? ['top', 'right', 'bottom', 'left'];
                                set({ borderSides: active ? cur.filter((s) => s !== side) : [...cur, side] });
                              }}
                              className={cn(
                                'flex-1 py-1.5 text-xs rounded-md border transition-colors font-medium',
                                active
                                  ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                  : 'border-border text-text-muted hover:text-text',
                              )}
                            >
                              {side === 'top' ? 'T' : side === 'right' ? 'R' : side === 'bottom' ? 'B' : 'L'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Grouped Table ── */}
                {isGroupedTable && (
                  <>
                    <SectionHeader>Data Source</SectionHeader>
                    <div>
                      <Label>URL</Label>
                      <PanelInput
                        type="text"
                        placeholder="https://api.example.com/data"
                        value={(p?.dataUrl as string) ?? ''}
                        onChange={(e) => set({ dataUrl: e.target.value || undefined })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Method</Label>
                        <select
                          value={(p?.dataMethod as string) ?? 'GET'}
                          onChange={(e) => set({ dataMethod: e.target.value })}
                          className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                      </div>
                      <div>
                        <Label>Data path</Label>
                        <PanelInput
                          type="text"
                          placeholder="e.g. site_performance"
                          value={(p?.dataPath as string) ?? ''}
                          onChange={(e) => set({ dataPath: e.target.value || undefined })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Headers (JSON)</Label>
                      <textarea
                        value={(p?.dataHeaders as string) ?? ''}
                        onChange={(e) => set({ dataHeaders: e.target.value || undefined })}
                        placeholder={'{"Authorization":"Bearer ..."}'}
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors font-mono resize-none"
                      />
                    </div>

                    <SectionHeader>Grouping Fields</SectionHeader>
                    <div className="grid grid-cols-3 gap-x-2">
                      <div>
                        <Label>Group by</Label>
                        <PanelInput
                          type="text"
                          placeholder="company_kh"
                          value={(p?.groupByField as string) ?? ''}
                          onChange={(e) => set({ groupByField: e.target.value || 'company_kh' })}
                        />
                      </div>
                      <div>
                        <Label>Sub-group by</Label>
                        <PanelInput
                          type="text"
                          placeholder="site_kh"
                          value={(p?.subGroupField as string) ?? ''}
                          onChange={(e) => set({ subGroupField: e.target.value || 'site_kh' })}
                        />
                      </div>
                      <div>
                        <Label>Detail field</Label>
                        <PanelInput
                          type="text"
                          placeholder="chargers_detail"
                          value={(p?.detailField as string) ?? ''}
                          onChange={(e) => set({ detailField: e.target.value || 'chargers_detail' })}
                        />
                      </div>
                    </div>

                    <SectionHeader>Columns (JSON)</SectionHeader>
                    <div>
                      <textarea
                        value={
                          (p?.columns as unknown)
                            ? JSON.stringify(p?.columns, null, 2)
                            : JSON.stringify(GROUPED_TABLE_DEFAULT_COLUMNS, null, 2)
                        }
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            set({ columns: parsed });
                          } catch { /* ignore invalid JSON */ }
                        }}
                        rows={10}
                        className="w-full px-2 py-1.5 text-[10px] rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors font-mono resize-y"
                      />
                    </div>
                    <button
                      onClick={() => set({ columns: GROUPED_TABLE_DEFAULT_COLUMNS })}
                      className="w-full py-1.5 text-xs rounded-md border border-border text-text-muted hover:bg-bg-hover transition-colors"
                    >
                      Reset to default EV columns
                    </button>

                    <SectionHeader>Style</SectionHeader>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Header bg</Label>
                        <ColorInput value={(p?.headerBg as string) ?? '#1e3a5f'} onChange={(v) => set({ headerBg: v })} />
                      </div>
                      <div>
                        <Label>Header color</Label>
                        <ColorInput value={(p?.headerColor as string) ?? '#ffffff'} onChange={(v) => set({ headerColor: v })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Font size</Label>
                        <PanelInput type="number" value={(p?.fontSize as number) ?? 10} onChange={(e) => set({ fontSize: Number(e.target.value) })} min={7} max={18} />
                      </div>
                      <div>
                        <Label>Header font size</Label>
                        <PanelInput type="number" value={(p?.headerFontSize as number) ?? 10} onChange={(e) => set({ headerFontSize: Number(e.target.value) })} min={7} max={18} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Cell padding X</Label>
                        <PanelInput type="number" value={(p?.cellPaddingX as number) ?? 8} onChange={(e) => set({ cellPaddingX: Number(e.target.value) })} min={2} max={24} />
                      </div>
                      <div>
                        <Label>Cell padding Y</Label>
                        <PanelInput type="number" value={(p?.cellPaddingY as number) ?? 5} onChange={(e) => set({ cellPaddingY: Number(e.target.value) })} min={2} max={24} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Border color</Label>
                        <ColorInput value={(p?.borderColor as string) ?? '#d1d5db'} onChange={(v) => set({ borderColor: v })} />
                      </div>
                      <div>
                        <Label>Border width</Label>
                        <PanelInput type="number" value={(p?.borderWidth as number) ?? 1} onChange={(e) => set({ borderWidth: Number(e.target.value) })} min={0} max={4} />
                      </div>
                    </div>
                  </>
                )}

                {/* ── Progress Bar ── */}
                {isProgressBar && (
                  <>
                    <SectionHeader>Progress</SectionHeader>
                    <div>
                      <Label>Label</Label>
                      <PanelInput
                        value={(p?.label as string) ?? ''}
                        onChange={(e) => set({ label: e.target.value })}
                        placeholder="e.g. Completion rate"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Value</Label>
                        <PanelInput
                          type="number"
                          value={(p?.value as number) ?? 0}
                          min={0}
                          max={(p?.maxValue as number) ?? 100}
                          onChange={(e) => set({ value: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label>Max</Label>
                        <PanelInput
                          type="number"
                          value={(p?.maxValue as number) ?? 100}
                          min={1}
                          onChange={(e) => set({ maxValue: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Fill color</Label>
                      <ColorInput
                        value={(p?.color as string) ?? '#6366f1'}
                        onChange={(v) => set({ color: v })}
                      />
                    </div>
                    <div>
                      <Label>Track color</Label>
                      <ColorInput
                        value={(p?.trackColor as string) ?? '#e5e7eb'}
                        onChange={(v) => set({ trackColor: v })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <Label>Bar height</Label>
                        <PanelInput
                          type="number"
                          value={(p?.barHeight as number) ?? 12}
                          min={4}
                          max={40}
                          onChange={(e) => set({ barHeight: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label>Font size</Label>
                        <PanelInput
                          type="number"
                          value={(p?.fontSize as number) ?? 11}
                          min={8}
                          max={24}
                          onChange={(e) => set({ fontSize: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Label color</Label>
                      <ColorInput
                        value={(p?.labelColor as string) ?? '#6b7280'}
                        onChange={(v) => set({ labelColor: v })}
                      />
                    </div>
                    <Toggle
                      checked={!!(p?.showValue)}
                      onChange={(v) => set({ showValue: v })}
                      label="Show percentage"
                    />
                    <Toggle
                      checked={(p?.rounded as boolean) !== false}
                      onChange={(v) => set({ rounded: v })}
                      label="Rounded edges"
                    />
                  </>
                )}

                {/* ── Page Number ── */}
                {selected.type === 'page-number' && (
                  <>
                    <SectionHeader>Page Number</SectionHeader>
                    <div>
                      <Label>Format</Label>
                      <select
                        value={(p?.format as string) ?? 'page'}
                        onChange={(e) => set({ format: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      >
                        <option value="page">Page 1</option>
                        <option value="number">1</option>
                        <option value="slash">1 / —</option>
                      </select>
                    </div>
                    <div>
                      <Label>Font size</Label>
                      <PanelInput
                        type="number"
                        value={(p?.fontSize as number) ?? 11}
                        min={8}
                        max={32}
                        onChange={(e) => set({ fontSize: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>Color</Label>
                      <ColorInput
                        value={(p?.color as string) ?? '#9ca3af'}
                        onChange={(v) => set({ color: v })}
                      />
                    </div>
                    <div>
                      <Label>Alignment</Label>
                      <div className="flex gap-1">
                        {(['left', 'center', 'right'] as const).map((a) => {
                          const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
                          return (
                            <button
                              key={a}
                              onClick={() => set({ align: a })}
                              className={cn(
                                'flex-1 py-1.5 flex items-center justify-center rounded-md border transition-colors',
                                (p?.align ?? 'center') === a
                                  ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                                  : 'border-border text-text-muted hover:text-text',
                              )}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Custom Script (all element types) ── */}
            {selected && selected.type !== 'page-number' && (
              <>
                <SectionHeader>Custom Script</SectionHeader>
                <Toggle
                  checked={!!(p?.scriptEnabled)}
                  onChange={(v) => { set({ scriptEnabled: v }); setScriptOutput(null); }}
                  label="Enable script"
                />
                {p?.scriptEnabled && (
                  <>
                    <div>
                      <Label>JavaScript</Label>
                      <textarea
                        value={(p?.customScript as string) ?? ''}
                        onChange={(e) => { set({ customScript: e.target.value }); setScriptOutput(null); }}
                        rows={7}
                        spellCheck={false}
                        placeholder={
                          '// return a string to override display\n' +
                          '// if (value > 100) return "High: " + value;\n' +
                          '// if (id === "abc") return "Special";\n' +
                          'return String(value);'
                        }
                        className="w-full px-2 py-1.5 text-[10px] font-mono rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors resize-none leading-relaxed"
                      />
                    </div>

                    {/* Available variables reference */}
                    <div className="bg-bg-subtle border border-border rounded-md p-2 space-y-1">
                      <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1">Variables</p>
                      {([
                        ['value', 'Primary data value'],
                        ['data',  'Full API response'],
                        ['rows',  'Array rows (datasource)'],
                        ['id',    `"${selected.id.slice(0, 8)}…"`],
                        ['type',  `"${selected.type}"`],
                        ['props', 'All element props'],
                      ] as const).map(([name, hint]) => (
                        <div key={name} className="flex items-baseline gap-1.5 text-[9px]">
                          <code className="text-accent-600 dark:text-accent-400 font-semibold shrink-0">{name}</code>
                          <span className="text-text-muted truncate">{hint}</span>
                        </div>
                      ))}
                    </div>

                    {/* Test button + output */}
                    <button
                      onClick={() => {
                        const ctx = {
                          value: p?.content ?? p?.kpiValue ?? p?.src ?? null,
                          data:  p?.dataSource ?? p?.textDataSource ?? null,
                          rows:  [],
                          id:    selected.id,
                          type:  selected.type,
                          props: p ?? {},
                        };
                        setScriptOutput(runScript((p?.customScript as string) ?? '', ctx));
                      }}
                      className="w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 border border-border hover:border-accent-400 hover:text-accent-600 transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      Test script
                    </button>

                    {scriptOutput !== null && (
                      <div className={cn(
                        'rounded-md border px-2 py-1.5 text-[10px] font-mono break-all',
                        scriptOutput.startsWith('[Script Error')
                          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'
                          : 'border-border bg-bg-subtle text-text-sub',
                      )}>
                        {scriptOutput}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Canvas — always visible */}
            <div className="pt-3 space-y-3">
              <SectionHeader>Canvas</SectionHeader>
              <div>
                <Label>Background</Label>
                <ColorInput
                  value={template.background}
                  onChange={(v) => onTemplateChange({ background: v })}
                />
              </div>
              <div>
                <Label>Page size</Label>
                <select
                  value={template.pageSize}
                  onChange={(e) => onTemplateChange({ pageSize: e.target.value as ReportTemplate['pageSize'] })}
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                  <option value="A3">A3</option>
                </select>
              </div>
              <div>
                <Label>Orientation</Label>
                <div className="flex gap-1">
                  {(['portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      onClick={() => onTemplateChange({ orientation: o })}
                      className={cn(
                        'flex-1 py-1.5 text-xs rounded-md border capitalize transition-colors',
                        template.orientation === o
                          ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                          : 'border-border text-text-muted hover:text-text',
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'datasource' && isTable && (
          <div className="p-3">
            <DataSourcePanel
              key={selected?.id}
              props={p ?? {}}
              onApply={(patch) => onElementChange(patch)}
            />
          </div>
        )}

        {tab === 'datasource' && isWidget && (
          <div className="p-3">
            <WidgetDataSourcePanel
              key={selected?.id}
              props={p ?? {}}
              onApply={(patch) => onElementChange(patch)}
            />
          </div>
        )}

        {tab === 'datasource' && isChart && (
          <div className="p-3">
            <ChartDataSourcePanel
              key={selected?.id}
              props={p ?? {}}
              onApply={(patch) => onElementChange(patch)}
            />
          </div>
        )}

        {tab === 'datasource' && isText && (
          <div className="p-3">
            <TextDataSourcePanel
              key={selected?.id}
              props={p ?? {}}
              onApply={(patch) => onElementChange(patch)}
            />
          </div>
        )}

        {tab === 'schedule' && (
          <div className="p-3">
            <SchedulePanel
              schedule={template.schedule}
              onChange={(s) => onTemplateChange({ schedule: s })}
            />
          </div>
        )}

        {tab === 'recipients' && (
          <div className="p-3">
            <RecipientsPanel
              recipients={template.recipients}
              permissions={template.permissions}
              dataRecipientsConfig={template.dataRecipientsConfig}
              perRecipientUrlConfig={template.perRecipientUrlConfig}
              blocklist={template.blocklist}
              templateId={template._id}
              onChangeRecipients={(r) => onTemplateChange({ recipients: r })}
              onChangePermissions={(pp) => onTemplateChange({ permissions: pp })}
              onChangeDataRecipientsConfig={(c) => onTemplateChange({ dataRecipientsConfig: c })}
              onChangePerRecipientUrlConfig={(c) => onTemplateChange({ perRecipientUrlConfig: c })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
