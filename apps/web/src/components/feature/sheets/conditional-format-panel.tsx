'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colA1 } from '@/lib/sheets/a1';
import {
  COND_FMT_OPS,
  COND_FMT_PRESETS,
  newCondFmtRuleId,
  type CondFmtOp,
} from '@/lib/sheets/cond-fmt';
import type {
  CellStyle,
  Sheet,
  SheetCondFmtRule,
  SheetRange,
} from '@/schemas/workbook';

interface Props {
  sheet: Sheet;
  initialRange: SheetRange;
  onClose: () => void;
  onAdd: (rule: SheetCondFmtRule) => void;
  onUpdate: (id: string, patch: Partial<SheetCondFmtRule>) => void;
  onRemove: (id: string) => void;
}

export function ConditionalFormatPanel({
  sheet,
  initialRange,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  const rules = sheet.condFmt ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startNew = () => {
    const rule: SheetCondFmtRule = {
      id: newCondFmtRuleId(),
      range: initialRange,
      type: 'cellIs',
      op: 'gt',
      value: 0,
      style: COND_FMT_PRESETS[0].style,
    };
    onAdd(rule);
    setEditingId(rule.id);
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 z-40 w-[340px] bg-white border-l border-border shadow-xl flex flex-col text-[13px]">
      <div className="flex items-center justify-between px-3 h-11 border-b border-border">
        <div className="font-medium">Conditional formatting</div>
        <button
          onClick={onClose}
          className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-bg-hover"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="px-4 py-6 text-center text-text-muted text-[12px]">
            No rules yet. Add one to highlight cells that match a condition.
          </div>
        ) : (
          rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              isEditing={rule.id === editingId}
              onSelect={() =>
                setEditingId((cur) => (cur === rule.id ? null : rule.id))
              }
              onChange={(patch) => onUpdate(rule.id, patch)}
              onRemove={() => {
                onRemove(rule.id);
                if (editingId === rule.id) setEditingId(null);
              }}
            />
          ))
        )}
      </div>

      <div className="px-3 py-2 border-t border-border">
        <button
          onClick={startNew}
          className="w-full px-3 py-1.5 inline-flex items-center justify-center gap-1.5 rounded bg-accent text-white text-[12px] hover:opacity-90"
        >
          <Plus className="w-3.5 h-3.5" />
          Add another rule
        </button>
      </div>
    </div>
  );
}

interface RuleRowProps {
  rule: SheetCondFmtRule;
  isEditing: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<SheetCondFmtRule>) => void;
  onRemove: () => void;
}

function RuleRow({ rule, isEditing, onSelect, onChange, onRemove }: RuleRowProps) {
  const opDef = COND_FMT_OPS.find((x) => x.value === rule.op);
  const takes = opDef?.takes ?? 0;

  const swatch = useMemo(
    () => ({
      bg: rule.style?.bg ?? '#fff',
      fg: rule.style?.fg ?? '#000',
    }),
    [rule.style],
  );

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-bg-hover"
      >
        <span
          className="inline-flex items-center justify-center w-7 h-6 rounded text-[11px] font-semibold"
          style={{ background: swatch.bg, color: swatch.fg }}
          aria-hidden
        >
          Aa
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-text-muted">
            {rangeLabel(rule.range)}
          </div>
          <div className="truncate">{summarize(rule)}</div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-text-muted hover:text-red hover:bg-bg-subtle"
          aria-label="Remove rule"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </button>

      {isEditing && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          <Field label="Apply to range">
            <RangeInput
              range={rule.range}
              onChange={(range) => onChange({ range })}
            />
          </Field>

          <Field label="Format cells if…">
            <select
              data-no-csel
              value={rule.op}
              onChange={(e) =>
                onChange({
                  op: e.target.value as CondFmtOp,
                  // Reset value(s) when op type changes shape.
                  value: undefined,
                  value2: undefined,
                })
              }
              className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white"
            >
              {COND_FMT_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {takes >= 1 && (
            <Field label={takes === 2 ? 'Min' : 'Value'}>
              <input
                type="text"
                value={rule.value == null ? '' : String(rule.value)}
                onChange={(e) =>
                  onChange({ value: coerceInput(e.target.value) })
                }
                className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent"
              />
            </Field>
          )}
          {takes === 2 && (
            <Field label="Max">
              <input
                type="text"
                value={rule.value2 == null ? '' : String(rule.value2)}
                onChange={(e) =>
                  onChange({ value2: coerceInput(e.target.value) })
                }
                className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent"
              />
            </Field>
          )}

          <Field label="Formatting style">
            <div className="flex flex-wrap gap-1.5">
              {COND_FMT_PRESETS.map((p) => {
                const active = sameStyle(rule.style, p.style);
                return (
                  <button
                    key={p.label}
                    onClick={() => onChange({ style: p.style })}
                    title={p.label}
                    className={cn(
                      'px-2 py-1 rounded text-[11px] font-semibold border',
                      active ? 'border-accent' : 'border-transparent',
                    )}
                    style={{
                      background: p.swatch.bg,
                      color: p.swatch.fg,
                      borderStyle: 'solid',
                    }}
                  >
                    {p.label.includes('bold') ? <strong>Aa</strong> : 'Aa'}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Custom colors">
            <div className="flex items-center gap-2">
              <ColorSwatch
                label="Text"
                color={rule.style?.fg ?? null}
                onChange={(c) =>
                  onChange({
                    style: { ...(rule.style ?? {}), fg: c ?? undefined },
                  })
                }
              />
              <ColorSwatch
                label="Background"
                color={rule.style?.bg ?? null}
                onChange={(c) =>
                  onChange({
                    style: { ...(rule.style ?? {}), bg: c ?? undefined },
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    style: {
                      ...(rule.style ?? {}),
                      b: !rule.style?.b || undefined,
                    },
                  })
                }
                className={cn(
                  'w-7 h-7 inline-flex items-center justify-center rounded border text-[12px] font-bold',
                  rule.style?.b
                    ? 'border-accent bg-bg-subtle'
                    : 'border-border',
                )}
                title="Bold"
              >
                B
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    style: {
                      ...(rule.style ?? {}),
                      i: !rule.style?.i || undefined,
                    },
                  })
                }
                className={cn(
                  'w-7 h-7 inline-flex items-center justify-center rounded border text-[12px] italic',
                  rule.style?.i
                    ? 'border-accent bg-bg-subtle'
                    : 'border-border',
                )}
                title="Italic"
              >
                I
              </button>
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] text-text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}

function RangeInput({
  range,
  onChange,
}: {
  range: SheetRange;
  onChange: (range: SheetRange) => void;
}) {
  const text = rangeLabel(range);
  const [val, setVal] = useState(text);
  useEffect(() => setVal(text), [text]);

  const commit = () => {
    const parsed = parseRangeLabel(val);
    if (parsed) onChange(parsed);
    else setVal(text);
  };

  return (
    <input
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent font-mono"
    />
  );
}

function ColorSwatch({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string | null;
  onChange: (c: string | null) => void;
}) {
  return (
    <label
      className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"
      title={label}
    >
      <input
        type="color"
        value={color ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-7 p-0 border border-border rounded bg-white cursor-pointer"
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => onChange(null)}
        className="text-[10px] text-text-muted hover:text-text"
      >
        clear
      </button>
    </label>
  );
}

// ---- helpers ----

function rangeLabel(r: SheetRange): string {
  return `${colA1(r.c1)}${r.r1 + 1}:${colA1(r.c2)}${r.r2 + 1}`;
}

function parseRangeLabel(s: string): SheetRange | null {
  const m = s.trim().match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  const c1 = colToIdx(m[1]);
  const c2 = colToIdx(m[3]);
  const r1 = parseInt(m[2], 10) - 1;
  const r2 = parseInt(m[4], 10) - 1;
  if (r1 < 0 || r2 < 0) return null;
  return {
    r1: Math.min(r1, r2),
    c1: Math.min(c1, c2),
    r2: Math.max(r1, r2),
    c2: Math.max(c1, c2),
  };
}

function colToIdx(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.toUpperCase().charCodeAt(i) - 64);
  return n - 1;
}

function summarize(rule: SheetCondFmtRule): string {
  const def = COND_FMT_OPS.find((x) => x.value === rule.op);
  const verb = def?.label ?? rule.op ?? '';
  if (!def || def.takes === 0) return verb;
  if (def.takes === 1) return `${verb} ${formatValue(rule.value)}`;
  return `${verb} ${formatValue(rule.value)} and ${formatValue(rule.value2)}`;
}

function formatValue(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function coerceInput(s: string): string | number {
  const trimmed = s.trim();
  if (trimmed === '') return '';
  const n = Number(trimmed);
  if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  return s;
}

function sameStyle(a: CellStyle | undefined, b: CellStyle): boolean {
  if (!a) return false;
  const keys: Array<keyof CellStyle> = ['b', 'i', 's', 'fg', 'bg'];
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
