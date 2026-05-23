'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colA1 } from '@/lib/sheets/a1';
import { newValidationRuleId } from '@/lib/sheets/validation';
import type {
  Sheet,
  SheetRange,
  SheetValidationRule,
} from '@/schemas/workbook';

interface Props {
  sheet: Sheet;
  initialRange: SheetRange;
  onClose: () => void;
  onAdd: (rule: SheetValidationRule) => void;
  onUpdate: (id: string, patch: Partial<SheetValidationRule>) => void;
  onRemove: (id: string) => void;
}

const TYPE_OPTIONS: Array<{
  value: SheetValidationRule['type'];
  label: string;
}> = [
  { value: 'list', label: 'Dropdown list' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'text', label: 'Text' },
];

const NUMBER_OPS: Array<{ value: string; label: string; takes: 1 | 2 }> = [
  { value: 'between', label: 'Between', takes: 2 },
  { value: 'gt', label: 'Greater than', takes: 1 },
  { value: 'ge', label: 'Greater than or equal', takes: 1 },
  { value: 'lt', label: 'Less than', takes: 1 },
  { value: 'le', label: 'Less than or equal', takes: 1 },
  { value: 'eq', label: 'Equal to', takes: 1 },
];

const TEXT_OPS: Array<{ value: string; label: string }> = [
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: "Doesn't contain" },
  { value: 'eq', label: 'Equal to' },
];

export function DataValidationPanel({
  sheet,
  initialRange,
  onClose,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  const rules = sheet.validations ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startNew = () => {
    const rule: SheetValidationRule = {
      id: newValidationRuleId(),
      range: initialRange,
      type: 'list',
      values: [],
      strict: false,
    };
    onAdd(rule);
    setEditingId(rule.id);
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 z-40 w-[340px] bg-white border-l border-border shadow-xl flex flex-col text-[13px]">
      <div className="flex items-center justify-between px-3 h-11 border-b border-border">
        <div className="font-medium">Data validation</div>
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
            No validation rules. Add one to restrict the values allowed in a
            range.
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
  rule: SheetValidationRule;
  isEditing: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<SheetValidationRule>) => void;
  onRemove: () => void;
}

function RuleRow({ rule, isEditing, onSelect, onChange, onRemove }: RuleRowProps) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-bg-hover"
      >
        <span className="inline-flex items-center justify-center w-7 h-6 rounded bg-bg-subtle text-[11px] font-semibold uppercase tracking-wider">
          {rule.type.slice(0, 2)}
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

          <Field label="Criteria">
            <select
              data-no-csel
              value={rule.type}
              onChange={(e) =>
                onChange({
                  type: e.target.value as SheetValidationRule['type'],
                  values: undefined,
                  op: undefined,
                  min: undefined,
                  max: undefined,
                })
              }
              className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {rule.type === 'list' && (
            <Field label="Allowed values">
              <textarea
                value={(rule.values ?? []).join('\n')}
                onChange={(e) =>
                  onChange({
                    values: e.target.value
                      .split('\n')
                      .map((v) => v.trim())
                      .filter((v) => v.length > 0),
                  })
                }
                placeholder="One per line"
                rows={4}
                className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent font-mono"
              />
            </Field>
          )}

          {rule.type === 'number' && (
            <>
              <Field label="Operator">
                <select
                  data-no-csel
                  value={rule.op ?? 'between'}
                  onChange={(e) =>
                    onChange({ op: e.target.value, min: undefined, max: undefined })
                  }
                  className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white"
                >
                  {NUMBER_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={rule.op === 'between' ? 'Min' : 'Value'}>
                <input
                  type="number"
                  value={rule.min ?? ''}
                  onChange={(e) =>
                    onChange({
                      min: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                  className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent"
                />
              </Field>
              {rule.op === 'between' && (
                <Field label="Max">
                  <input
                    type="number"
                    value={rule.max ?? ''}
                    onChange={(e) =>
                      onChange({
                        max: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent"
                  />
                </Field>
              )}
            </>
          )}

          {rule.type === 'text' && (
            <>
              <Field label="Operator">
                <select
                  data-no-csel
                  value={rule.op ?? 'contains'}
                  onChange={(e) => onChange({ op: e.target.value })}
                  className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white"
                >
                  {TEXT_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Text">
                <input
                  type="text"
                  value={rule.values?.[0] ?? ''}
                  onChange={(e) => onChange({ values: [e.target.value] })}
                  className="w-full text-[12px] py-1 px-2 border border-border rounded bg-white outline-none focus:border-accent"
                />
              </Field>
            </>
          )}

          {(rule.type === 'checkbox' || rule.type === 'list') && (
            <div className="text-[11px] text-text-muted leading-snug">
              {rule.type === 'checkbox'
                ? 'Cells in the range will render as checkboxes; toggling writes TRUE/FALSE.'
                : 'Cells in the range will show a dropdown arrow when selected.'}
            </div>
          )}

          <Field label="On invalid data">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onChange({ strict: false })}
                className={cn(
                  'flex-1 py-1 text-[12px] rounded border',
                  !rule.strict
                    ? 'border-accent bg-bg-subtle'
                    : 'border-border',
                )}
              >
                Show warning
              </button>
              <button
                type="button"
                onClick={() => onChange({ strict: true })}
                className={cn(
                  'flex-1 py-1 text-[12px] rounded border',
                  rule.strict
                    ? 'border-accent bg-bg-subtle'
                    : 'border-border',
                )}
              >
                Reject input
              </button>
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  for (let i = 0; i < s.length; i++)
    n = n * 26 + (s.toUpperCase().charCodeAt(i) - 64);
  return n - 1;
}

function summarize(rule: SheetValidationRule): string {
  switch (rule.type) {
    case 'list':
      return rule.values && rule.values.length > 0
        ? `One of: ${rule.values.slice(0, 3).join(', ')}${
            rule.values.length > 3 ? '…' : ''
          }`
        : 'List (no values)';
    case 'checkbox':
      return 'Checkbox';
    case 'number': {
      const op = rule.op ?? 'between';
      if (op === 'between')
        return `Number between ${fmt(rule.min)} and ${fmt(rule.max)}`;
      return `Number ${opSymbol(op)} ${fmt(rule.min)}`;
    }
    case 'date':
      return 'Valid date';
    case 'text': {
      const op = rule.op ?? 'contains';
      const v = rule.values?.[0] ?? '';
      return `Text ${op} "${v}"`;
    }
  }
  return rule.type;
}

function opSymbol(op: string): string {
  switch (op) {
    case 'gt':
      return '>';
    case 'ge':
      return '≥';
    case 'lt':
      return '<';
    case 'le':
      return '≤';
    case 'eq':
      return '=';
  }
  return op;
}

function fmt(n: number | undefined): string {
  return n == null ? '—' : String(n);
}
