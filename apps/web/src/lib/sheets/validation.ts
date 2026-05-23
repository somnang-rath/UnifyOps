import type { Sheet, SheetValidationRule } from '@/schemas/workbook';

/**
 * Resolve the validation rule that applies to a cell (the first rule whose
 * range contains the cell, mirroring Excel/Sheets where later rules don't
 * stack). Returns null if no rule matches.
 */
export function ruleForCell(
  sheet: Sheet,
  r: number,
  c: number,
): SheetValidationRule | null {
  const rules = sheet.validations ?? [];
  for (const rule of rules) {
    const { range } = rule;
    if (!range) continue;
    if (r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2) {
      return rule;
    }
  }
  return null;
}

export type ValidationOutcome =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Check whether `raw` (the user-entered string) satisfies the rule. Used by
 * the editor commit path: when `rule.strict` is true and the outcome is
 * `ok: false`, the commit should be rejected.
 *
 * The check is intentionally tolerant about formulas — if the user enters a
 * formula, validation runs against the literal source rather than the
 * computed value, to avoid blocking legitimate references. Strict-mode
 * implementations that need formula awareness should validate post-compute.
 */
export function validateInput(
  rule: SheetValidationRule | null,
  raw: string,
): ValidationOutcome {
  if (!rule) return { ok: true };
  if (raw === '') return { ok: true };
  if (raw.startsWith('=')) return { ok: true };

  switch (rule.type) {
    case 'checkbox': {
      const upper = raw.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') return { ok: true };
      return { ok: false, reason: 'Must be TRUE or FALSE' };
    }
    case 'list': {
      const allowed = rule.values ?? [];
      if (allowed.length === 0) return { ok: true };
      // Empty match if rule isn't strict allows free entry. Strict callers
      // get a rejection that the UI surfaces as a toast.
      const hit = allowed.some((v) => v === raw);
      return hit
        ? { ok: true }
        : { ok: false, reason: 'Value is not in the allowed list' };
    }
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n) || !Number.isFinite(n)) {
        return { ok: false, reason: 'Must be a number' };
      }
      const op = rule.op ?? 'any';
      if (op === 'between') {
        if (rule.min == null || rule.max == null) return { ok: true };
        const lo = Math.min(rule.min, rule.max);
        const hi = Math.max(rule.min, rule.max);
        return n >= lo && n <= hi
          ? { ok: true }
          : {
              ok: false,
              reason: `Must be between ${lo} and ${hi}`,
            };
      }
      const target = rule.min;
      if (target == null) return { ok: true };
      switch (op) {
        case 'gt':
          return n > target ? { ok: true } : { ok: false, reason: `Must be > ${target}` };
        case 'ge':
          return n >= target ? { ok: true } : { ok: false, reason: `Must be ≥ ${target}` };
        case 'lt':
          return n < target ? { ok: true } : { ok: false, reason: `Must be < ${target}` };
        case 'le':
          return n <= target ? { ok: true } : { ok: false, reason: `Must be ≤ ${target}` };
        case 'eq':
          return n === target ? { ok: true } : { ok: false, reason: `Must equal ${target}` };
      }
      return { ok: true };
    }
    case 'date': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, reason: 'Must be a valid date' };
      }
      return { ok: true };
    }
    case 'text': {
      const op = rule.op ?? 'any';
      const v = rule.values?.[0] ?? '';
      const s = raw.toLowerCase();
      const t = v.toLowerCase();
      switch (op) {
        case 'contains':
          return s.includes(t)
            ? { ok: true }
            : { ok: false, reason: `Must contain "${v}"` };
        case 'notContains':
          return !s.includes(t)
            ? { ok: true }
            : { ok: false, reason: `Must not contain "${v}"` };
        case 'eq':
          return s === t ? { ok: true } : { ok: false, reason: `Must equal "${v}"` };
      }
      return { ok: true };
    }
  }
  return { ok: true };
}

/**
 * For display: does `value` (already-resolved cell value) satisfy `rule`?
 * Used to surface the small red marker on invalid cells without re-parsing
 * input strings.
 */
export function isValueValid(
  rule: SheetValidationRule | null,
  value: unknown,
): boolean {
  if (!rule) return true;
  if (value == null || value === '') return true;
  return validateInput(rule, String(value)).ok;
}

export function newValidationRuleId(): string {
  return 'dv_' + Math.random().toString(36).slice(2, 10);
}
