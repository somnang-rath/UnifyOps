import type {
  CellStyle,
  Sheet,
  SheetCondFmtRule,
} from '@/schemas/workbook';
import { rcToA1 } from './a1';
import { computeSheet, isError } from './formula';

/**
 * Conditional-formatting operators recognized by `cellIs`-type rules. The
 * panel UI exposes one form per op; the evaluator below maps each one to a
 * pure boolean check against the cell's displayed value.
 */
export type CondFmtOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le'
  | 'between'
  | 'notBetween'
  | 'isEmpty'
  | 'notEmpty'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith';

export const COND_FMT_OPS: Array<{ value: CondFmtOp; label: string; takes: 0 | 1 | 2 }> = [
  { value: 'eq', label: 'Equal to', takes: 1 },
  { value: 'ne', label: 'Not equal to', takes: 1 },
  { value: 'gt', label: 'Greater than', takes: 1 },
  { value: 'ge', label: 'Greater than or equal', takes: 1 },
  { value: 'lt', label: 'Less than', takes: 1 },
  { value: 'le', label: 'Less than or equal', takes: 1 },
  { value: 'between', label: 'Between', takes: 2 },
  { value: 'notBetween', label: 'Not between', takes: 2 },
  { value: 'contains', label: 'Text contains', takes: 1 },
  { value: 'notContains', label: "Text doesn't contain", takes: 1 },
  { value: 'startsWith', label: 'Text starts with', takes: 1 },
  { value: 'endsWith', label: 'Text ends with', takes: 1 },
  { value: 'isEmpty', label: 'Is empty', takes: 0 },
  { value: 'notEmpty', label: 'Is not empty', takes: 0 },
];

/**
 * Pre-built style presets the panel offers — keeps the UI shallow while still
 * covering the common "red / yellow / green" cases users expect from Sheets.
 */
export const COND_FMT_PRESETS: Array<{
  label: string;
  swatch: { bg: string; fg: string };
  style: CellStyle;
}> = [
  {
    label: 'Red bg + bold',
    swatch: { bg: '#fbe9e9', fg: '#d93025' },
    style: { bg: '#fbe9e9', fg: '#d93025', b: true },
  },
  {
    label: 'Yellow bg',
    swatch: { bg: '#fef7e0', fg: '#9c5700' },
    style: { bg: '#fef7e0', fg: '#9c5700' },
  },
  {
    label: 'Green bg',
    swatch: { bg: '#e6f4ea', fg: '#188038' },
    style: { bg: '#e6f4ea', fg: '#188038' },
  },
  {
    label: 'Blue bg',
    swatch: { bg: '#e8f0fe', fg: '#1967d2' },
    style: { bg: '#e8f0fe', fg: '#1967d2' },
  },
  {
    label: 'Purple bg + italic',
    swatch: { bg: '#f3e8fd', fg: '#7627bb' },
    style: { bg: '#f3e8fd', fg: '#7627bb', i: true },
  },
];

/**
 * For each cell that matches at least one rule, returns the merged style
 * (last rule wins for overlapping properties). Rules earlier in the array
 * have lower priority, mirroring Excel's "apply in order" semantics.
 *
 * The evaluator pre-computes formulas via `computeSheet` so rules see the
 * displayed value (e.g. `=A1+B1` resolves to 5 before comparing to `>3`).
 */
export function evaluateCondFmt(
  sheet: Sheet,
  computed?: Record<string, unknown>,
): Record<string, CellStyle> {
  const rules = sheet.condFmt ?? [];
  if (rules.length === 0) return {};

  const cells = sheet.cells ?? {};
  const cmp = computed ?? computeSheet(sheet);
  const out: Record<string, CellStyle> = {};

  for (const rule of rules) {
    const { range } = rule;
    if (!range) continue;
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const a1 = rcToA1(r, c);
        const cell = cells[a1];
        const raw = cell?.f ? cmp[a1] : cell?.v;
        if (isError(raw)) continue;
        if (!matches(rule, raw)) continue;
        const cur = out[a1] ?? {};
        out[a1] = { ...cur, ...(rule.style ?? {}) };
      }
    }
  }
  return out;
}

function matches(rule: SheetCondFmtRule, value: unknown): boolean {
  const op = (rule.op ?? '') as CondFmtOp;
  const v = rule.value;
  const v2 = rule.value2;

  if (op === 'isEmpty') return value == null || value === '';
  if (op === 'notEmpty') return value != null && value !== '';

  const empty = value == null || value === '';
  if (empty) return false;

  // Numeric comparators
  if (op === 'gt' || op === 'ge' || op === 'lt' || op === 'le' || op === 'eq' || op === 'ne') {
    const nv = typeof value === 'number' ? value : Number(value);
    const nt = typeof v === 'number' ? v : Number(v as string);
    if (Number.isFinite(nv) && Number.isFinite(nt)) {
      switch (op) {
        case 'gt': return nv > nt;
        case 'ge': return nv >= nt;
        case 'lt': return nv < nt;
        case 'le': return nv <= nt;
        case 'eq': return nv === nt;
        case 'ne': return nv !== nt;
      }
    }
    // Fall back to text equality for eq/ne when not numeric.
    if (op === 'eq' || op === 'ne') {
      const sv = String(value).toLowerCase();
      const st = (v == null ? '' : String(v)).toLowerCase();
      return op === 'eq' ? sv === st : sv !== st;
    }
    return false;
  }

  if (op === 'between' || op === 'notBetween') {
    const nv = typeof value === 'number' ? value : Number(value);
    const a = typeof v === 'number' ? v : Number(v as string);
    const b = typeof v2 === 'number' ? v2 : Number(v2 as string);
    if (!Number.isFinite(nv) || !Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const within = nv >= lo && nv <= hi;
    return op === 'between' ? within : !within;
  }

  // Text operators (case-insensitive)
  const sv = String(value).toLowerCase();
  const st = (v == null ? '' : String(v)).toLowerCase();
  switch (op) {
    case 'contains': return sv.includes(st);
    case 'notContains': return !sv.includes(st);
    case 'startsWith': return sv.startsWith(st);
    case 'endsWith': return sv.endsWith(st);
  }
  return false;
}

export function newCondFmtRuleId(): string {
  return 'cf_' + Math.random().toString(36).slice(2, 10);
}
