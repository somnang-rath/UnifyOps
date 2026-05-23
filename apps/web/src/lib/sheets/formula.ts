import { a1ToRC, normalizeRange, rcToA1 } from './a1';
import type { NamedRange, Sheet } from '@/schemas/workbook';

// ---- Errors ----
export const ERR = {
  REF: '#REF!',
  NAME: '#NAME?',
  VALUE: '#VALUE!',
  DIV0: '#DIV/0!',
  CIRC: '#CIRCULAR!',
  ERROR: '#ERROR!',
  NA: '#N/A',
} as const;

export function isError(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('#') && (v.endsWith('!') || v === '#N/A');
}

export function isFormula(text: unknown): text is string {
  return typeof text === 'string' && text.startsWith('=');
}

// ---- Tokenizer ----
type Token =
  | { type: 'num'; val: number }
  | { type: 'str'; val: string }
  | { type: 'ref'; val: string }
  | { type: 'id'; val: string }
  | { type: 'op'; val: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      let s = '';
      while (i < n && /[\d.]/.test(src[i])) s += src[i++];
      if (i < n && (src[i] === 'e' || src[i] === 'E')) {
        s += src[i++];
        if (src[i] === '+' || src[i] === '-') s += src[i++];
        while (i < n && /\d/.test(src[i])) s += src[i++];
      }
      out.push({ type: 'num', val: parseFloat(s) });
      continue;
    }
    if (c === '"') {
      i++;
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && src[i + 1] === '"') {
          s += '"';
          i += 2;
        } else s += src[i++];
      }
      i++;
      out.push({ type: 'str', val: s });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let s = '';
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) s += src[i++];
      // Strip $ for absolute-ref detection ($A$1, $A1, A$1 → A1 style)
      const stripped = s.replace(/\$/g, '');
      if (/^[A-Za-z]+\d+$/.test(stripped)) {
        out.push({ type: 'ref', val: stripped.toUpperCase() });
      } else {
        out.push({ type: 'id', val: stripped.toUpperCase() });
      }
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ type: 'op', val: two });
      i += 2;
      continue;
    }
    out.push({ type: 'op', val: c });
    i++;
  }
  return out;
}

// ---- AST ----
type Node =
  | { type: 'num'; v: number }
  | { type: 'str'; v: string }
  | { type: 'bool'; v: boolean }
  | { type: 'ref'; a1: string }
  | { type: 'range'; a: string; b: string }
  | { type: 'colrange'; startCol: string; endCol: string }
  | { type: 'named'; name: string }
  | { type: 'fn'; name: string; args: Node[] }
  | { type: 'bin'; op: string; l: Node; r: Node }
  | { type: 'neg'; v: Node }
  | { type: 'pos'; v: Node }
  | { type: 'pct'; v: Node };

class ParseErr extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function parse(src: string): Node {
  const tokens = tokenize(src);
  let i = 0;

  const peek = () => tokens[i];
  const eat = (val?: string) => {
    const t = tokens[i];
    if (!t) throw new ParseErr(ERR.ERROR);
    if (val !== undefined && t.val !== val) throw new ParseErr(ERR.ERROR);
    i++;
    return t;
  };

  function expr(): Node {
    return comparison();
  }
  function comparison(): Node {
    let left = concat();
    while (
      peek() &&
      ['=', '<', '>', '<=', '>=', '<>'].includes(String(peek().val))
    ) {
      const op = String(eat().val);
      left = { type: 'bin', op, l: left, r: concat() };
    }
    return left;
  }
  function concat(): Node {
    let left = addsub();
    while (peek()?.val === '&') {
      eat();
      left = { type: 'bin', op: '&', l: left, r: addsub() };
    }
    return left;
  }
  function addsub(): Node {
    let left = muldiv();
    while (peek() && (peek().val === '+' || peek().val === '-')) {
      const op = String(eat().val);
      left = { type: 'bin', op, l: left, r: muldiv() };
    }
    return left;
  }
  function muldiv(): Node {
    let left = power();
    while (peek() && (peek().val === '*' || peek().val === '/')) {
      const op = String(eat().val);
      left = { type: 'bin', op, l: left, r: power() };
    }
    return left;
  }
  function power(): Node {
    let left = percent();
    if (peek()?.val === '^') {
      eat();
      left = { type: 'bin', op: '^', l: left, r: power() };
    }
    return left;
  }
  function percent(): Node {
    let v = unary();
    while (peek()?.val === '%') {
      eat();
      v = { type: 'pct', v };
    }
    return v;
  }
  function unary(): Node {
    if (peek()?.val === '-') {
      eat();
      return { type: 'neg', v: unary() };
    }
    if (peek()?.val === '+') {
      eat();
      return { type: 'pos', v: unary() };
    }
    return atom();
  }
  function atom(): Node {
    const t = peek();
    if (!t) throw new ParseErr(ERR.ERROR);
    if (t.type === 'num') {
      eat();
      return { type: 'num', v: t.val as number };
    }
    if (t.type === 'str') {
      eat();
      return { type: 'str', v: t.val as string };
    }
    if (t.type === 'ref') {
      eat();
      if (peek()?.val === ':') {
        eat();
        const end = peek();
        if (!end || end.type !== 'ref') throw new ParseErr(ERR.ERROR);
        eat();
        let a = t.val as string;
        let b = end.val as string;
        // Collapse multi-colon ranges like C3:D3:E3 → bounding box C3:E3
        while (peek()?.val === ':' && tokens[i + 1]?.type === 'ref') {
          eat(); // ':'
          const next = eat();
          const ra = a1ToRC(a);
          const rb = a1ToRC(b);
          const rn = a1ToRC(next.val as string);
          if (ra && rb && rn) {
            a = rcToA1(Math.min(ra.r, rb.r, rn.r), Math.min(ra.c, rb.c, rn.c));
            b = rcToA1(Math.max(ra.r, rb.r, rn.r), Math.max(ra.c, rb.c, rn.c));
          }
        }
        return { type: 'range', a, b };
      }
      return { type: 'ref', a1: t.val as string };
    }
    if (t.type === 'id') {
      const name = String(t.val);
      eat();
      if (name === 'TRUE') return { type: 'bool', v: true };
      if (name === 'FALSE') return { type: 'bool', v: false };
      if (peek()?.val === '(') {
        eat('(');
        const args: Node[] = [];
        if (peek()?.val !== ')') {
          args.push(expr());
          while (peek()?.val === ',') {
            eat();
            args.push(expr());
          }
        }
        if (peek()?.val !== ')') throw new ParseErr(ERR.ERROR);
        eat(')');
        return { type: 'fn', name, args };
      }
      // Whole-column range: A:A, B:D, A:B5
      if (/^[A-Z]+$/.test(name) && peek()?.val === ':') {
        eat();
        const endTok = peek();
        if (!endTok) throw new ParseErr(ERR.ERROR);
        if (endTok.type === 'ref') {
          eat();
          return { type: 'range', a: name + '1', b: String(endTok.val) };
        }
        if (endTok.type === 'id' && /^[A-Z]+$/.test(String(endTok.val))) {
          eat();
          return { type: 'colrange', startCol: name, endCol: String(endTok.val) };
        }
        throw new ParseErr(ERR.ERROR);
      }
      return { type: 'named', name };
    }
    if (t.val === '(') {
      eat('(');
      const e = expr();
      if (peek()?.val !== ')') throw new ParseErr(ERR.ERROR);
      eat(')');
      return e;
    }
    throw new ParseErr(ERR.ERROR);
  }

  const ast = expr();
  if (i < tokens.length) throw new ParseErr(ERR.ERROR);
  return ast;
}

// ---- Coercions ----
function toNum(v: unknown): number | string {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null || v === '') return 0;
  if (typeof v === 'string') {
    if (isError(v)) return v;
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
    return ERR.VALUE;
  }
  return ERR.VALUE;
}

function toStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function toBool(v: unknown): boolean | string {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    if (isError(v)) return v;
    if (v.toUpperCase() === 'TRUE') return true;
    if (v.toUpperCase() === 'FALSE') return false;
  }
  return Boolean(v);
}

// ---- Evaluator ----
const MAX_EVAL_DEPTH = 100;

interface EvalCtx {
  sheet: Sheet;
  computed: Record<string, unknown>;
  stack: Set<string>;
  namedRanges?: NamedRange[];
  /** A1 address of the cell currently being evaluated (for ROW/COLUMN no-arg). */
  activeCellA1?: string;
  /** Current recursion depth — guards against deeply nested formulas causing a stack overflow. */
  depth: number;
}

function evalNode(node: Node, ctx: EvalCtx): unknown {
  if (ctx.depth >= MAX_EVAL_DEPTH) return ERR.ERROR;
  ctx.depth++;
  try {
  switch (node.type) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'bool':
      return node.v;
    case 'neg': {
      const v = toNum(evalNode(node.v, ctx));
      return typeof v === 'string' ? v : -v;
    }
    case 'pos': {
      const v = toNum(evalNode(node.v, ctx));
      return typeof v === 'string' ? v : v;
    }
    case 'pct': {
      const v = toNum(evalNode(node.v, ctx));
      return typeof v === 'string' ? v : v / 100;
    }
    case 'ref':
      return evalRef(node.a1, ctx);
    case 'named': {
      const nr = ctx.namedRanges?.find(
        (r) => r.name === node.name && r.sheetId === ctx.sheet.id,
      );
      if (!nr) return ERR.NAME;
      const { r1, c1, r2, c2 } = nr.range;
      if (r1 === r2 && c1 === c2) return computeCell(rcToA1(r1, c1), ctx);
      return evalRange(rcToA1(r1, c1), rcToA1(r2, c2), ctx);
    }
    case 'colrange':
      return evalRange(
        node.startCol + '1',
        node.endCol + ctx.sheet.rowCount,
        ctx,
      );
    case 'range':
      return evalRange(node.a, node.b, ctx);
    case 'fn':
      return evalFn(node.name, node.args, ctx);
    case 'bin':
      return evalBin(node.op, node.l, node.r, ctx);
  }
  } finally {
    ctx.depth--;
  }
}

function evalRef(a1: string, ctx: EvalCtx): unknown {
  const rc = a1ToRC(a1);
  if (!rc) return ERR.REF;
  return computeCell(a1, ctx);
}

function computeCell(a1: string, ctx: EvalCtx): unknown {
  if (a1 in ctx.computed) return ctx.computed[a1];
  if (ctx.stack.has(a1)) return ERR.CIRC;
  const cells = ctx.sheet.cells ?? {};
  const cell = cells[a1];
  if (!cell) return 0;
  if (!cell.f) {
    ctx.computed[a1] = cell.v ?? 0;
    return ctx.computed[a1];
  }
  ctx.stack.add(a1);
  const prevActive = ctx.activeCellA1;
  ctx.activeCellA1 = a1;
  let result: unknown;
  try {
    const ast = parse(cell.f.slice(1));
    result = evalNode(ast, ctx);
  } catch (e) {
    if (e instanceof ParseErr) {
      result = e.code;
    } else {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[formula] ${a1} unexpected error`, e);
      }
      result = ERR.ERROR;
    }
  } finally {
    ctx.activeCellA1 = prevActive;
  }
  ctx.stack.delete(a1);
  ctx.computed[a1] = result;
  return result;
}

function evalRange(a: string, b: string, ctx: EvalCtx): unknown[] {
  const ra = a1ToRC(a);
  const rb = a1ToRC(b);
  if (!ra || !rb) return [ERR.REF];
  const range = normalizeRange(ra.r, ra.c, rb.r, rb.c);
  const out: unknown[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      out.push(computeCell(rcToA1(r, c), ctx));
    }
  }
  return out;
}

function flatten(args: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...flatten(a as unknown[]));
    else out.push(a);
  }
  return out;
}

// Coerce a list of mixed values into numbers, ignoring non-numeric strings
// (Excel behavior for SUM, AVERAGE, etc.).
function numList(values: unknown[]): { ok: number[]; err?: string } {
  const out: number[] = [];
  for (const v of values) {
    if (v == null || v === '') continue;
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else if (typeof v === 'string') {
      if (isError(v)) return { ok: out, err: v };
      // skip non-numeric strings
    }
  }
  return { ok: out };
}

// Functions that consume ranges as 2D matrices or as raw refs. For these we
// re-evaluate the relevant arg using `eval2D` (or `node.a1` for refs) so the
// callee can recover shape information that the flat evaluator drops.
const rangeAwareFns = new Set([
  'VLOOKUP',
  'HLOOKUP',
  'INDEX',
  'MATCH',
  'SUMIF',
  'COUNTIF',
  'AVERAGEIF',
  'SUMIFS',
  'COUNTIFS',
  'SUMPRODUCT',
  'XLOOKUP',
  'XMATCH',
  'MAXIFS',
  'MINIFS',
  'AVERAGEIFS',
  'OFFSET',
  'IRR',
]);

function evalFn(name: string, args: Node[], ctx: EvalCtx): unknown {
  const lazyFns = new Set(['IF', 'IFERROR', 'AND', 'OR', 'IFS']);
  let argVals: unknown[];
  if (lazyFns.has(name) || rangeAwareFns.has(name)) {
    // Eager evaluate but skip error propagation; range-aware funcs need
    // access to raw nodes via the `args` array.
    argVals = args.map((a) => evalNode(a, ctx));
  } else {
    argVals = args.map((a) => evalNode(a, ctx));
    for (const v of flatten(argVals)) {
      if (isError(v)) return v;
    }
  }

  switch (name) {
    case 'SUM': {
      const { ok, err } = numList(flatten(argVals));
      if (err) return err;
      return ok.reduce((a, b) => a + b, 0);
    }
    case 'AVERAGE': {
      const { ok, err } = numList(flatten(argVals));
      if (err) return err;
      if (!ok.length) return ERR.DIV0;
      return ok.reduce((a, b) => a + b, 0) / ok.length;
    }
    case 'COUNT':
      return flatten(argVals).filter((v) => typeof v === 'number').length;
    case 'COUNTA':
      return flatten(argVals).filter((v) => v != null && v !== '').length;
    case 'MIN': {
      const { ok, err } = numList(flatten(argVals));
      if (err) return err;
      return ok.length ? Math.min(...ok) : 0;
    }
    case 'MAX': {
      const { ok, err } = numList(flatten(argVals));
      if (err) return err;
      return ok.length ? Math.max(...ok) : 0;
    }
    case 'IF': {
      if (argVals.length < 2) return ERR.ERROR;
      const cond = toBool(argVals[0]);
      if (typeof cond === 'string') return cond;
      return cond ? argVals[1] : argVals[2] ?? false;
    }
    case 'IFERROR':
      return isError(argVals[0]) ? argVals[1] ?? '' : argVals[0];
    case 'AND': {
      for (const v of flatten(argVals)) {
        const b = toBool(v);
        if (typeof b === 'string') return b;
        if (!b) return false;
      }
      return true;
    }
    case 'OR': {
      for (const v of flatten(argVals)) {
        const b = toBool(v);
        if (typeof b === 'string') return b;
        if (b) return true;
      }
      return false;
    }
    case 'NOT': {
      const b = toBool(argVals[0]);
      return typeof b === 'string' ? b : !b;
    }
    case 'CONCAT':
    case 'CONCATENATE':
      return flatten(argVals).map(toStr).join('');
    case 'LEN':
      return toStr(argVals[0]).length;
    case 'UPPER':
      return toStr(argVals[0]).toUpperCase();
    case 'LOWER':
      return toStr(argVals[0]).toLowerCase();
    case 'TRIM':
      return toStr(argVals[0]).trim();
    case 'ROUND': {
      const n = toNum(argVals[0]);
      if (typeof n === 'string') return n;
      const digits = argVals.length > 1 ? toNum(argVals[1]) : 0;
      if (typeof digits === 'string') return digits;
      const f = Math.pow(10, digits as number);
      return Math.round(n * f) / f;
    }
    case 'ABS': {
      const n = toNum(argVals[0]);
      return typeof n === 'string' ? n : Math.abs(n);
    }
    case 'SQRT': {
      const n = toNum(argVals[0]);
      if (typeof n === 'string') return n;
      if (n < 0) return ERR.VALUE;
      return Math.sqrt(n);
    }
    case 'POWER': {
      const a = toNum(argVals[0]);
      const b = toNum(argVals[1]);
      if (typeof a === 'string') return a;
      if (typeof b === 'string') return b;
      return Math.pow(a, b);
    }
    case 'PI':
      return Math.PI;
    case 'TODAY': {
      const d = new Date();
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    case 'NOW': {
      const d = new Date();
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
        d.getDate(),
      )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // ---- Logic ----
    case 'IFS': {
      // IFS(cond1, val1, cond2, val2, ...) — first truthy condition wins.
      // Args evaluate lazily (no error propagation) so a later branch can
      // still resolve when an earlier one is #N/A.
      for (let k = 0; k + 1 < argVals.length; k += 2) {
        const cond = toBool(argVals[k]);
        if (typeof cond === 'string') return cond; // propagate error
        if (cond) return argVals[k + 1];
      }
      return ERR.NA;
    }

    // ---- Conditional aggregates ----
    case 'SUMIF': {
      // SUMIF(range, criterion, [sum_range])
      if (args.length < 2) return ERR.ERROR;
      const range = flattenRange(args[0], ctx);
      const crit = evalNode(args[1], ctx);
      const sumRange =
        args.length > 2 ? flattenRange(args[2], ctx) : range;
      const matcher = makeCriterionMatcher(crit);
      let sum = 0;
      for (let i = 0; i < range.length; i++) {
        if (matcher(range[i])) {
          const v = sumRange[i];
          if (typeof v === 'number') sum += v;
          else if (typeof v === 'boolean') sum += v ? 1 : 0;
        }
      }
      return sum;
    }
    case 'COUNTIF': {
      if (args.length < 2) return ERR.ERROR;
      const range = flattenRange(args[0], ctx);
      const crit = evalNode(args[1], ctx);
      const matcher = makeCriterionMatcher(crit);
      let count = 0;
      for (const v of range) if (matcher(v)) count++;
      return count;
    }
    case 'AVERAGEIF': {
      if (args.length < 2) return ERR.ERROR;
      const range = flattenRange(args[0], ctx);
      const crit = evalNode(args[1], ctx);
      const avgRange =
        args.length > 2 ? flattenRange(args[2], ctx) : range;
      const matcher = makeCriterionMatcher(crit);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < range.length; i++) {
        if (matcher(range[i])) {
          const v = avgRange[i];
          if (typeof v === 'number') {
            sum += v;
            n++;
          } else if (typeof v === 'boolean') {
            sum += v ? 1 : 0;
            n++;
          }
        }
      }
      return n === 0 ? ERR.DIV0 : sum / n;
    }
    case 'AVERAGEIFS': {
      // AVERAGEIFS(avg_range, range1, crit1, [range2, crit2, ...])
      if (args.length < 3 || (args.length - 1) % 2 !== 0) return ERR.ERROR;
      const aifAvgRange = flattenRange(args[0], ctx);
      const aifPairs: Array<{ range: unknown[]; matcher: (v: unknown) => boolean }> = [];
      for (let k = 1; k + 1 < args.length; k += 2) {
        const range = flattenRange(args[k], ctx);
        const crit = evalNode(args[k + 1], ctx);
        aifPairs.push({ range, matcher: makeCriterionMatcher(crit) });
      }
      let aifSum = 0, aifN = 0;
      for (let i = 0; i < aifAvgRange.length; i++) {
        const ok = aifPairs.every((p) => i < p.range.length && p.matcher(p.range[i]));
        if (ok) {
          const v = aifAvgRange[i];
          if (typeof v === 'number') { aifSum += v; aifN++; }
          else if (typeof v === 'boolean') { aifSum += v ? 1 : 0; aifN++; }
        }
      }
      return aifN === 0 ? ERR.DIV0 : aifSum / aifN;
    }
    case 'SUMIFS': {
      // SUMIFS(sum_range, range1, crit1, range2, crit2, ...)
      if (args.length < 3 || (args.length - 1) % 2 !== 0) return ERR.ERROR;
      const sumRange = flattenRange(args[0], ctx);
      const pairs: Array<{ range: unknown[]; matcher: (v: unknown) => boolean }> =
        [];
      for (let k = 1; k + 1 < args.length; k += 2) {
        const range = flattenRange(args[k], ctx);
        const crit = evalNode(args[k + 1], ctx);
        pairs.push({ range, matcher: makeCriterionMatcher(crit) });
      }
      let sum = 0;
      for (let i = 0; i < sumRange.length; i++) {
        const ok = pairs.every(
          (p) => i < p.range.length && p.matcher(p.range[i]),
        );
        if (ok) {
          const v = sumRange[i];
          if (typeof v === 'number') sum += v;
          else if (typeof v === 'boolean') sum += v ? 1 : 0;
        }
      }
      return sum;
    }
    case 'COUNTIFS': {
      if (args.length < 2 || args.length % 2 !== 0) return ERR.ERROR;
      const pairs: Array<{ range: unknown[]; matcher: (v: unknown) => boolean }> =
        [];
      for (let k = 0; k + 1 < args.length; k += 2) {
        const range = flattenRange(args[k], ctx);
        const crit = evalNode(args[k + 1], ctx);
        pairs.push({ range, matcher: makeCriterionMatcher(crit) });
      }
      const len = pairs[0]?.range.length ?? 0;
      let count = 0;
      for (let i = 0; i < len; i++) {
        if (pairs.every((p) => i < p.range.length && p.matcher(p.range[i])))
          count++;
      }
      return count;
    }

    // ---- Lookup ----
    case 'VLOOKUP': {
      // VLOOKUP(lookup, table, col_index, [range_lookup])
      // range_lookup TRUE/omitted = approximate, FALSE = exact.
      if (args.length < 3) return ERR.ERROR;
      const lookup = evalNode(args[0], ctx);
      const table = eval2D(args[1], ctx);
      const colIdx = toNum(evalNode(args[2], ctx));
      if (typeof colIdx === 'string') return colIdx;
      let exact = false;
      if (args.length > 3) {
        const b = toBool(evalNode(args[3], ctx));
        if (typeof b === 'string') return b;
        exact = !b;
      }
      const matchRow = findLookupRow(table, lookup, 0, exact);
      if (matchRow < 0) return ERR.NA;
      const col = Math.trunc(colIdx) - 1;
      if (col < 0 || col >= (table[0]?.length ?? 0)) return ERR.REF;
      return table[matchRow][col] ?? '';
    }
    case 'HLOOKUP': {
      if (args.length < 3) return ERR.ERROR;
      const lookup = evalNode(args[0], ctx);
      const table = eval2D(args[1], ctx);
      const rowIdx = toNum(evalNode(args[2], ctx));
      if (typeof rowIdx === 'string') return rowIdx;
      let exact = false;
      if (args.length > 3) {
        const b = toBool(evalNode(args[3], ctx));
        if (typeof b === 'string') return b;
        exact = !b;
      }
      // Search across the first row.
      const firstRow = table[0] ?? [];
      const matchCol = findLookupIn1D(firstRow, lookup, exact);
      if (matchCol < 0) return ERR.NA;
      const row = Math.trunc(rowIdx) - 1;
      if (row < 0 || row >= table.length) return ERR.REF;
      return table[row][matchCol] ?? '';
    }
    case 'INDEX': {
      // INDEX(array, row, [col]) — 1-based.
      if (args.length < 2) return ERR.ERROR;
      const table = eval2D(args[0], ctx);
      const rIdx = toNum(evalNode(args[1], ctx));
      if (typeof rIdx === 'string') return rIdx;
      const cIdx = args.length > 2 ? toNum(evalNode(args[2], ctx)) : 1;
      if (typeof cIdx === 'string') return cIdx;
      const r = Math.trunc(rIdx) - 1;
      const c = Math.trunc(cIdx) - 1;
      // Single-row or single-col arrays: allow 1D indexing.
      if (table.length === 1 && args.length === 2) {
        if (r < 0 || r >= (table[0]?.length ?? 0)) return ERR.REF;
        return table[0][r] ?? '';
      }
      if ((table[0]?.length ?? 0) === 1 && args.length === 2) {
        if (r < 0 || r >= table.length) return ERR.REF;
        return table[r][0] ?? '';
      }
      if (r < 0 || r >= table.length) return ERR.REF;
      if (c < 0 || c >= (table[0]?.length ?? 0)) return ERR.REF;
      return table[r][c] ?? '';
    }
    case 'MATCH': {
      // MATCH(lookup, range, [match_type])
      //   match_type 0 = exact, 1 = largest <= lookup (asc), -1 = smallest >= lookup (desc)
      if (args.length < 2) return ERR.ERROR;
      const lookup = evalNode(args[0], ctx);
      const table = eval2D(args[1], ctx);
      const mt =
        args.length > 2
          ? (() => {
              const n = toNum(evalNode(args[2], ctx));
              return typeof n === 'string' ? 1 : Math.trunc(n);
            })()
          : 1;
      // Flatten to a 1D vector preserving row-major order.
      const list: unknown[] = [];
      for (const row of table) for (const v of row) list.push(v);
      const idx = matchIn1D(list, lookup, mt);
      return idx < 0 ? ERR.NA : idx + 1;
    }

    // ---- Math ----
    case 'INT': {
      const n = toNum(argVals[0]);
      return typeof n === 'string' ? n : Math.floor(n);
    }
    case 'MOD': {
      const a = toNum(argVals[0]);
      const b = toNum(argVals[1]);
      if (typeof a === 'string') return a;
      if (typeof b === 'string') return b;
      if (b === 0) return ERR.DIV0;
      // Excel MOD: result has the sign of the divisor.
      return a - Math.floor(a / b) * b;
    }
    case 'SIGN': {
      const n = toNum(argVals[0]);
      if (typeof n === 'string') return n;
      return n > 0 ? 1 : n < 0 ? -1 : 0;
    }
    case 'CEILING': {
      const n = toNum(argVals[0]);
      const sig = argVals.length > 1 ? toNum(argVals[1]) : 1;
      if (typeof n === 'string') return n;
      if (typeof sig === 'string') return sig;
      if (sig === 0) return 0;
      return Math.ceil(n / sig) * sig;
    }
    case 'FLOOR': {
      const n = toNum(argVals[0]);
      const sig = argVals.length > 1 ? toNum(argVals[1]) : 1;
      if (typeof n === 'string') return n;
      if (typeof sig === 'string') return sig;
      if (sig === 0) return ERR.DIV0;
      return Math.floor(n / sig) * sig;
    }
    case 'ROUNDUP': {
      const n = toNum(argVals[0]);
      const d = argVals.length > 1 ? toNum(argVals[1]) : 0;
      if (typeof n === 'string') return n;
      if (typeof d === 'string') return d;
      const f = Math.pow(10, d as number);
      return (n >= 0 ? Math.ceil(n * f) : -Math.ceil(-n * f)) / f;
    }
    case 'ROUNDDOWN': {
      const n = toNum(argVals[0]);
      const d = argVals.length > 1 ? toNum(argVals[1]) : 0;
      if (typeof n === 'string') return n;
      if (typeof d === 'string') return d;
      const f = Math.pow(10, d as number);
      return (n >= 0 ? Math.floor(n * f) : -Math.floor(-n * f)) / f;
    }

    // ---- Text ----
    case 'LEFT': {
      const s = toStr(argVals[0]);
      const n = argVals.length > 1 ? toNum(argVals[1]) : 1;
      if (typeof n === 'string') return n;
      return s.slice(0, Math.max(0, Math.trunc(n)));
    }
    case 'RIGHT': {
      const s = toStr(argVals[0]);
      const n = argVals.length > 1 ? toNum(argVals[1]) : 1;
      if (typeof n === 'string') return n;
      const k = Math.max(0, Math.trunc(n));
      return k === 0 ? '' : s.slice(-k);
    }
    case 'MID': {
      const s = toStr(argVals[0]);
      const start = toNum(argVals[1]);
      const len = toNum(argVals[2]);
      if (typeof start === 'string') return start;
      if (typeof len === 'string') return len;
      const i = Math.max(0, Math.trunc(start) - 1);
      return s.slice(i, i + Math.max(0, Math.trunc(len)));
    }
    case 'FIND': {
      // Case-sensitive substring search, 1-based, no wildcards.
      const needle = toStr(argVals[0]);
      const hay = toStr(argVals[1]);
      const start =
        argVals.length > 2 ? toNum(argVals[2]) : 1;
      if (typeof start === 'string') return start;
      const from = Math.max(0, Math.trunc(start) - 1);
      const idx = hay.indexOf(needle, from);
      return idx < 0 ? ERR.VALUE : idx + 1;
    }
    case 'SEARCH': {
      // Case-insensitive substring search with * and ? wildcards.
      const needle = toStr(argVals[0]);
      const hay = toStr(argVals[1]);
      const start =
        argVals.length > 2 ? toNum(argVals[2]) : 1;
      if (typeof start === 'string') return start;
      const from = Math.max(0, Math.trunc(start) - 1);
      const re = new RegExp(
        wildcardToRegex(needle, false),
        'i',
      );
      const slice = hay.slice(from);
      const m = slice.match(re);
      if (!m) return ERR.VALUE;
      return (m.index ?? 0) + from + 1;
    }
    case 'SUBSTITUTE': {
      // SUBSTITUTE(text, old, new, [occurrence])
      const s = toStr(argVals[0]);
      const oldStr = toStr(argVals[1]);
      const newStr = toStr(argVals[2]);
      if (oldStr === '') return s;
      if (argVals.length > 3) {
        const occ = toNum(argVals[3]);
        if (typeof occ === 'string') return occ;
        const target = Math.trunc(occ);
        let count = 0;
        let from = 0;
        while (from <= s.length) {
          const idx = s.indexOf(oldStr, from);
          if (idx < 0) break;
          count++;
          if (count === target) {
            return s.slice(0, idx) + newStr + s.slice(idx + oldStr.length);
          }
          from = idx + oldStr.length;
        }
        return s; // occurrence not found — no change
      }
      return s.split(oldStr).join(newStr);
    }
    case 'REPLACE': {
      // REPLACE(text, start, length, new_text) — 1-based start.
      const s = toStr(argVals[0]);
      const start = toNum(argVals[1]);
      const len = toNum(argVals[2]);
      const repl = toStr(argVals[3]);
      if (typeof start === 'string') return start;
      if (typeof len === 'string') return len;
      const i = Math.max(0, Math.trunc(start) - 1);
      const j = i + Math.max(0, Math.trunc(len));
      return s.slice(0, i) + repl + s.slice(j);
    }
    case 'TEXT': {
      // TEXT(value, format) — minimal: passthrough to formatComputed for
      // unknown patterns; recognize "0", "0.00", "0.0%", "$0.00".
      const v = argVals[0];
      const fmt = toStr(argVals[1]);
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return toStr(v);
      return applyTextFormat(n, fmt);
    }

    // ---- Date ----
    case 'DATE': {
      // DATE(year, month, day) — returns ISO date string.
      const y = toNum(argVals[0]);
      const m = toNum(argVals[1]);
      const d = toNum(argVals[2]);
      if (typeof y === 'string') return y;
      if (typeof m === 'string') return m;
      if (typeof d === 'string') return d;
      const dt = new Date(Date.UTC(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d)));
      if (Number.isNaN(dt.getTime())) return ERR.VALUE;
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(
        dt.getUTCDate(),
      )}`;
    }
    case 'YEAR': {
      const d = parseDate(argVals[0]);
      return d == null ? ERR.VALUE : d.getUTCFullYear();
    }
    case 'MONTH': {
      const d = parseDate(argVals[0]);
      return d == null ? ERR.VALUE : d.getUTCMonth() + 1;
    }
    case 'DAY': {
      const d = parseDate(argVals[0]);
      return d == null ? ERR.VALUE : d.getUTCDate();
    }
    case 'WEEKDAY': {
      // WEEKDAY(date, [type]) — type 1 = Sun..Sat (1..7), 2 = Mon..Sun (1..7),
      // 3 = Mon..Sun (0..6).
      const d = parseDate(argVals[0]);
      if (d == null) return ERR.VALUE;
      const dow = d.getUTCDay(); // 0=Sun..6=Sat
      const t = argVals.length > 1 ? toNum(argVals[1]) : 1;
      if (typeof t === 'string') return t;
      const type = Math.trunc(t);
      if (type === 1) return dow + 1; // 1..7 Sun..Sat
      if (type === 2) return ((dow + 6) % 7) + 1; // 1..7 Mon..Sun
      if (type === 3) return (dow + 6) % 7; // 0..6 Mon..Sun
      return ERR.VALUE;
    }

    // ---- More date ----
    case 'HOUR': {
      const d = parseDate(argVals[0]);
      return d == null ? ERR.VALUE : d.getUTCHours();
    }
    case 'MINUTE': {
      const d = parseDate(argVals[0]);
      return d == null ? ERR.VALUE : d.getUTCMinutes();
    }
    case 'SECOND': {
      const d = parseDate(argVals[0]);
      return d == null ? ERR.VALUE : d.getUTCSeconds();
    }
    case 'TIME': {
      const h = toNum(argVals[0]); const m = toNum(argVals[1]); const s = toNum(argVals[2]);
      if (typeof h === 'string' || typeof m === 'string' || typeof s === 'string') return ERR.VALUE;
      return `${pad(Math.trunc(h))}:${pad(Math.trunc(m))}:${pad(Math.trunc(s))}`;
    }
    case 'EDATE': {
      const d = parseDate(argVals[0]);
      const months = toNum(argVals[1]);
      if (d == null || typeof months === 'string') return ERR.VALUE;
      const r = new Date(d);
      r.setUTCMonth(r.getUTCMonth() + Math.trunc(months));
      return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
    }
    case 'EOMONTH': {
      const d = parseDate(argVals[0]);
      const months = toNum(argVals[1]);
      if (d == null || typeof months === 'string') return ERR.VALUE;
      const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(months) + 1, 0));
      return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
    }
    case 'DATEDIF': {
      const d1 = parseDate(argVals[0]);
      const d2 = parseDate(argVals[1]);
      const unit = toStr(argVals[2]).toUpperCase();
      if (d1 == null || d2 == null) return ERR.VALUE;
      const diff = d2.getTime() - d1.getTime();
      if (unit === 'D') return Math.floor(diff / 86400000);
      if (unit === 'M') {
        let m = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
        if (d2.getUTCDate() < d1.getUTCDate()) m--;
        return m;
      }
      if (unit === 'Y') {
        let y = d2.getUTCFullYear() - d1.getUTCFullYear();
        if (d2.getUTCMonth() < d1.getUTCMonth() || (d2.getUTCMonth() === d1.getUTCMonth() && d2.getUTCDate() < d1.getUTCDate())) y--;
        return y;
      }
      return ERR.VALUE;
    }
    case 'WEEKNUM': {
      const d = parseDate(argVals[0]);
      if (d == null) return ERR.VALUE;
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
    }
    case 'NETWORKDAYS': {
      const d1 = parseDate(argVals[0]); const d2 = parseDate(argVals[1]);
      if (d1 == null || d2 == null) return ERR.VALUE;
      let count = 0;
      const cur = new Date(d1);
      while (cur <= d2) {
        const dow = cur.getUTCDay();
        if (dow !== 0 && dow !== 6) count++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return count;
    }

    // ---- More text ----
    case 'PROPER': {
      return toStr(argVals[0]).replace(/\b\w/g, (c) => c.toUpperCase()).replace(/(\B\w)/g, (c) => c.toLowerCase());
    }
    case 'TEXTJOIN': {
      const delim = toStr(argVals[0]);
      const ignoreEmpty = argVals[1];
      const parts: string[] = [];
      for (let i = 2; i < argVals.length; i++) {
        const v = argVals[i];
        if (Array.isArray(v)) {
          (v as unknown[]).forEach((x) => { const s = x == null ? '' : toStr(x); if (s || !ignoreEmpty) parts.push(s); });
        } else { const s = v == null ? '' : toStr(v); if (s || !ignoreEmpty) parts.push(s); }
      }
      return parts.join(delim);
    }
    case 'REPT': return toStr(argVals[0]).repeat(Math.max(0, Math.trunc(toNum(argVals[1]) as number)));
    case 'CHAR': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : String.fromCharCode(Math.trunc(n)); }
    case 'CODE': { const s = toStr(argVals[0]); return s.length === 0 ? ERR.VALUE : s.charCodeAt(0); }
    case 'EXACT': return toStr(argVals[0]) === toStr(argVals[1]);
    case 'NUMBERVALUE':
    case 'VALUE': { const n = Number(toStr(argVals[0]).replace(/,/g, '')); return Number.isFinite(n) ? n : ERR.VALUE; }
    case 'T': { const v = argVals[0]; return typeof v === 'string' ? v : ''; }
    case 'CLEAN': return toStr(argVals[0]).replace(/[\x00-\x1F]/g, '');

    // ---- Math extras ----
    case 'TRUNC': { const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE; const dp = argVals.length > 1 ? Math.trunc(toNum(argVals[1]) as number) : 0; const f = Math.pow(10, dp); return Math.trunc(n * f) / f; }
    case 'MROUND': { const n = toNum(argVals[0]); const m = toNum(argVals[1]); if (typeof n === 'string' || typeof m === 'string' || m === 0) return typeof m === 'string' || m === 0 ? ERR.DIV0 : ERR.VALUE; return Math.round(n / m) * m; }
    case 'QUOTIENT': { const n = toNum(argVals[0]); const d = toNum(argVals[1]); if (typeof n === 'string' || typeof d === 'string') return ERR.VALUE; if (d === 0) return ERR.DIV0; return Math.trunc(n / d); }
    case 'GCD': { const nums = argVals.map((v) => Math.abs(Math.trunc(toNum(v) as number))); const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b); return nums.reduce(g); }
    case 'LCM': { const nums = argVals.map((v) => Math.abs(Math.trunc(toNum(v) as number))); const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b); return nums.reduce((a, b) => a * b / g(a, b)); }
    case 'LOG': { const n = toNum(argVals[0]); const base = argVals.length > 1 ? toNum(argVals[1]) : 10; if (typeof n === 'string' || typeof base === 'string' || n <= 0 || base <= 0) return ERR.VALUE; return Math.log(n) / Math.log(base); }
    case 'LOG10': { const n = toNum(argVals[0]); if (typeof n === 'string' || n <= 0) return ERR.VALUE; return Math.log10(n); }
    case 'LN': { const n = toNum(argVals[0]); if (typeof n === 'string' || n <= 0) return ERR.VALUE; return Math.log(n); }
    case 'EXP': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.exp(n); }
    case 'FACT': { let n = toNum(argVals[0]); if (typeof n === 'string' || n < 0) return ERR.VALUE; n = Math.trunc(n); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
    case 'COMBIN': { const n = Math.trunc(toNum(argVals[0]) as number); const k = Math.trunc(toNum(argVals[1]) as number); if (k > n || n < 0 || k < 0) return ERR.VALUE; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }
    case 'RAND': return Math.random();
    case 'RANDBETWEEN': { const lo = Math.ceil(toNum(argVals[0]) as number); const hi = Math.floor(toNum(argVals[1]) as number); return lo + Math.floor(Math.random() * (hi - lo + 1)); }
    case 'ISODD': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.abs(Math.trunc(n)) % 2 === 1; }
    case 'ISEVEN': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.abs(Math.trunc(n)) % 2 === 0; }

    // ---- Statistics ----
    case 'MEDIAN': {
      const nums = flattenRange(args[0], ctx).filter((v) => typeof v === 'number') as number[];
      if (nums.length === 0) return ERR.VALUE;
      nums.sort((a, b) => a - b);
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
    }
    case 'STDEV':
    case 'STDEV.S': {
      const nums = argVals.flat().filter((v) => typeof v === 'number') as number[];
      if (nums.length < 2) return ERR.VALUE;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1));
    }
    case 'STDEVP':
    case 'STDEV.P': {
      const nums = argVals.flat().filter((v) => typeof v === 'number') as number[];
      if (nums.length === 0) return ERR.VALUE;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    }
    case 'VAR':
    case 'VAR.S': {
      const nums = argVals.flat().filter((v) => typeof v === 'number') as number[];
      if (nums.length < 2) return ERR.VALUE;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
    }
    case 'VARP':
    case 'VAR.P': {
      const nums = argVals.flat().filter((v) => typeof v === 'number') as number[];
      if (nums.length === 0) return ERR.VALUE;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    }
    case 'LARGE': {
      const nums = flattenRange(args[0], ctx).filter((v) => typeof v === 'number') as number[];
      const k = Math.trunc(toNum(argVals[1]) as number);
      if (k < 1 || k > nums.length) return ERR.VALUE;
      return nums.sort((a, b) => b - a)[k - 1];
    }
    case 'SMALL': {
      const nums = flattenRange(args[0], ctx).filter((v) => typeof v === 'number') as number[];
      const k = Math.trunc(toNum(argVals[1]) as number);
      if (k < 1 || k > nums.length) return ERR.VALUE;
      return nums.sort((a, b) => a - b)[k - 1];
    }
    case 'RANK':
    case 'RANK.EQ': {
      const val = toNum(argVals[0]); if (typeof val === 'string') return ERR.VALUE;
      const nums = flattenRange(args[1], ctx).filter((v) => typeof v === 'number') as number[];
      const order = argVals.length > 2 ? toNum(argVals[2]) : 0;
      const sorted = nums.slice().sort((a, b) => order ? a - b : b - a);
      const idx = sorted.indexOf(val);
      return idx === -1 ? ERR.VALUE : idx + 1;
    }
    case 'PERCENTILE':
    case 'PERCENTILE.INC': {
      const nums = flattenRange(args[0], ctx).filter((v) => typeof v === 'number') as number[];
      const k = toNum(argVals[1]); if (typeof k === 'string' || k < 0 || k > 1) return ERR.VALUE;
      nums.sort((a, b) => a - b);
      const idx = k * (nums.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
    }

    // ---- Lookup extras ----
    case 'CHOOSE': {
      const idx = Math.trunc(toNum(argVals[0]) as number);
      if (idx < 1 || idx >= argVals.length) return ERR.VALUE;
      return argVals[idx];
    }
    case 'ROW': {
      if (args.length === 0) { const rc0 = ctx.activeCellA1 ? a1ToRC(ctx.activeCellA1) : null; return rc0 ? rc0.r + 1 : ERR.VALUE; }
      const ref = args[0]; if (ref.type !== 'ref') return ERR.VALUE;
      const rc = a1ToRC(ref.a1); return rc ? rc.r + 1 : ERR.VALUE;
    }
    case 'COLUMN': {
      if (args.length === 0) { const rc0 = ctx.activeCellA1 ? a1ToRC(ctx.activeCellA1) : null; return rc0 ? rc0.c + 1 : ERR.VALUE; }
      const ref = args[0]; if (ref.type !== 'ref') return ERR.VALUE;
      const rc = a1ToRC(ref.a1); return rc ? rc.c + 1 : ERR.VALUE;
    }
    case 'ROWS': { const n2 = args[0]; if (n2.type !== 'range') return ERR.VALUE; const ra2 = a1ToRC(n2.a); const rb2 = a1ToRC(n2.b); return ra2 && rb2 ? Math.abs(rb2.r - ra2.r) + 1 : ERR.VALUE; }
    case 'COLUMNS': { const n3 = args[0]; if (n3.type !== 'range') return ERR.VALUE; const ra3 = a1ToRC(n3.a); const rb3 = a1ToRC(n3.b); return ra3 && rb3 ? Math.abs(rb3.c - ra3.c) + 1 : ERR.VALUE; }
    case 'ADDRESS': {
      const row = Math.trunc(toNum(argVals[0]) as number);
      const col = Math.trunc(toNum(argVals[1]) as number);
      const absType = argVals.length > 2 ? Math.trunc(toNum(argVals[2]) as number) : 1;
      let colL = ''; let n = col; while (n > 0) { const m = (n - 1) % 26; colL = String.fromCharCode(65 + m) + colL; n = Math.floor((n - 1) / 26); }
      const rPart = absType === 1 || absType === 3 ? `$${row}` : `${row}`;
      const cPart = absType === 1 || absType === 2 ? `$${colL}` : colL;
      return `${cPart}${rPart}`;
    }

    // ---- Info / IS functions ----
    case 'ISBLANK': { const v = argVals[0]; return v === undefined || v === null || v === ''; }
    case 'ISNUMBER': return typeof argVals[0] === 'number';
    case 'ISTEXT': return typeof argVals[0] === 'string' && !isError(argVals[0]);
    case 'ISERROR': return isError(argVals[0]);
    case 'ISNA': return argVals[0] === ERR.NA;
    case 'IFNA': return argVals[0] === ERR.NA ? argVals[1] : argVals[0];
    case 'N': { const v = argVals[0]; return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0; }
    case 'TYPE': {
      const v = argVals[0];
      if (typeof v === 'number') return 1;
      if (typeof v === 'string' && !isError(v)) return 2;
      if (typeof v === 'boolean') return 4;
      if (isError(v)) return 16;
      return 1;
    }

    // ---- Logical extras ----
    case 'SWITCH': {
      const expr = argVals[0];
      for (let i = 1; i + 1 < argVals.length; i += 2) {
        if (argVals[i] === expr || String(argVals[i]) === String(expr)) return argVals[i + 1];
      }
      if (argVals.length % 2 === 0) return argVals[argVals.length - 1]; // default
      return ERR.VALUE;
    }
    case 'XOR': {
      let trueCount = 0;
      for (const v of argVals) { if (v === true || v === 1) trueCount++; }
      return trueCount % 2 === 1;
    }

    // ---- Math extras 2 ----
    case 'PRODUCT': {
      const { ok, err } = numList(flatten(argVals));
      if (err) return err;
      return ok.reduce((a, b) => a * b, 1);
    }
    case 'SUMPRODUCT': {
      if (args.length === 0) return ERR.ERROR;
      const arrays = args.map((a) => flattenRange(a, ctx));
      const len = arrays[0]?.length ?? 0;
      let sum = 0;
      for (let i = 0; i < len; i++) {
        let prod = 1;
        for (const arr of arrays) {
          const v = i < arr.length ? arr[i] : 0;
          prod *= typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
        }
        sum += prod;
      }
      return sum;
    }
    case 'SIN': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.sin(n); }
    case 'COS': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.cos(n); }
    case 'TAN': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.tan(n); }
    case 'ASIN': { const n = toNum(argVals[0]); if (typeof n === 'string' || n < -1 || n > 1) return ERR.VALUE; return Math.asin(n); }
    case 'ACOS': { const n = toNum(argVals[0]); if (typeof n === 'string' || n < -1 || n > 1) return ERR.VALUE; return Math.acos(n); }
    case 'ATAN': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : Math.atan(n); }
    case 'ATAN2': {
      // Excel ATAN2(x, y) → Math.atan2(y, x)
      const x = toNum(argVals[0]); const y = toNum(argVals[1]);
      if (typeof x === 'string' || typeof y === 'string') return ERR.VALUE;
      if (x === 0 && y === 0) return ERR.DIV0;
      return Math.atan2(y as number, x as number);
    }
    case 'RADIANS': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : (n as number) * Math.PI / 180; }
    case 'DEGREES': { const n = toNum(argVals[0]); return typeof n === 'string' ? ERR.VALUE : (n as number) * 180 / Math.PI; }
    case 'ODD': {
      const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE;
      if (n === 0) return 1;
      const sign = (n as number) > 0 ? 1 : -1;
      const ceiled = Math.ceil(Math.abs(n as number));
      return sign * (ceiled % 2 === 0 ? ceiled + 1 : ceiled);
    }
    case 'EVEN': {
      const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE;
      if (n === 0) return 0;
      const sign = (n as number) > 0 ? 1 : -1;
      const ceiled = Math.ceil(Math.abs(n as number));
      return sign * (ceiled % 2 === 0 ? ceiled : ceiled + 1);
    }
    case 'FIXED': {
      const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE;
      const decimals = argVals.length > 1 ? Math.trunc(toNum(argVals[1]) as number) : 2;
      const noCommas = argVals.length > 2 ? toBool(argVals[2]) : false;
      const rounded = (n as number).toFixed(Math.max(0, decimals));
      if (noCommas) return rounded;
      const parts = rounded.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }

    // ---- Text extras 2 ----
    case 'UNICODE': {
      const s = toStr(argVals[0]);
      if (s.length === 0) return ERR.VALUE;
      return s.codePointAt(0) ?? ERR.VALUE;
    }
    case 'UNICHAR': {
      const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE;
      try { return String.fromCodePoint(Math.trunc(n as number)); } catch { return ERR.VALUE; }
    }
    case 'DOLLAR': {
      const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE;
      const decimals = argVals.length > 1 ? Math.trunc(toNum(argVals[1]) as number) : 2;
      const d = Math.max(0, decimals);
      const rounded = Math.abs(n as number).toFixed(d);
      const parts = rounded.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return ((n as number) < 0 ? '-$' : '$') + parts.join('.');
    }
    case 'NUMBERTEXT': {
      const n = toNum(argVals[0]); if (typeof n === 'string') return ERR.VALUE;
      return numberToWords(Math.abs(Math.trunc(n as number)));
    }

    // ---- Date extras 2 ----
    case 'WORKDAY': {
      const d = parseDate(argVals[0]);
      const days = toNum(argVals[1]);
      if (d == null || typeof days === 'string') return ERR.VALUE;
      const n = Math.trunc(days as number);
      const cur = new Date(d);
      let remaining = Math.abs(n);
      const step = n >= 0 ? 1 : -1;
      while (remaining > 0) {
        cur.setUTCDate(cur.getUTCDate() + step);
        const dow = cur.getUTCDay();
        if (dow !== 0 && dow !== 6) remaining--;
      }
      return `${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}-${pad(cur.getUTCDate())}`;
    }
    case 'DAYS': {
      const end = parseDate(argVals[0]); const start = parseDate(argVals[1]);
      if (end == null || start == null) return ERR.VALUE;
      return Math.round((end.getTime() - start.getTime()) / 86400000);
    }
    case 'DAYS360': {
      const d1 = parseDate(argVals[0]); const d2 = parseDate(argVals[1]);
      if (d1 == null || d2 == null) return ERR.VALUE;
      const euro = argVals.length > 2 ? toBool(argVals[2]) : false;
      let y1 = d1.getUTCFullYear(), m1 = d1.getUTCMonth() + 1, dd1 = d1.getUTCDate();
      let y2 = d2.getUTCFullYear(), m2 = d2.getUTCMonth() + 1, dd2 = d2.getUTCDate();
      if (!euro) { if (dd1 === 31) dd1 = 30; if (dd2 === 31 && dd1 === 30) dd2 = 30; }
      else { if (dd1 === 31) dd1 = 30; if (dd2 === 31) dd2 = 30; }
      return (y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1);
    }
    case 'DATEVALUE': {
      const d = parseDate(argVals[0]);
      if (d == null) return ERR.VALUE;
      return Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    }
    case 'TIMEVALUE': {
      const s = toStr(argVals[0]);
      const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!m) return ERR.VALUE;
      const h = parseInt(m[1]), min = parseInt(m[2]), sec = parseInt(m[3] ?? '0');
      return (h * 3600 + min * 60 + sec) / 86400;
    }
    case 'ISOWEEKNUM': {
      const d = parseDate(argVals[0]); if (d == null) return ERR.VALUE;
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayOfWeek = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    }

    // ---- Lookup extras 2 ----
    case 'XLOOKUP': {
      if (args.length < 3) return ERR.ERROR;
      const lookup = evalNode(args[0], ctx);
      const lookArr = flattenRange(args[1], ctx);
      const retArr = flattenRange(args[2], ctx);
      const ifNotFound = args.length > 3 ? evalNode(args[3], ctx) : ERR.NA;
      const matchMode = args.length > 4 ? Math.trunc(toNum(evalNode(args[4], ctx)) as number) : 0;
      let xIdx = -1;
      if (matchMode === 0) {
        for (let i = 0; i < lookArr.length; i++) { if (equalLoose(lookArr[i], lookup)) { xIdx = i; break; } }
      } else if (matchMode === 2 && typeof lookup === 'string') {
        const re = new RegExp(`^${wildcardToRegex(lookup, true)}$`, 'i');
        for (let i = 0; i < lookArr.length; i++) { if (lookArr[i] != null && re.test(String(lookArr[i]))) { xIdx = i; break; } }
      } else if (matchMode === -1) {
        for (let i = 0; i < lookArr.length; i++) { if (compareLoose(lookArr[i], lookup) <= 0) xIdx = i; }
      } else if (matchMode === 1) {
        for (let i = 0; i < lookArr.length; i++) { if (compareLoose(lookArr[i], lookup) >= 0) { xIdx = i; break; } }
      }
      if (xIdx < 0) return ifNotFound ?? ERR.NA;
      return xIdx < retArr.length ? retArr[xIdx] : ERR.NA;
    }
    case 'XMATCH': {
      if (args.length < 2) return ERR.ERROR;
      const lookup = evalNode(args[0], ctx);
      const arr = flattenRange(args[1], ctx);
      const matchMode = args.length > 2 ? Math.trunc(toNum(evalNode(args[2], ctx)) as number) : 0;
      let xmIdx = -1;
      if (matchMode === 0) {
        for (let i = 0; i < arr.length; i++) { if (equalLoose(arr[i], lookup)) { xmIdx = i; break; } }
      } else if (matchMode === 2 && typeof lookup === 'string') {
        const re = new RegExp(`^${wildcardToRegex(lookup, true)}$`, 'i');
        for (let i = 0; i < arr.length; i++) { if (arr[i] != null && re.test(String(arr[i]))) { xmIdx = i; break; } }
      } else if (matchMode === -1) {
        for (let i = 0; i < arr.length; i++) { if (compareLoose(arr[i], lookup) <= 0) xmIdx = i; }
      } else if (matchMode === 1) {
        for (let i = 0; i < arr.length; i++) { if (compareLoose(arr[i], lookup) >= 0) { xmIdx = i; break; } }
      }
      return xmIdx < 0 ? ERR.NA : xmIdx + 1;
    }
    case 'INDIRECT': {
      const refStr = toStr(argVals[0]).toUpperCase().replace(/\s/g, '');
      const parts = refStr.split(':');
      if (parts.length === 2 && a1ToRC(parts[0]) && a1ToRC(parts[1])) return evalRange(parts[0], parts[1], ctx);
      if (a1ToRC(refStr)) return computeCell(refStr, ctx);
      return ERR.REF;
    }
    case 'OFFSET': {
      if (args.length < 3) return ERR.ERROR;
      const refNode = args[0];
      if (refNode.type !== 'ref') return ERR.VALUE;
      const rc = a1ToRC(refNode.a1);
      if (!rc) return ERR.REF;
      const rowShift = toNum(evalNode(args[1], ctx));
      const colShift = toNum(evalNode(args[2], ctx));
      if (typeof rowShift === 'string' || typeof colShift === 'string') return ERR.VALUE;
      const newR = rc.r + Math.trunc(rowShift as number);
      const newC = rc.c + Math.trunc(colShift as number);
      if (newR < 0 || newC < 0) return ERR.REF;
      const height = args.length > 3 ? Math.trunc(toNum(evalNode(args[3], ctx)) as number) : 1;
      const width = args.length > 4 ? Math.trunc(toNum(evalNode(args[4], ctx)) as number) : 1;
      if (height === 1 && width === 1) return computeCell(rcToA1(newR, newC), ctx);
      const out: unknown[] = [];
      for (let r = 0; r < height; r++)
        for (let c = 0; c < width; c++)
          out.push(computeCell(rcToA1(newR + r, newC + c), ctx));
      return out;
    }

    // ---- Conditional extras ----
    case 'MAXIFS': {
      if (args.length < 3 || (args.length - 1) % 2 !== 0) return ERR.ERROR;
      const maxRange = flattenRange(args[0], ctx);
      const maxPairs: Array<{ range: unknown[]; matcher: (v: unknown) => boolean }> = [];
      for (let k = 1; k + 1 < args.length; k += 2)
        maxPairs.push({ range: flattenRange(args[k], ctx), matcher: makeCriterionMatcher(evalNode(args[k + 1], ctx)) });
      let maxVal = -Infinity; let maxFound = false;
      for (let i = 0; i < maxRange.length; i++) {
        if (maxPairs.every((p) => i < p.range.length && p.matcher(p.range[i]))) {
          const v = maxRange[i]; if (typeof v === 'number') { maxVal = Math.max(maxVal, v); maxFound = true; }
        }
      }
      return maxFound ? maxVal : 0;
    }
    case 'MINIFS': {
      if (args.length < 3 || (args.length - 1) % 2 !== 0) return ERR.ERROR;
      const minRange = flattenRange(args[0], ctx);
      const minPairs: Array<{ range: unknown[]; matcher: (v: unknown) => boolean }> = [];
      for (let k = 1; k + 1 < args.length; k += 2)
        minPairs.push({ range: flattenRange(args[k], ctx), matcher: makeCriterionMatcher(evalNode(args[k + 1], ctx)) });
      let minVal = Infinity; let minFound = false;
      for (let i = 0; i < minRange.length; i++) {
        if (minPairs.every((p) => i < p.range.length && p.matcher(p.range[i]))) {
          const v = minRange[i]; if (typeof v === 'number') { minVal = Math.min(minVal, v); minFound = true; }
        }
      }
      return minFound ? minVal : 0;
    }

    // ---- Financial ----
    case 'PMT': {
      if (args.length < 3) return ERR.ERROR;
      const rate = toNum(argVals[0]); const nper = toNum(argVals[1]); const pv = toNum(argVals[2]);
      if (typeof rate === 'string' || typeof nper === 'string' || typeof pv === 'string') return ERR.VALUE;
      const fvPmt = argVals.length > 3 ? (toNum(argVals[3]) as number) : 0;
      const typePmt = argVals.length > 4 ? (toNum(argVals[4]) as number) : 0;
      const r = rate as number; const n = nper as number; const p = pv as number;
      if (r === 0) return -(p + fvPmt) / n;
      const pvifPmt = Math.pow(1 + r, n);
      return -(p * pvifPmt + fvPmt) / ((pvifPmt - 1) / r * (1 + r * typePmt));
    }
    case 'FV': {
      if (args.length < 3) return ERR.ERROR;
      const rate = toNum(argVals[0]); const nper = toNum(argVals[1]); const pmt = toNum(argVals[2]);
      if (typeof rate === 'string' || typeof nper === 'string' || typeof pmt === 'string') return ERR.VALUE;
      const pvFv = argVals.length > 3 ? (toNum(argVals[3]) as number) : 0;
      const typeFv = argVals.length > 4 ? (toNum(argVals[4]) as number) : 0;
      const r = rate as number; const n = nper as number; const pmt_ = pmt as number;
      if (r === 0) return -(pvFv + pmt_ * n);
      const pvifFv = Math.pow(1 + r, n);
      return -(pvFv * pvifFv + pmt_ * (1 + r * typeFv) * (pvifFv - 1) / r);
    }
    case 'PV': {
      if (args.length < 3) return ERR.ERROR;
      const rate = toNum(argVals[0]); const nper = toNum(argVals[1]); const pmt = toNum(argVals[2]);
      if (typeof rate === 'string' || typeof nper === 'string' || typeof pmt === 'string') return ERR.VALUE;
      const fvPv = argVals.length > 3 ? (toNum(argVals[3]) as number) : 0;
      const typePv = argVals.length > 4 ? (toNum(argVals[4]) as number) : 0;
      const r = rate as number; const n = nper as number; const pmt_ = pmt as number;
      if (r === 0) return -(pmt_ * n + fvPv);
      const pvifPv = Math.pow(1 + r, n);
      return -(pmt_ * (1 + r * typePv) * (pvifPv - 1) / r + fvPv) / pvifPv;
    }
    case 'NPV': {
      if (args.length < 2) return ERR.ERROR;
      const rate = toNum(argVals[0]); if (typeof rate === 'string') return ERR.VALUE;
      const vals = flatten(argVals.slice(1)).filter((v) => typeof v === 'number') as number[];
      let npv = 0;
      for (let i = 0; i < vals.length; i++) npv += vals[i] / Math.pow(1 + (rate as number), i + 1);
      return npv;
    }
    case 'IRR': {
      const irrVals = flattenRange(args[0], ctx).filter((v) => typeof v === 'number') as number[];
      if (irrVals.length === 0) return ERR.VALUE;
      const guess = argVals.length > 1 ? (toNum(argVals[1]) as number) : 0.1;
      let irrRate = guess;
      for (let iter = 0; iter < 200; iter++) {
        let npv = 0, dnpv = 0;
        for (let i = 0; i < irrVals.length; i++) {
          const f = Math.pow(1 + irrRate, i);
          npv += irrVals[i] / f;
          dnpv -= i * irrVals[i] / (f * (1 + irrRate));
        }
        if (Math.abs(dnpv) < 1e-10) return ERR.VALUE;
        const next = irrRate - npv / dnpv;
        if (Math.abs(next - irrRate) < 1e-8) return next;
        irrRate = next;
      }
      return ERR.VALUE;
    }
  }
  return ERR.NAME;
}

// ---- Range / 2D helpers ----

function flattenRange(node: Node, ctx: EvalCtx): unknown[] {
  if (node.type === 'named') {
    const nr = ctx.namedRanges?.find(
      (r) => r.name === node.name && r.sheetId === ctx.sheet.id,
    );
    if (!nr) return [ERR.NAME];
    const { r1, c1, r2, c2 } = nr.range;
    const out: unknown[] = [];
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++)
        out.push(computeCell(rcToA1(r, c), ctx));
    return out;
  }
  if (node.type === 'range') {
    const ra = a1ToRC(node.a);
    const rb = a1ToRC(node.b);
    if (!ra || !rb) return [ERR.REF];
    const range = normalizeRange(ra.r, ra.c, rb.r, rb.c);
    const out: unknown[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        out.push(computeCell(rcToA1(r, c), ctx));
      }
    }
    return out;
  }
  const v = evalNode(node, ctx);
  return Array.isArray(v) ? (v as unknown[]) : [v];
}

function eval2D(node: Node, ctx: EvalCtx): unknown[][] {
  if (node.type === 'colrange') {
    return eval2D(
      { type: 'range', a: node.startCol + '1', b: node.endCol + ctx.sheet.rowCount },
      ctx,
    );
  }
  if (node.type === 'range') {
    const ra = a1ToRC(node.a);
    const rb = a1ToRC(node.b);
    if (!ra || !rb) return [[ERR.REF]];
    const range = normalizeRange(ra.r, ra.c, rb.r, rb.c);
    const out: unknown[][] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const row: unknown[] = [];
      for (let c = range.c1; c <= range.c2; c++) {
        row.push(computeCell(rcToA1(r, c), ctx));
      }
      out.push(row);
    }
    return out;
  }
  return [[evalNode(node, ctx)]];
}

// ---- Criterion / wildcard helpers ----

/**
 * Build a predicate from an Excel-style criterion. Supports:
 *   - leading comparator: `>`, `>=`, `<`, `<=`, `=`, `<>`
 *   - implicit equality with `*` and `?` wildcards
 *   - direct equality for non-string values
 */
function makeCriterionMatcher(crit: unknown): (v: unknown) => boolean {
  if (typeof crit === 'number' || typeof crit === 'boolean') {
    return (v) => loose(v) === loose(crit);
  }
  if (typeof crit !== 'string') {
    return (v) => v === crit;
  }
  const m = crit.match(/^(<>|<=|>=|<|>|=)(.*)$/);
  if (m) {
    const op = m[1];
    const rhs = m[2];
    const nrhs = Number(rhs);
    const rhsIsNum = rhs !== '' && !Number.isNaN(nrhs) && Number.isFinite(nrhs);
    return (v) => {
      if (rhsIsNum) {
        const nv = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(nv)) {
          // Non-numeric values only match `<>` against a number.
          return op === '<>';
        }
        switch (op) {
          case '=':
            return nv === nrhs;
          case '<>':
            return nv !== nrhs;
          case '<':
            return nv < nrhs;
          case '<=':
            return nv <= nrhs;
          case '>':
            return nv > nrhs;
          case '>=':
            return nv >= nrhs;
        }
      }
      // Text comparison: collapses to wildcard equality / inequality for =/<>.
      const sv = v == null ? '' : String(v).toLowerCase();
      const sr = rhs.toLowerCase();
      if (op === '=' || op === '<>') {
        const eq = new RegExp(`^${wildcardToRegex(sr, true)}$`).test(sv);
        return op === '=' ? eq : !eq;
      }
      return op === '<'
        ? sv < sr
        : op === '<='
          ? sv <= sr
          : op === '>'
            ? sv > sr
            : sv >= sr;
    };
  }
  // No operator: treat as wildcard equality (case-insensitive).
  const re = new RegExp(`^${wildcardToRegex(crit, true)}$`, 'i');
  return (v) => (v != null && re.test(String(v)));
}

function loose(v: unknown): string {
  return v == null ? '' : String(v).toLowerCase();
}

function wildcardToRegex(pattern: string, anchored: boolean): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '~' && (pattern[i + 1] === '*' || pattern[i + 1] === '?')) {
      out += escapeRe(pattern[i + 1]);
      i++;
      continue;
    }
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else out += escapeRe(c);
  }
  return anchored ? out : out;
}

function escapeRe(c: string): string {
  return /[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c;
}

// ---- Lookup helpers ----

function findLookupRow(
  table: unknown[][],
  needle: unknown,
  col: number,
  exact: boolean,
): number {
  if (exact) {
    for (let r = 0; r < table.length; r++) {
      if (equalLoose(table[r][col], needle)) return r;
    }
    return -1;
  }
  // Approximate match: assume sorted ascending; return last row with value <= needle.
  let last = -1;
  for (let r = 0; r < table.length; r++) {
    const v = table[r][col];
    if (compareLoose(v, needle) <= 0) last = r;
    else break;
  }
  return last;
}

function findLookupIn1D(arr: unknown[], needle: unknown, exact: boolean): number {
  if (exact) {
    for (let i = 0; i < arr.length; i++) if (equalLoose(arr[i], needle)) return i;
    return -1;
  }
  let last = -1;
  for (let i = 0; i < arr.length; i++) {
    if (compareLoose(arr[i], needle) <= 0) last = i;
    else break;
  }
  return last;
}

function matchIn1D(arr: unknown[], needle: unknown, type: number): number {
  if (type === 0) {
    // Exact match; supports wildcards when needle is a string.
    if (typeof needle === 'string' && /[*?]/.test(needle)) {
      const re = new RegExp(`^${wildcardToRegex(needle, true)}$`, 'i');
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] == null) continue;
        if (re.test(String(arr[i]))) return i;
      }
      return -1;
    }
    for (let i = 0; i < arr.length; i++) {
      if (equalLoose(arr[i], needle)) return i;
    }
    return -1;
  }
  if (type === 1) {
    // Largest value <= needle, in ascending data.
    let last = -1;
    for (let i = 0; i < arr.length; i++) {
      if (compareLoose(arr[i], needle) <= 0) last = i;
    }
    return last;
  }
  if (type === -1) {
    // Smallest value >= needle, in descending data.
    let last = -1;
    for (let i = 0; i < arr.length; i++) {
      if (compareLoose(arr[i], needle) >= 0) last = i;
    }
    return last;
  }
  return -1;
}

function equalLoose(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function compareLoose(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = a == null ? '' : String(a).toLowerCase();
  const sb = b == null ? '' : String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// ---- Number-to-words helper ----
function numberToWords(n: number): string {
  if (n === 0) return 'zero';
  const ones = ['','one','two','three','four','five','six','seven','eight','nine',
    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  function below1000(x: number): string {
    if (x === 0) return '';
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : '');
    return ones[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' + below1000(x % 100) : '');
  }
  const scales = ['', ' thousand', ' million', ' billion', ' trillion'];
  let result = '';
  let rem = n;
  for (let i = 0; rem > 0; i++) {
    const chunk = rem % 1000;
    if (chunk !== 0) result = below1000(chunk) + scales[i] + (result ? ' ' + result : '');
    rem = Math.floor(rem / 1000);
  }
  return result.trim();
}

// ---- Date helpers ----

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Treat as Excel serial date (days since 1899-12-30).
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    // Accept ISO 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM' / 'YYYY-MM-DD HH:MM'.
    const iso = v.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null;
    if (iso) {
      const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

// ---- Text format helpers ----

function applyTextFormat(n: number, fmt: string): string {
  if (!fmt) return formatNumber(n);
  // Currency forms: "$0", "$0.00"
  let m = fmt.match(/^\$(0)(\.0+)?$/);
  if (m) {
    const decimals = m[2] ? m[2].length - 1 : 0;
    return (
      '$' +
      n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  }
  // Percent forms: "0%", "0.0%", "0.00%"
  m = fmt.match(/^(0)(\.0+)?%$/);
  if (m) {
    const decimals = m[2] ? m[2].length - 1 : 0;
    return (
      (n * 100).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + '%'
    );
  }
  // Number forms: "0", "0.00", "0,000.00"
  m = fmt.match(/^(0|0,000)(\.0+)?$/);
  if (m) {
    const decimals = m[2] ? m[2].length - 1 : 0;
    const useGrouping = m[1] === '0,000';
    return n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping,
    });
  }
  // Date: 'yyyy-mm-dd' (minimal)
  if (/^y{4}-m{2}-d{2}$/i.test(fmt)) {
    const d = parseDate(n);
    if (!d) return String(n);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
      d.getUTCDate(),
    )}`;
  }
  return formatNumber(n);
}

function pad(n: number) {
  return n < 10 ? '0' + n : String(n);
}

function evalBin(
  op: string,
  l: Node,
  r: Node,
  ctx: EvalCtx,
): unknown {
  const lv = evalNode(l, ctx);
  const rv = evalNode(r, ctx);
  if (isError(lv)) return lv;
  if (isError(rv)) return rv;
  if (op === '&') return toStr(lv) + toStr(rv);
  if (['=', '<>', '<', '>', '<=', '>='].includes(op))
    return compare(op, lv, rv);
  const a = toNum(lv);
  const b = toNum(rv);
  if (typeof a === 'string') return a;
  if (typeof b === 'string') return b;
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? ERR.DIV0 : a / b;
    case '^':
      return Math.pow(a, b);
  }
  return ERR.ERROR;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  let ca: number | string;
  let cb: number | string;
  if (typeof a === 'number' && typeof b === 'number') {
    ca = a;
    cb = b;
  } else if (typeof a === 'boolean' && typeof b === 'boolean') {
    ca = a ? 1 : 0;
    cb = b ? 1 : 0;
  } else {
    ca = toStr(a);
    cb = toStr(b);
  }
  switch (op) {
    case '=':
      return ca === cb;
    case '<>':
      return ca !== cb;
    case '<':
      return ca < cb;
    case '>':
      return ca > cb;
    case '<=':
      return ca <= cb;
    case '>=':
      return ca >= cb;
  }
  return false;
}

// ---- Public API ----

export function computeSheet(
  sheet: Sheet,
  namedRanges?: NamedRange[],
): Record<string, unknown> {
  const computed: Record<string, unknown> = {};
  const stack = new Set<string>();
  const ctx: EvalCtx = { sheet, computed, stack, namedRanges, depth: 0 };
  const cells = sheet.cells ?? {};
  for (const a1 in cells) {
    const cell = cells[a1];
    if (cell?.f) computeCell(a1, ctx);
  }
  return computed;
}

export function formatComputed(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ERR.DIV0;
    // Trim trailing zeros for nicer display, cap at 10 decimal places
    return formatNumber(v);
  }
  return String(v);
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const fixed = n.toFixed(10);
  return fixed.replace(/\.?0+$/, '');
}
