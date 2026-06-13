'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  useFetchDatasource,
  extractArrayAtPath,
  type DetectedArray,
} from '@/hooks/use-report-datasource';
import { applyAggregation, type Aggregation } from '@/lib/kpi-format';
import { cn } from '@/lib/utils';
import {
  ChevronDown, ChevronRight, KeyRound, Layers, Loader2, Maximize2, Plus, RefreshCw, Tag, Trash2, Type, Wifi, X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AggDef = { fieldKey: string; aggregation: Aggregation };

export type StoredTextDatasource = {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  sourceMode: 'root' | 'array';
  // root mode
  rootField?: string;
  // array mode — supports multiple aggregations
  dataPath?: string;
  aggDefs: AggDef[];
  // array join mode — maps each row to a string and joins them
  joinMode?: boolean;
  joinRowTemplate?: string;
  joinSeparator?: string;
  // legacy single-agg (migrated on load)
  fieldKey?: string;
  aggregation?: Aggregation;
  // shared
  template: string;
};

type HeaderRow = { key: string; value: string };

interface Props {
  props: Record<string, unknown>;
  onApply: (patch: Record<string, unknown>) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type RootField = { key: string; value: string | number };

function extractRootFields(data: unknown): RootField[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const results: RootField[] = [];
  function walk(obj: Record<string, unknown>, prefix: string) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string' || typeof v === 'number') {
        results.push({ key, value: v as string | number });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, key);
      }
    }
  }
  walk(data as Record<string, unknown>, '');
  return results.slice(0, 40);
}

/** Read a (possibly nested) value from a row using a dot-notation path. */
function getNestedValue(row: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return row[key];
  const parts = key.split('.');
  let cur: unknown = row;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Render a template string.
 * - `{value}` / `{value0}` / `{value1}` … → aggregation results
 * - `{fieldName}` (any other token) → first row's value for that field
 */
function renderTemplate(
  template: string,
  values: (string | number)[],
  firstRow?: Record<string, unknown>,
): string {
  let result = template;
  // 1. Replace {value0}, {value1}, … with aggregation results
  values.forEach((v, i) => {
    result = result.replace(new RegExp(`\\{value${i}\\}`, 'g'), String(v));
  });
  // 2. Replace {value} alias with first aggregation result
  if (values.length > 0) result = result.replace(/\{value\}/g, String(values[0]));
  // 3. Replace remaining {fieldName} and {fieldName|round} tokens with first-row field values
  if (firstRow) {
    result = result.replace(/\{([^|}]+)(\|round)?\}/g, (match, key, mod) => {
      if (key === 'value' || /^value\d+$/.test(key)) return match;
      const val = getNestedValue(firstRow, key.trim());
      if (val === undefined || val === null) return match;
      if (mod === '|round') {
        const num = typeof val === 'number' ? val : parseFloat(String(val));
        if (!isNaN(num)) return String(Math.round(num));
      }
      return String(val);
    });
  }
  return result;
}

/** Render a per-row join template. Supports {field} and {field|round}. */
function renderRowTemplate(tmpl: string, row: Record<string, unknown>): string {
  return tmpl.replace(/\{([^|}]+)(\|round)?\}/g, (match, key, mod) => {
    const val = getNestedValue(row, key.trim());
    if (val === undefined || val === null) return match;
    if (mod === '|round') {
      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (!isNaN(num)) return String(Math.round(num));
    }
    return String(val);
  });
}

// ── Extra helpers ─────────────────────────────────────────────────────────────

/** Walk the full JSON tree and return every usable path — arrays AND flat objects. */
function detectAllPaths(
  data: unknown,
  prefix = '',
  depth = 0,
): DetectedArray[] {
  if (!data || typeof data !== 'object' || depth > 6) return [];
  const results: DetectedArray[] = [];

  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      const merged: Record<string, unknown> = {};
      (data as Record<string, unknown>[]).slice(0, 10).forEach((r) => Object.assign(merged, r));
      const columns = Object.entries(merged)
        .filter(([, v]) => v !== null && typeof v !== 'object')
        .map(([key, val]) => ({ key, type: typeof val === 'number' ? 'number' : 'string' }));
      if (columns.length > 0)
        results.push({ path: prefix, count: (data as unknown[]).length, columns });
    }
    return results;
  }

  const obj = data as Record<string, unknown>;
  const scalarCols = Object.entries(obj)
    .filter(([, v]) => v !== null && (typeof v === 'string' || typeof v === 'number'))
    .map(([key, val]) => ({ key, type: typeof val === 'number' ? 'number' : 'string' }));

  if (scalarCols.length >= 1 && prefix) {
    results.push({ path: prefix, count: 1, columns: scalarCols });
  }

  for (const [key, val] of Object.entries(obj)) {
    if (val !== null && typeof val === 'object') {
      const childPath = prefix ? `${prefix}.${key}` : key;
      results.push(...detectAllPaths(val, childPath, depth + 1));
    }
  }

  return results;
}

/** Extract rows — handles both arrays and plain objects (returns 1-row array for objects). */
function extractRows(data: unknown, path: string): Record<string, unknown>[] {
  const fromArray = extractArrayAtPath(data, path);
  if (fromArray.length > 0) return fromArray;
  // Resolve the path manually and wrap a plain object as a single row
  const parts = path ? path.split('.') : [];
  let cur: unknown = data;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return [];
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) return [cur as Record<string, unknown>];
  return [];
}

// ── Join Row Modal ─────────────────────────────────────────────────────────────

interface JoinRowModalConfig {
  path: string;
  joinMode: boolean;
  joinRowTemplate: string;
  joinSeparator: string;
  aggDefs: AggDef[];
}

function JoinRowModal({
  data,
  detected,
  initial,
  onApply,
  onClose,
}: {
  data: unknown;
  detected: DetectedArray[];
  initial: JoinRowModalConfig;
  onApply: (cfg: JoinRowModalConfig) => void;
  onClose: () => void;
}) {
  const allPaths = useMemo(() => {
    const clientPaths = detectAllPaths(data);
    const backendKeys = new Set(detected.map((d) => d.path));
    const merged = [
      ...detected,
      ...clientPaths.filter((p) => !backendKeys.has(p.path)),
    ];
    return merged.sort((a, b) => a.path.localeCompare(b.path));
  }, [data, detected]);

  const [selectedPath, setSelectedPath] = useState<string>(
    () => initial.path || allPaths[0]?.path || '',
  );
  const [joinMode, setJoinMode] = useState(initial.joinMode);
  const [joinRowTemplate, setJoinRowTemplate] = useState(initial.joinRowTemplate);
  const [joinSeparator, setJoinSeparator] = useState(initial.joinSeparator || ', ');
  const [aggDefs, setAggDefs] = useState<AggDef[]>(
    initial.aggDefs.length
      ? initial.aggDefs
      : [{ fieldKey: '', aggregation: 'first' as Aggregation }],
  );

  const selectedPathInfo = allPaths.find((p) => p.path === selectedPath);
  const rows = useMemo(() => extractRows(data, selectedPath), [data, selectedPath]);

  const cols: { key: string; type: string }[] = (() => {
    if (selectedPathInfo?.columns?.length) return selectedPathInfo.columns;
    if (!rows.length) return [];
    const merged: Record<string, unknown> = {};
    rows.slice(0, 5).forEach((r) => Object.assign(merged, r));
    return Object.entries(merged)
      .filter(([, v]) => v !== null && typeof v !== 'object')
      .map(([key, val]) => ({ key, type: typeof val === 'number' ? 'number' : 'string' }));
  })();

  const firstRow = rows[0];

  const previewText = useMemo(() => {
    if (!rows.length || !joinMode || !joinRowTemplate.trim()) return null;
    return rows
      .map((row) => renderRowTemplate(joinRowTemplate, row as Record<string, unknown>))
      .join(joinSeparator);
  }, [rows, joinMode, joinRowTemplate, joinSeparator]);

  const handleApply = () => {
    onApply({
      path: selectedPath,
      joinMode,
      joinRowTemplate,
      joinSeparator,
      aggDefs: aggDefs.filter((d) => d.fieldKey),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-accent-600" />
            <span className="text-sm font-semibold">Select Data Path</span>
            <span className="text-[10px] text-text-muted bg-bg-subtle border border-border px-2 py-0.5 rounded-full">
              {allPaths.length} paths detected
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: path list */}
          <div className="w-52 flex-shrink-0 border-r border-border overflow-y-auto p-2 space-y-0.5 bg-bg-subtle/40">
            {allPaths.map((p) => (
              <button
                key={p.path}
                onClick={() => setSelectedPath(p.path)}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition-colors border',
                  selectedPath === p.path
                    ? 'bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400 border-accent-200 dark:border-accent-800'
                    : 'text-text-muted hover:text-text hover:bg-bg-hover border-transparent',
                )}
              >
                <span className="font-mono font-semibold block truncate">
                  {p.path || '(root)'}
                </span>
                <span className="text-[9px] opacity-60">
                  {p.count === 1 ? 'object' : `${p.count} rows`} · {p.columns.length} fields
                </span>
              </button>
            ))}
            {allPaths.length === 0 && (
              <p className="text-[10px] text-text-muted text-center py-6 px-2">
                No paths detected
              </p>
            )}
          </div>

          {/* Right: config panel */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedPathInfo ? (
              <>
                {/* Field chips */}
                <div>
                  <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Fields at{' '}
                    <code className="font-mono normal-case text-accent-600 bg-accent-50 dark:bg-accent-950/30 px-1 rounded">
                      {selectedPath}
                    </code>
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {cols.map((col) => (
                      <span
                        key={col.key}
                        className={cn(
                          'px-2 py-0.5 rounded-full border text-[10px] font-mono',
                          col.type === 'number'
                            ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                            : 'border-border bg-bg-subtle text-text-muted',
                        )}
                      >
                        {col.key}
                        {col.type === 'number' ? ' #' : ''}
                      </span>
                    ))}
                  </div>
                </div>

                {/* First row preview */}
                {firstRow && (
                  <div className="bg-bg-subtle border border-border rounded-lg p-3 overflow-auto max-h-28">
                    <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      First row
                    </p>
                    <div className="space-y-0.5">
                      {Object.entries(firstRow).slice(0, 12).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-[10px] font-mono">
                          <span className="text-accent-600 dark:text-accent-400 font-semibold w-32 truncate flex-shrink-0">
                            {k}
                          </span>
                          <span className="text-text truncate">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mode toggle */}
                <div>
                  <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Output mode
                  </span>
                  <div className="flex gap-1">
                    {(
                      [
                        { id: false, label: 'Aggregate', desc: 'Compute SUM / AVG / COUNT' },
                        { id: true,  label: 'Join rows',  desc: 'Format each row as text'  },
                      ] as const
                    ).map(({ id, label, desc }) => (
                      <button
                        key={String(id)}
                        onClick={() => setJoinMode(id)}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg border text-left transition-colors',
                          joinMode === id
                            ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30'
                            : 'border-border hover:border-accent-300 hover:bg-bg-hover',
                        )}
                      >
                        <p className={cn('text-[11px] font-semibold', joinMode === id ? 'text-accent-700 dark:text-accent-400' : 'text-text-muted')}>
                          {label}
                        </p>
                        <p className="text-[9px] text-text-muted mt-0.5">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Join rows config */}
                {joinMode && (
                  <div className="space-y-3 bg-bg-subtle border border-border rounded-xl p-3">
                    <div>
                      <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                        Row template
                      </span>
                      <input
                        type="text"
                        placeholder="{name} ({kwh|round} kWh)"
                        value={joinRowTemplate}
                        onChange={(e) => setJoinRowTemplate(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      />
                      <p className="text-[9px] text-text-muted mt-1 leading-relaxed">
                        Use <code className="bg-bg px-0.5 rounded">&#123;field&#125;</code> or{' '}
                        <code className="bg-bg px-0.5 rounded">&#123;field|round&#125;</code> for numbers.
                        Click to insert:
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {cols.map((col) => (
                          <button
                            key={col.key}
                            onClick={() => {
                              const token = col.type === 'number'
                                ? `{${col.key}|round}`
                                : `{${col.key}}`;
                              setJoinRowTemplate((t) => `${t}${token}`);
                            }}
                            className="px-1.5 py-0.5 rounded-full border border-border bg-bg text-[9px] font-mono hover:border-accent-500 hover:text-accent-600 transition-colors"
                          >
                            +{col.key}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                        Separator
                      </span>
                      <input
                        type="text"
                        placeholder=", "
                        value={joinSeparator}
                        onChange={(e) => setJoinSeparator(e.target.value)}
                        className="w-32 px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                      />
                    </div>
                    {previewText !== null && (
                      <div className="bg-bg border border-border rounded-lg p-2.5">
                        <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                          Preview
                        </p>
                        <p className="text-xs text-text break-all leading-relaxed">{previewText}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Aggregate config */}
                {!joinMode && (
                  <div className="space-y-2">
                    <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                      Aggregations
                    </span>
                    {aggDefs.map((def, idx) => (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex items-center gap-1">
                          {cols.length > 0 ? (
                            <select
                              value={def.fieldKey}
                              onChange={(e) =>
                                setAggDefs((p) =>
                                  p.map((d, j) => j === idx ? { ...d, fieldKey: e.target.value } : d),
                                )
                              }
                              className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                            >
                              <option value="">— pick field —</option>
                              {cols.map((c) => (
                                <option key={c.key} value={c.key}>
                                  {c.key}{c.type === 'number' ? ' (#)' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              placeholder="field name"
                              value={def.fieldKey}
                              onChange={(e) =>
                                setAggDefs((p) =>
                                  p.map((d, j) => j === idx ? { ...d, fieldKey: e.target.value } : d),
                                )
                              }
                              className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input"
                            />
                          )}
                          {idx > 0 && (
                            <button
                              onClick={() => setAggDefs((p) => p.filter((_, j) => j !== idx))}
                              className="p-1.5 rounded text-text-muted hover:text-red-500 flex-shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {(['count', 'sum', 'avg', 'min', 'max', 'first'] as Aggregation[]).map((agg) => (
                            <button
                              key={agg}
                              onClick={() =>
                                setAggDefs((p) =>
                                  p.map((d, j) => j === idx ? { ...d, aggregation: agg } : d),
                                )
                              }
                              className={cn(
                                'py-1 text-[10px] rounded-md border font-semibold transition-colors',
                                def.aggregation === agg
                                  ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                                  : 'border-border text-text-muted hover:text-text',
                              )}
                            >
                              {agg.toUpperCase()}
                            </button>
                          ))}
                        </div>
                        {idx < aggDefs.length - 1 && <div className="border-t border-border/60" />}
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setAggDefs((p) => [...p, { fieldKey: '', aggregation: 'first' as Aggregation }])
                      }
                      className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add aggregation
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
                <Layers className="w-8 h-8 opacity-20" />
                <p className="text-xs text-center opacity-60">Select a path from the left panel</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border flex-shrink-0 bg-bg-card">
          <p className="text-[10px] text-text-muted">
            {selectedPath ? (
              <>
                Selected: <code className="font-mono text-accent-600">{selectedPath}</code>
                {' · '}
                {rows.length === 1 ? '1 row' : `${rows.length} rows`}
              </>
            ) : (
              'No path selected'
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!selectedPath}
              className="px-4 py-1.5 text-xs rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50 font-semibold transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Micro-components ──────────────────────────────────────────────────────────

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
        'w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input',
        'focus:outline-none focus:border-accent-400 transition-colors',
        props.className,
      )}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TextDataSourcePanel({ props, onApply }: Props) {
  const stored = props.textDataSource as StoredTextDatasource | undefined;

  const [url, setUrl]         = useState(stored?.url ?? '');
  const [method, setMethod]   = useState<'GET' | 'POST'>(stored?.method ?? 'GET');
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.entries(stored?.headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [bearerToken, setBearerToken] = useState('');
  const [showAuth,    setShowAuth]    = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showJson,      setShowJson]      = useState(false);
  const [jsonFullscreen, setJsonFullscreen] = useState(false);

  const [sourceMode,   setSourceMode]   = useState<'root' | 'array'>(stored?.sourceMode ?? 'root');
  const [rootField,    setRootField]    = useState(stored?.rootField ?? '');
  const [selectedPath, setSelectedPath] = useState(stored?.dataPath ?? '');

  // aggDefs — migrate legacy single-field on load
  const [aggDefs, setAggDefs] = useState<AggDef[]>(() => {
    if (stored?.aggDefs?.length) return stored.aggDefs;
    if (stored?.fieldKey) return [{ fieldKey: stored.fieldKey, aggregation: stored.aggregation ?? 'first' }];
    return [{ fieldKey: '', aggregation: 'first' }];
  });

  const [joinMode,        setJoinMode]        = useState(stored?.joinMode ?? false);
  const [joinRowTemplate, setJoinRowTemplate] = useState(stored?.joinRowTemplate ?? '');
  const [joinSeparator,   setJoinSeparator]   = useState(stored?.joinSeparator ?? ', ');
  const [showJoinModal,   setShowJoinModal]   = useState(false);

  // In join mode the outer template must be {value} — auto-correct if stored value is wrong
  const [template, setTemplate] = useState(() => {
    const t = stored?.template ?? '{value}';
    if (stored?.joinMode && !t.includes('{value}')) return '{value}';
    return t;
  });

  const fetchDs  = useFetchDatasource();
  const result   = fetchDs.data;
  const detected: DetectedArray[] = result?.detected ?? [];
  const rootFields  = result ? extractRootFields(result.data) : [];
  const activeArray = detected.find((d) => d.path === selectedPath) ?? detected[0];

  // If auto-detect found no columns (detected empty), derive columns directly
  // Client-side fallback: find the first array key in the response
  // when backend detected nothing (handles CORS-fetched APIs, flat structures, etc.)
  const clientAutoPath = (() => {
    if (!result || detected.length > 0) return '';
    const data = result.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') return key;
    }
    return '';
  })();

  // Effective path: user-typed > client-auto > empty
  const effectivePath = selectedPath || clientAutoPath;

  // Derive columns from detected, or client-side from extracted rows
  const arrayCols: { key: string; type: string }[] = (() => {
    if (activeArray?.columns?.length) return activeArray.columns;
    if (!result) return [];
    const path = effectivePath;
    if (!path) return [];
    const rows = extractRows(result.data, path);
    if (!rows.length) return [];
    const merged: Record<string, unknown> = {};
    rows.slice(0, 5).forEach((r) => Object.assign(merged, r));
    return Object.entries(merged).map(([key, val]) => ({
      key,
      type: typeof val === 'number' ? 'number' : 'string',
    }));
  })();

  // ── Auto-fetch on mount when stored URL exists ────────────────────────────
  useEffect(() => {
    if (!stored?.url || fetchDs.data || fetchDs.isPending) return;
    fetchDs.mutate({
      url: stored.url,
      method: stored.method ?? 'GET',
      headers: stored.headers ?? {},
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AggDef helpers ────────────────────────────────────────────────────────

  const addAggDef    = () => setAggDefs((p) => [...p, { fieldKey: '', aggregation: 'first' }]);
  const removeAggDef = (i: number) => setAggDefs((p) => p.filter((_, j) => j !== i));
  const updateAggDef = (i: number, patch: Partial<AggDef>) =>
    setAggDefs((p) => p.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  // ── Request helpers ───────────────────────────────────────────────────────

  const headersMap = (): Record<string, string> => {
    const map: Record<string, string> = {};
    if (bearerToken.trim()) map['Authorization'] = `Bearer ${bearerToken.trim()}`;
    headers.forEach(({ key, value }) => { if (key.trim()) map[key.trim()] = value; });
    return map;
  };

  const handleFetch = () => {
    if (!url.trim()) return;
    fetchDs.mutate({ url: url.trim(), method, headers: headersMap() }, {
      onSuccess: (res) => {
        const roots = extractRootFields(res.data);
        if (roots.length > 0) {
          setSourceMode('root');
          setRootField(roots[0].key);
        } else if (res.detected.length > 0) {
          setSourceMode('array');
          const first = res.detected[0];
          setSelectedPath(first.path);
          const numCol = first.columns.find((c) => c.type === 'number');
          if (numCol) setAggDefs([{ fieldKey: numCol.key, aggregation: 'first' }]);
        } else {
          // Backend found nothing — try client-side detection
          setSourceMode('array');
          const data = res.data;
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
              if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
                setSelectedPath(key);
                // Derive columns from first few rows
                const merged: Record<string, unknown> = {};
                (val as Record<string, unknown>[]).slice(0, 5).forEach((r) => Object.assign(merged, r));
                const numCol = Object.entries(merged).find(([, v]) => typeof v === 'number');
                if (numCol) setAggDefs([{ fieldKey: numCol[0], aggregation: 'first' }]);
                break;
              }
            }
          }
        }
        setShowJson(true);
      },
    });
  };

  // ── Computed preview values (one per aggDef) ──────────────────────────────

  const previewValues = (() => {
    if (!result) return null;
    if (sourceMode === 'root') {
      const f = rootFields.find((r) => r.key === rootField);
      if (f !== undefined) return [f.value];
      // fallback: resolve dot-notation path directly from response data
      if (rootField) {
        const val = getNestedValue(result.data as Record<string, unknown>, rootField);
        if (typeof val === 'string' || typeof val === 'number') return [val];
      }
      return null;
    }
    const rows = extractRows(result.data, effectivePath);
    if (!rows.length) return null;
    if (joinMode) {
      if (!joinRowTemplate.trim()) return null;
      const joined = rows.map((row) => renderRowTemplate(joinRowTemplate, row as Record<string, unknown>)).join(joinSeparator);
      return [joined];
    }
    const active = aggDefs.filter((d) => d.fieldKey);
    if (!active.length) return null;
    return active.map((d) => applyAggregation(rows, d.fieldKey, d.aggregation));
  })();

  /** First row of the active array — used to resolve {fieldName} tokens */
  const firstRow = (() => {
    if (!result || sourceMode !== 'array') return undefined;
    const rows = extractRows(result.data, effectivePath);
    return rows[0] as Record<string, unknown> | undefined;
  })();

  const previewText = previewValues !== null
    ? renderTemplate(template, previewValues, firstRow)
    : null;

  // ── Apply helpers ─────────────────────────────────────────────────────────

  /** Apply full template result (including {fieldName} tokens) to text content */
  const handleApply = () => {
    if (previewValues === null) return;
    const ds: StoredTextDatasource = {
      url: url.trim(), method, headers: headersMap(),
      sourceMode, template,
      aggDefs: aggDefs.filter((d) => d.fieldKey),
      ...(sourceMode === 'root'  ? { rootField }            : {}),
      ...(sourceMode === 'array' ? { dataPath: effectivePath } : {}),
      ...(sourceMode === 'array' && joinMode ? { joinMode, joinRowTemplate, joinSeparator } : {}),
    };
    onApply({ ...props, textDataSource: ds, content: renderTemplate(template, previewValues, firstRow) });
  };

  const hasResult = !!result;
  const canApply  = hasResult && previewValues !== null;
  const jsonPreview = hasResult ? JSON.stringify(result.data, null, 2).slice(0, 4000) : '';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="space-y-3 text-xs">

      {/* Active badge */}
      {stored?.url && (
        <div className="flex items-center gap-1.5 bg-accent-50 dark:bg-accent-950/30 border border-accent-200 dark:border-accent-800 rounded-md px-2 py-1.5">
          <Wifi className="w-3 h-3 text-accent-600 flex-shrink-0" />
          <span className="text-accent-700 dark:text-accent-400 truncate text-[10px]">Live: {stored.url}</span>
        </div>
      )}

      {/* Method + URL */}
      <div>
        <Label>API URL</Label>
        <div className="flex gap-1">
          <select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
            className="px-1.5 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 w-16 flex-shrink-0">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <PanelInput type="url" placeholder="https://api.example.com/stats"
            value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleFetch()} />
        </div>
      </div>

      {/* Bearer Token */}
      <div>
        <button onClick={() => setShowAuth((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider hover:text-text transition-colors">
          {showAuth ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <KeyRound className="w-3 h-3" /> Auth {bearerToken && '●'}
        </button>
        {showAuth && (
          <div className="mt-1.5">
            <Label>Bearer Token</Label>
            <PanelInput type="password" placeholder="eyJhbGci…"
              value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} />
          </div>
        )}
      </div>

      {/* Custom Headers */}
      <div>
        <button onClick={() => setShowHeaders((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider hover:text-text transition-colors">
          {showHeaders ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Headers {headers.length > 0 && `(${headers.length})`}
        </button>
        {showHeaders && (
          <div className="mt-1.5 space-y-1">
            {headers.map((h, i) => (
              <div key={i} className="flex gap-1 items-center">
                <PanelInput placeholder="Key" value={h.key} className="flex-1"
                  onChange={(e) => setHeaders((p) => p.map((r, j) => j === i ? { ...r, key: e.target.value } : r))} />
                <PanelInput placeholder="Value" value={h.value} className="flex-1"
                  onChange={(e) => setHeaders((p) => p.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} />
                <button onClick={() => setHeaders((p) => p.filter((_, j) => j !== i))}
                  className="text-text-muted hover:text-red-500 transition-colors flex-shrink-0">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button onClick={() => setHeaders((p) => [...p, { key: '', value: '' }])}
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors">
              <Plus className="w-3 h-3" /> Add header
            </button>
          </div>
        )}
      </div>

      {/* Fetch button */}
      <button onClick={handleFetch} disabled={!url.trim() || fetchDs.isPending}
        className={cn(
          'w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
          'bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed',
        )}>
        {fetchDs.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {fetchDs.isPending ? 'Fetching…' : 'Fetch Data'}
      </button>

      {/* Error */}
      {fetchDs.isError && (
        <p className="text-red-600 dark:text-red-400 text-[10px] bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-2 py-1.5">
          {fetchDs.error.message}
        </p>
      )}

      {/* JSON preview */}
      {hasResult && (
        <div>
          <div className="flex items-center justify-between">
            <button onClick={() => setShowJson((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider hover:text-text transition-colors">
              {showJson ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              JSON Response
            </button>
            <button
              onClick={() => setJsonFullscreen(true)}
              title="Full screen"
              className="p-1 rounded text-text-muted hover:text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-950/30 transition-colors"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
          {showJson && (
            <pre className="mt-1.5 text-[10px] bg-bg-subtle border border-border rounded-md p-2 overflow-auto max-h-28 whitespace-pre-wrap break-all leading-relaxed">
              {jsonPreview}{jsonPreview.length >= 4000 && '\n… (truncated)'}
            </pre>
          )}
        </div>
      )}

      {/* JSON fullscreen modal */}
      {jsonFullscreen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setJsonFullscreen(false)}
        >
          <div
            className="relative w-full max-w-4xl h-[80vh] bg-bg-card border border-border rounded-xl shadow-lg flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-accent-600" />
                <span className="text-sm font-semibold text-text">JSON Response</span>
                <span className="text-[10px] text-text-muted font-mono truncate max-w-[300px]">{url}</span>
              </div>
              <button
                onClick={() => setJsonFullscreen(false)}
                className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Scrollable JSON body */}
            <pre className="flex-1 overflow-auto p-4 text-[12px] bg-bg-subtle font-mono whitespace-pre-wrap break-all leading-relaxed text-text">
              {JSON.stringify(result?.data, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Source mode selector — always show when data fetched */}
      {hasResult && (
        <div>
          <Label>Source type</Label>
          <div className="flex gap-1">
            {([
              { id: 'root'  as const, label: 'Object field' },
              { id: 'array' as const, label: 'Array + aggregate' },
            ]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => {
                  setSourceMode(id);
                  if (id === 'array' && hasResult) setShowJoinModal(true);
                }}
                className={cn(
                  'flex-1 py-1.5 text-[10px] rounded-md border transition-colors font-semibold',
                  sourceMode === id
                    ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                    : 'border-border text-text-muted hover:text-text',
                )}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Root field picker — auto list or manual path */}
      {hasResult && sourceMode === 'root' && (
        <div>
          <Label>Pick field</Label>
          {rootFields.length > 0 ? (
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {rootFields.map((f) => (
                <button key={f.key} onClick={() => setRootField(f.key)}
                  className={cn(
                    'flex items-center justify-between px-2 py-1.5 rounded-md border text-[10px] transition-colors text-left',
                    rootField === f.key
                      ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                      : 'border-border text-text-muted hover:text-text',
                  )}>
                  <span className="font-mono font-semibold">{f.key}</span>
                  <span className="truncate ml-2 max-w-[70px] opacity-70">{String(f.value)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <input
                type="text"
                placeholder="e.g. data.total or meta.count"
                value={rootField}
                onChange={(e) => setRootField(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              />
              <p className="text-[9px] text-text-muted">Enter dot-notation path to a field (auto-detect found no scalar fields)</p>
            </div>
          )}
        </div>
      )}

      {/* Array mode — data path dropdown or manual input */}
      {hasResult && sourceMode === 'array' && (
        <div>
          <Label>Data path</Label>
          {detected.length > 0 ? (
            <select value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
              {detected.map((d) => (
                <option key={d.path} value={d.path}>{d.path || '(root)'} — {d.count} rows</option>
              ))}
            </select>
          ) : (
            <div className="space-y-1">
              <input
                type="text"
                placeholder="e.g. data or results.items"
                value={selectedPath}
                onChange={(e) => setSelectedPath(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              />
              <p className="text-[9px] text-text-muted">Enter path to array (auto-detect found no arrays)</p>
            </div>
          )}
        </div>
      )}

      {/* ── Join rows toggle — always show in array mode once data is fetched ── */}
      {hasResult && sourceMode === 'array' && (
        <div className="flex items-center justify-between">
          <Label>Join rows mode</Label>
          <button
            onClick={() => {
              setJoinMode((v) => {
                if (!v) setTemplate('{value}');
                return !v;
              });
            }}
            className={cn(
              'relative w-8 h-4 rounded-full transition-colors flex-shrink-0',
              joinMode ? 'bg-accent-600' : 'bg-border',
            )}
          >
            <span className={cn(
              'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
              joinMode ? 'translate-x-4' : 'translate-x-0.5',
            )} />
          </button>
        </div>
      )}

      {/* ── Join rows inputs — show whenever join mode ON (no arrayCols required) ── */}
      {hasResult && sourceMode === 'array' && joinMode && (
        <div className="space-y-2 bg-bg-subtle border border-border rounded-md p-2">
          <div>
            <Label>Row template</Label>
            <PanelInput
              placeholder="{name} ({energyKwh|round} kWh)"
              value={joinRowTemplate}
              onChange={(e) => setJoinRowTemplate(e.target.value)}
            />
            <p className="text-[9px] text-text-muted mt-1 leading-relaxed">
              Use <code className="bg-bg px-0.5 rounded">&#123;field&#125;</code> or{' '}
              <code className="bg-bg px-0.5 rounded">&#123;field|round&#125;</code> to round numbers.
              {arrayCols.length > 0 && ' Available fields:'}
            </p>
            {arrayCols.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {arrayCols.map((col) => (
                  <button
                    key={col.key}
                    onClick={() => {
                      const token = col.type === 'number' ? `{${col.key}|round}` : `{${col.key}}`;
                      setJoinRowTemplate((t) => `${t}${token}`);
                    }}
                    className="px-1.5 py-0.5 rounded-full border border-border bg-bg text-[9px] font-mono hover:border-accent-500 hover:text-accent-600 transition-colors"
                  >
                    {col.key}{col.type === 'number' ? ' #' : ''}
                  </button>
                ))}
              </div>
            )}
            {arrayCols.length === 0 && effectivePath && (
              <p className="text-[9px] text-amber-600 mt-1">
                Type field names manually e.g. <code className="bg-bg px-0.5 rounded">&#123;name&#125;</code>
              </p>
            )}
          </div>
          <div>
            <Label>Separator</Label>
            <PanelInput
              placeholder=", "
              value={joinSeparator}
              onChange={(e) => setJoinSeparator(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* ── Aggregation rows ──────────────────────────────────────────────────── */}
      {hasResult && sourceMode === 'array' && !joinMode && (
        <div className="space-y-2">
          <Label>Aggregation</Label>

          {aggDefs.map((def, idx) => (
            <div key={idx} className="space-y-1.5">

              {/* Field selector row — dropdown if cols known, manual input otherwise */}
              <div className="flex items-center gap-1">
                {arrayCols.length > 0 ? (
                  <select
                    value={def.fieldKey}
                    onChange={(e) => updateAggDef(idx, { fieldKey: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                  >
                    <option value="">— pick field —</option>
                    {arrayCols.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.key}{c.type === 'number' ? ' (#)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="field name e.g. energyKwh"
                    value={def.fieldKey}
                    onChange={(e) => updateAggDef(idx, { fieldKey: e.target.value })}
                    className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
                  />
                )}

                {/* Remove button (not for the very first row) */}
                {idx > 0 && (
                  <button
                    onClick={() => removeAggDef(idx)}
                    title="Remove this row"
                    className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex-shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Aggregation type buttons */}
              <div className="grid grid-cols-3 gap-1">
                {(['count', 'sum', 'avg', 'min', 'max', 'first'] as Aggregation[]).map((agg) => (
                  <button
                    key={agg}
                    onClick={() => updateAggDef(idx, { aggregation: agg })}
                    className={cn(
                      'py-1 text-[10px] rounded-md border transition-colors font-semibold',
                      def.aggregation === agg
                        ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                        : 'border-border text-text-muted hover:text-text',
                    )}
                  >
                    {agg.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Divider between rows */}
              {idx < aggDefs.length - 1 && (
                <div className="border-t border-border/60 pt-1" />
              )}
            </div>
          ))}

          {/* Add aggregation row */}
          <button
            onClick={addAggDef}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add aggregation
          </button>
        </div>
      )}

      {/* ── Field Token chips ─────────────────────────────────────────────────── */}
      {hasResult && sourceMode === 'array' && !joinMode && arrayCols.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Tag className="w-3 h-3 text-text-muted" />
            <Label>Insert Field into Template</Label>
          </div>
          <p className="text-[9px] text-text-muted mb-1.5 leading-relaxed">
            Click a field name to insert <code className="bg-bg-subtle px-0.5 rounded">&#123;fieldName&#125;</code> into
            the template — it will be replaced by the first row&apos;s value.
          </p>
          <div className="flex flex-wrap gap-1">
            {arrayCols.map((col) => {
              const preview = firstRow ? getNestedValue(firstRow, col.key) : undefined;
              return (
                <button
                  key={col.key}
                  onClick={() => setTemplate((t) => `${t}{${col.key}}`)}
                  title={preview !== undefined ? `First value: ${String(preview)}` : col.key}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] transition-colors',
                    'border-border bg-bg-subtle hover:border-accent-500 hover:bg-accent-50',
                    'dark:hover:bg-accent-950/30 hover:text-accent-600',
                  )}
                >
                  <span className="font-mono font-semibold">{col.key}</span>
                  {preview !== undefined && (
                    <span className="opacity-50 truncate max-w-[48px] text-[9px]">
                      = {String(preview)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Template */}
      {hasResult && previewValues !== null && (
        <div>
          <Label>Template</Label>
          {joinMode ? (
            /* Join mode: template is always {value} — show locked badge */
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-950/30">
              <code className="text-[11px] font-mono font-semibold text-accent-700 dark:text-accent-400">
                {'{value}'}
              </code>
              <span className="text-[9px] text-accent-600 dark:text-accent-400 ml-auto">auto (join mode)</span>
            </div>
          ) : (
            <>
              <PanelInput
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="{value}"
              />
              <p className="text-[9px] text-text-muted mt-0.5 leading-relaxed">
                {aggDefs.filter(d => d.fieldKey).length > 1
                  ? <>
                      Aggregations: <code className="bg-bg-subtle px-0.5 rounded">{'{value}'}</code>{' '}
                      <code className="bg-bg-subtle px-0.5 rounded">{'{value0}'}</code>{' '}
                      <code className="bg-bg-subtle px-0.5 rounded">{'{value1}'}</code> …
                      &nbsp;·&nbsp; Fields: <code className="bg-bg-subtle px-0.5 rounded">{'{name}'}</code>{' '}
                      <code className="bg-bg-subtle px-0.5 rounded">{'{id}'}</code> …
                    </>
                  : <>
                      Use <code className="bg-bg-subtle px-0.5 rounded">{'{value}'}</code> for aggregated result,
                      or <code className="bg-bg-subtle px-0.5 rounded">{'{fieldName}'}</code> for a direct field value
                    </>
                }
              </p>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      {previewText !== null && (
        <div className="flex items-center gap-2 bg-bg-subtle border border-border rounded-md px-2 py-2">
          <Type className="w-3 h-3 text-text-muted flex-shrink-0" />
          <span className="text-xs text-text font-medium break-all">{previewText}</span>
        </div>
      )}

      {/* Apply to Text (uses template) */}
      {hasResult && (
        <button onClick={handleApply} disabled={!canApply}
          className={cn(
            'w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
            'bg-bg-card border border-border hover:border-accent-400 hover:text-accent-600',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}>
          <Type className="w-3.5 h-3.5" /> Apply to Text
        </button>
      )}

      {/* Empty state */}
      {!hasResult && !fetchDs.isPending && !fetchDs.isError && (
        <div className="flex flex-col items-center gap-1.5 py-4 text-text-muted">
          <Wifi className="w-6 h-6 opacity-20" />
          <p className="text-[10px] text-center opacity-60 leading-relaxed">
            Enter an API URL and click<br />Fetch Data to pull live text
          </p>
        </div>
      )}
    </div>

    {showJoinModal && result && (
      <JoinRowModal
        data={result.data}
        detected={detected}
        initial={{
          path: selectedPath,
          joinMode,
          joinRowTemplate,
          joinSeparator,
          aggDefs,
        }}
        onApply={(cfg) => {
          setSelectedPath(cfg.path);
          setJoinMode(cfg.joinMode);
          setJoinRowTemplate(cfg.joinRowTemplate);
          setJoinSeparator(cfg.joinSeparator);
          if (cfg.aggDefs.length) setAggDefs(cfg.aggDefs);
          setShowJoinModal(false);
        }}
        onClose={() => setShowJoinModal(false)}
      />
    )}
    </>
  );
}
