'use client';
import { useState } from 'react';
import { BarChart3, BarChartHorizontal, ChartArea, LineChart, PieChart, ScatterChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, Input } from '@/components/ui/input';
import { a1Col, colA1 } from '@/lib/sheets/a1';
import { cn } from '@/lib/utils';
import type { ChartType, Sheet, SheetChart } from '@/schemas/workbook';
import { ChartView } from './chart-view';

interface Props {
  open: boolean;
  /** When editing, the existing chart; when creating, a freshly-built draft. */
  chart: SheetChart;
  sheet: Sheet;
  computed: Record<string, unknown>;
  isNew: boolean;
  onClose: () => void;
  onSave: (chart: SheetChart) => void;
}

const TYPES: Array<{ type: ChartType; label: string; icon: React.ReactNode }> = [
  { type: 'column', label: 'Column', icon: <BarChart3 className="w-4 h-4" /> },
  { type: 'bar', label: 'Bar', icon: <BarChartHorizontal className="w-4 h-4" /> },
  { type: 'line', label: 'Line', icon: <LineChart className="w-4 h-4" /> },
  { type: 'area', label: 'Area', icon: <ChartArea className="w-4 h-4" /> },
  { type: 'pie', label: 'Pie', icon: <PieChart className="w-4 h-4" /> },
  { type: 'scatter', label: 'Scatter', icon: <ScatterChart className="w-4 h-4" /> },
];

function rangeToStr(r: SheetChart['range']): string {
  return `${colA1(r.c1)}${r.r1 + 1}:${colA1(r.c2)}${r.r2 + 1}`;
}

function parseRange(str: string): SheetChart['range'] | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(str.trim().toUpperCase());
  if (!m) return null;
  const c1 = a1Col(m[1]);
  const r1 = parseInt(m[2], 10) - 1;
  const c2 = a1Col(m[3]);
  const r2 = parseInt(m[4], 10) - 1;
  if ([c1, r1, c2, r2].some((n) => n < 0 || Number.isNaN(n))) return null;
  return {
    r1: Math.min(r1, r2),
    c1: Math.min(c1, c2),
    r2: Math.max(r1, r2),
    c2: Math.max(c1, c2),
  };
}

export function ChartConfigModal({
  open,
  chart,
  sheet,
  computed,
  isNew,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<SheetChart>(chart);
  const [rangeStr, setRangeStr] = useState(rangeToStr(chart.range));
  const [rangeErr, setRangeErr] = useState('');

  const patch = (p: Partial<SheetChart>) => setDraft((d) => ({ ...d, ...p }));

  const commitRange = (str: string) => {
    setRangeStr(str);
    const parsed = parseRange(str);
    if (parsed) {
      setRangeErr('');
      patch({ range: parsed });
    } else {
      setRangeErr('Use A1:D8 format');
    }
  };

  const stackable = draft.type === 'column' || draft.type === 'bar' || draft.type === 'area';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isNew ? 'Insert chart' : 'Edit chart'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            {isNew ? 'Insert' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[260px_1fr] gap-5">
        {/* ---- Controls ---- */}
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
              Chart type
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {TYPES.map((t) => (
                <button
                  key={t.type}
                  onClick={() => patch({ type: t.type })}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2 rounded-md border text-[11px] transition-colors',
                    draft.type === t.type
                      ? 'border-accent bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent'
                      : 'border-border hover:bg-bg-hover text-text-sub',
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Title">
            <Input
              value={draft.title ?? ''}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Chart title"
            />
          </Field>

          <Field label="Data range">
            <Input
              value={rangeStr}
              onChange={(e) => commitRange(e.target.value)}
              placeholder="A1:D8"
            />
          </Field>
          {rangeErr && <p className="text-[12px] text-red-500 -mt-2">{rangeErr}</p>}

          <div className="space-y-2 pt-1">
            <Check
              label="Use first row as headers"
              checked={draft.headerRow}
              onChange={(v) => patch({ headerRow: v })}
            />
            <Check
              label="Use first column as labels"
              checked={draft.headerCol}
              onChange={(v) => patch({ headerCol: v })}
            />
            <Check
              label="Show legend"
              checked={draft.legend}
              onChange={(v) => patch({ legend: v })}
            />
            {stackable && (
              <Check
                label="Stack series"
                checked={draft.stacked}
                onChange={(v) => patch({ stacked: v })}
              />
            )}
          </div>
        </div>

        {/* ---- Live preview ---- */}
        <div className="flex flex-col">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
            Preview
          </p>
          <div className="flex-1 border border-border rounded-md bg-white p-3 min-h-[300px] flex flex-col">
            {draft.title && (
              <div className="text-center text-[13px] font-semibold text-text mb-1">
                {draft.title}
              </div>
            )}
            <div className="flex-1 min-h-0">
              <ChartView sheet={sheet} computed={computed} chart={draft} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-text-sub cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--a)] w-3.5 h-3.5"
      />
      {label}
    </label>
  );
}
