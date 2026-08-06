import { z } from 'zod';

/**
 * Automation rule conditions — the "when" between a trigger and an action.
 *
 * `Automation.condition` has been stored since the module was written but
 * `fire()` never read it, so **every enabled rule ran on every event of its
 * trigger**. A rule meant for `priority = urgent` re-assigned every issue in
 * the workspace. This file is the missing half; `docs/plan/06-differentiators.md`
 * §4c blocks the rule-builder UI on it, because a builder that renders a field
 * the engine ignores is worse than no builder.
 *
 * ## Design constraints
 *
 * Rule authors are ordinary workspace members, and a condition is data that one
 * member writes and the server later executes on other members' issues. So:
 * no expressions, no code, no regex (catastrophic backtracking), no field paths
 * that can walk into a prototype. Just a fixed operator set over the flat event
 * payload, with a bounded nesting depth.
 *
 * ## Grammar
 *
 * ```
 * Condition :=
 *     {}                                 always matches (every existing rule)
 *   | { field, op, value? }              one clause
 *   | { all: Condition[] }               every branch matches
 *   | { any: Condition[] }               at least one branch matches
 *   | { not: Condition }                 negation
 *   | { <key>: <scalar>, … }             shorthand: every key is an `eq`, ANDed
 * ```
 *
 * The shorthand exists for two reasons: `{ status: 'done', priority: 'high' }`
 * is what people actually try to write, and conditions predating this file were
 * stored through a `z.record(z.unknown())` DTO that accepted exactly that. It is
 * only consulted when none of `field` / `all` / `any` / `not` is present, so it
 * can never shadow the explicit forms.
 *
 * ## Fail closed
 *
 * A condition that cannot be understood means the rule does **not** run. The
 * alternative — treating "unparseable" as "matches" — restores the exact bug
 * this file fixes, and does so silently. {@link evaluateCondition} therefore
 * returns a reason instead of a boolean when it cannot decide, and `fire()`
 * records that in the automation log so a broken rule is visible rather than
 * mysteriously idle.
 */

/** Operators. Deliberately small — every one is a total function on strings. */
export const CONDITION_OPS = [
  'eq',
  'ne',
  'in',
  'nin',
  'contains',
  'exists',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** How deep `all`/`any`/`not` may nest before we refuse to evaluate. */
export const MAX_CONDITION_DEPTH = 5;
/** How many branches one group may hold. */
const MAX_BRANCHES = 20;

/** A scalar a clause may compare against. */
const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

/**
 * Keys that mean something to the grammar itself. An object carrying any of
 * them is an attempt at a clause or a group, so it must be parsed as one — see
 * the note on `shorthand` below for why this matters more than it looks.
 */
const RESERVED_KEYS = ['field', 'op', 'value', 'all', 'any', 'not'] as const;

/**
 * Field names that address the object machinery rather than the payload.
 * `readField` already goes through `hasOwnProperty`, so these are inert at
 * evaluation time; rejecting them at write time keeps a rule that could only
 * ever be a mistake out of the database.
 */
const FORBIDDEN_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);

const fieldName = z
  .string()
  .min(1)
  .max(60)
  // Word characters only: no dotted paths, conditions address the flat payload.
  .regex(/^\w+$/, 'field must be a plain payload key')
  .refine((f) => !FORBIDDEN_FIELDS.has(f), 'field addresses the prototype, not the payload');

const clauseSchema = z
  .object({
    field: fieldName,
    op: z.enum(CONDITION_OPS),
    value: z.union([scalar, z.array(scalar).max(50)]).optional(),
  })
  .strict()
  // Operand arity, checked on write so `in` with a bare string is a 400 the
  // author sees rather than a rule that fails closed forever in silence.
  .refine(
    (c) => (c.op === 'in' || c.op === 'nin' ? Array.isArray(c.value) : true),
    { message: '"in"/"nin" need an array value' },
  )
  .refine(
    (c) => (c.op === 'in' || c.op === 'nin' || c.op === 'exists' ? true : !Array.isArray(c.value)),
    { message: 'this operator takes a single value, not an array' },
  )
  .refine(
    (c) => (c.op === 'exists' ? true : c.value !== undefined),
    { message: 'this operator needs a value' },
  );

export type ConditionClause = z.infer<typeof clauseSchema>;

export type Condition =
  | Record<string, never>
  | ConditionClause
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Record<string, unknown>;

/**
 * Zod schema for the stored condition, used by the DTO so a malformed rule is
 * rejected at write time (a 400 the author can act on) rather than silently
 * never firing later.
 *
 * Depth is enforced by construction: the recursion is built `MAX_CONDITION_DEPTH`
 * levels deep and bottoms out at "clause or shorthand only".
 */
function buildConditionSchema(depth: number): z.ZodType<Record<string, unknown>> {
  /*
   * The shorthand: an object of scalar values, each an implicit `eq`.
   *
   * It MUST refuse the grammar's own keys. Without that guard it silently
   * rescues malformed clauses — `{ field: 'priority', op: 'regex', value: '.*' }`
   * fails `clauseSchema` (no such operator) but parses perfectly as three scalar
   * keys, so the rule stores with a 201 and then never matches anything, because
   * no payload has a `field` key equal to "priority". That is the same
   * silently-dead-rule failure this whole file exists to remove, arriving
   * through the ergonomic shortcut instead of the missing evaluator.
   */
  const shorthand = z
    .record(scalar)
    .refine((o) => !RESERVED_KEYS.some((k) => k in o), {
      message:
        'looks like a clause or group but is not valid — check `op` against the supported operators',
    })
    .refine((o) => Object.keys(o).every((k) => /^\w+$/.test(k) && !FORBIDDEN_FIELDS.has(k)), {
      message: 'shorthand keys must be plain payload keys',
    });
  const leaf = z.union([clauseSchema, shorthand]);
  if (depth <= 1) return leaf;

  const inner = buildConditionSchema(depth - 1);
  return z.union([
    clauseSchema,
    z.object({ all: z.array(inner).min(1).max(MAX_BRANCHES) }).strict(),
    z.object({ any: z.array(inner).min(1).max(MAX_BRANCHES) }).strict(),
    z.object({ not: inner }).strict(),
    shorthand,
  ]);
}

export const ConditionSchema = buildConditionSchema(MAX_CONDITION_DEPTH);

/** What the engine gets back. `ok: false` means "refuse to run this rule". */
export type ConditionResult =
  | { ok: true; matched: boolean }
  | { ok: false; reason: string };

/** Read a flat payload key without ever touching the prototype chain. */
function readField(
  payload: Record<string, unknown>,
  field: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(payload, field)
    ? payload[field]
    : undefined;
}

/**
 * Normalize a payload value or a clause operand to a comparable string.
 *
 * Comparison is case-insensitive and trimmed. Statuses, priorities and labels
 * are free-text in this codebase, and a rule that silently fails because the
 * author typed `Done` instead of `done` is indistinguishable from the bug this
 * whole file exists to fix. ObjectIds are hex, so folding case cannot collide.
 */
function norm(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v !== 'string') return undefined;
  return v.trim().toLowerCase();
}

function evalClause(
  clause: ConditionClause,
  payload: Record<string, unknown>,
): ConditionResult {
  const actual = norm(readField(payload, clause.field));

  switch (clause.op) {
    case 'exists': {
      // `value` defaults to true: `{ field: 'assigneeId', op: 'exists' }` reads
      // as "has an assignee", which is how anyone would expect it to read.
      const want = clause.value === undefined ? true : Boolean(clause.value);
      const present = actual !== undefined && actual !== '';
      return { ok: true, matched: present === want };
    }

    case 'eq':
    case 'ne': {
      const want = norm(clause.value);
      if (want === undefined) {
        return { ok: false, reason: `${clause.op} on "${clause.field}" needs a value` };
      }
      const equal = actual === want;
      // `ne` is the strict negation, so a *missing* field satisfies it. When
      // the author means "present and different", they want `all: [exists, ne]`.
      return { ok: true, matched: clause.op === 'eq' ? equal : !equal };
    }

    case 'in':
    case 'nin': {
      if (!Array.isArray(clause.value)) {
        return { ok: false, reason: `${clause.op} on "${clause.field}" needs an array` };
      }
      const set = new Set(clause.value.map(norm).filter((v) => v !== undefined));
      const hit = actual !== undefined && set.has(actual);
      return { ok: true, matched: clause.op === 'in' ? hit : !hit };
    }

    case 'contains': {
      const needle = norm(clause.value);
      if (needle === undefined) {
        return { ok: false, reason: `contains on "${clause.field}" needs a value` };
      }
      // Plain substring, never a regex — a rule author must not be able to hand
      // the server a pattern that runs for seconds on a long issue title.
      return { ok: true, matched: actual !== undefined && actual.includes(needle) };
    }

    default: {
      // Unreachable while CONDITION_OPS and this switch agree; kept because an
      // op added to the list but not here must fail closed, not fall through
      // to "matched".
      const op: never = clause.op;
      return { ok: false, reason: `unknown operator "${String(op)}"` };
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Decide whether a rule's condition matches an event payload.
 *
 * Returns `{ ok: false }` — never a silent `true` — when the condition is
 * malformed, too deep, or uses an unknown operator. See the fail-closed note at
 * the top of this file.
 */
export function evaluateCondition(
  condition: unknown,
  payload: Record<string, unknown>,
  depth = 0,
): ConditionResult {
  if (condition === undefined || condition === null) return { ok: true, matched: true };

  if (!isPlainObject(condition)) {
    return { ok: false, reason: 'condition must be an object' };
  }

  const keys = Object.keys(condition);
  // The overwhelmingly common case, and every rule written before this file
  // existed: no condition at all.
  if (keys.length === 0) return { ok: true, matched: true };

  if (depth > MAX_CONDITION_DEPTH) {
    return { ok: false, reason: `condition nested deeper than ${MAX_CONDITION_DEPTH}` };
  }

  // ── groups ──────────────────────────────────────────────────────────────
  if ('all' in condition || 'any' in condition) {
    const isAll = 'all' in condition;
    const branches = isAll ? condition.all : condition.any;
    if (!Array.isArray(branches) || branches.length === 0) {
      return { ok: false, reason: `"${isAll ? 'all' : 'any'}" must be a non-empty array` };
    }
    if (branches.length > MAX_BRANCHES) {
      return { ok: false, reason: `too many branches (max ${MAX_BRANCHES})` };
    }

    let anyMatched = false;
    for (const branch of branches) {
      const r = evaluateCondition(branch, payload, depth + 1);
      // One unparseable branch poisons the whole condition. Short-circuiting on
      // a match instead would make validity depend on branch order.
      if (!r.ok) return r;
      if (isAll && !r.matched) return { ok: true, matched: false };
      if (r.matched) anyMatched = true;
    }
    return { ok: true, matched: isAll ? true : anyMatched };
  }

  if ('not' in condition) {
    const r = evaluateCondition(condition.not, payload, depth + 1);
    return r.ok ? { ok: true, matched: !r.matched } : r;
  }

  // ── single clause ───────────────────────────────────────────────────────
  if ('field' in condition) {
    const parsed = clauseSchema.safeParse(condition);
    if (!parsed.success) {
      return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid clause' };
    }
    return evalClause(parsed.data, payload);
  }

  // ── shorthand: { status: 'done', priority: 'high' } ─────────────────────
  // `op` / `value` without `field` is a half-written clause, not a shorthand —
  // reading it as one would compare a payload key named "op" and match nothing.
  if ('op' in condition || 'value' in condition) {
    return { ok: false, reason: 'clause is missing its "field"' };
  }
  for (const [field, value] of Object.entries(condition)) {
    if (!/^\w+$/.test(field) || FORBIDDEN_FIELDS.has(field)) {
      return { ok: false, reason: `invalid field name "${field}"` };
    }
    if (isPlainObject(value) || Array.isArray(value)) {
      return { ok: false, reason: `shorthand "${field}" must be a scalar` };
    }
    const r = evalClause({ field, op: 'eq', value: value as never }, payload);
    if (!r.ok) return r;
    if (!r.matched) return { ok: true, matched: false };
  }
  return { ok: true, matched: true };
}
