'use client';
import { useEffect, useState } from 'react';
import {
  useFetchDatasource,
  extractArrayAtPath,
  type DetectedArray,
} from '@/hooks/use-report-datasource';
import { cn } from '@/lib/utils';
import {
  BarChart2, Braces, ChevronsUpDown,
  ChevronDown, ChevronRight, Database, Eye, Filter, KeyRound, Loader2, Maximize2,
  Plus, RefreshCw, Search, Table2, Trash2, Wifi, X,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RowFilter = {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
};

export type StoredDatasource = {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  dataPath?: string;
  columnDefs: { key: string; label: string; prefix?: string; suffix?: string }[];
  rowFilters?: RowFilter[];
};

type ColDef    = { key: string; label: string; selected: boolean; prefix?: string; suffix?: string };
type HeaderRow = { key: string; value: string };

interface Props {
  props: Record<string, unknown>;
  onApply: (patch: Record<string, unknown>) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Traverse a (possibly nested) object using a dot-notation path.
 * e.g. getNestedValue(row, "address.city") → "Gwenborough"
 *      getNestedValue(row, "company.name")  → "Romaguera-Crona"
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function applyRowFilters(rows: Record<string, unknown>[], filters: RowFilter[]): Record<string, unknown>[] {
  const active = filters.filter((f) => f.field && f.value !== '');
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every(({ field, op, value }) => {
      const rv = String(getNestedValue(row, field) ?? '');
      switch (op) {
        case 'eq':         return rv === value;
        case 'neq':        return rv !== value;
        case 'contains':   return rv.toLowerCase().includes(value.toLowerCase());
        case 'startsWith': return rv.toLowerCase().startsWith(value.toLowerCase());
        case 'endsWith':   return rv.toLowerCase().endsWith(value.toLowerCase());
        case 'gt':  { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) > n; }
        case 'lt':  { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) < n; }
        case 'gte': { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) >= n; }
        case 'lte': { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) <= n; }
        default: return true;
      }
    }),
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
    <input {...props} className={cn(
      'w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input',
      'focus:outline-none focus:border-accent-400 transition-colors', props.className,
    )} />
  );
}

function MiniPreview({ rows, columns, highlight }: {
  rows: Record<string, unknown>[];
  columns: string[];
  highlight: string[];
}) {
  if (!rows.length || !columns.length) return null;
  const preview = rows.slice(0, 5);
  const cols    = columns.slice(0, 6);
  return (
    <div>
      <Label>Preview ({preview.length} of {rows.length} rows)</Label>
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col} className={cn(
                  'px-2 py-1 text-left font-semibold border-b border-border whitespace-nowrap',
                  highlight.includes(col)
                    ? 'bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                    : 'bg-bg-subtle text-text-muted',
                )}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-bg-subtle/50' : ''}>
                {cols.map((col) => {
                  const v = getNestedValue(row, col);
                  const display = v == null
                    ? ''
                    : typeof v === 'object'
                      ? JSON.stringify(v)
                      : String(v);
                  return (
                    <td key={col} title={display}
                      className={cn(
                        'px-2 py-1 border-b border-border/50 truncate max-w-[80px]',
                        highlight.includes(col)
                          ? 'text-accent-700 dark:text-accent-400 font-medium'
                          : 'text-text-muted',
                      )}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DataSourcePanel({ props, onApply }: Props) {
  const stored = props.dataSource as StoredDatasource | undefined;

  const [url, setUrl]         = useState(stored?.url ?? '');
  const [method, setMethod]   = useState<'GET' | 'POST'>(stored?.method ?? 'GET');
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.entries(stored?.headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [rowFilters, setRowFilters] = useState<RowFilter[]>(stored?.rowFilters ?? []);
  const [showFilters, setShowFilters] = useState((stored?.rowFilters ?? []).length > 0);
  const [bearerToken, setBearerToken] = useState('');
  const [showAuth,    setShowAuth]    = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showJson,    setShowJson]    = useState(false);
  const [showJsonFs,  setShowJsonFs]  = useState(false);
  const [viewingCol,  setViewingCol]  = useState<string | null>(null);
  // Fullscreen viewer state
  const [fsView,    setFsView]    = useState<'json' | 'table' | 'chart'>('json');
  const [fsSearch,  setFsSearch]  = useState('');
  const [fsSortKey, setFsSortKey] = useState<string | null>(null);
  const [fsSortDir, setFsSortDir] = useState<'asc' | 'desc'>('asc');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [chartXKey, setChartXKey] = useState('');
  const [chartYKey, setChartYKey] = useState('');
  const [selectedPath, setSelectedPath] = useState(stored?.dataPath ?? '');
  const [colDefs, setColDefs] = useState<ColDef[]>(
    (stored?.columnDefs ?? []).map((c) => ({ ...c, selected: true, prefix: c.prefix ?? '', suffix: c.suffix ?? '' })),
  );

  const fetchDs  = useFetchDatasource();
  const result   = fetchDs.data;

  // Auto-fetch on mount when stored URL exists
  useEffect(() => {
    if (!stored?.url || fetchDs.data || fetchDs.isPending) return;
    fetchDs.mutate({
      url: stored.url,
      method: stored.method ?? 'GET',
      headers: stored.headers ?? {},
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close fullscreen JSON modal on Escape
  useEffect(() => {
    if (!showJsonFs) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowJsonFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showJsonFs]);

  // Close column-value viewer on Escape
  useEffect(() => {
    if (!viewingCol) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewingCol(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewingCol]);
  const detected: DetectedArray[] = result?.detected ?? [];

  // ── Helpers ─────────────────────────────────────────────────────────────────

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
        if (res.detected.length > 0) {
          const first = res.detected[0];
          setSelectedPath(first.path);
          setColDefs(first.columns.map((c) => ({ key: c.key, label: c.key, selected: true, prefix: '', suffix: '' })));
        }
        setShowJson(true);
      },
    });
  };

  const handlePathChange = (path: string) => {
    setSelectedPath(path);
    const arr = detected.find((d) => d.path === path);
    if (arr) setColDefs(arr.columns.map((c) => ({ key: c.key, label: c.key, selected: true, prefix: '', suffix: '' })));
  };

  const toggleCol    = (key: string) => setColDefs((p) => p.map((c) => c.key === key ? { ...c, selected: !c.selected } : c));
  const setColLabel  = (key: string, label: string) => setColDefs((p) => p.map((c) => c.key === key ? { ...c, label } : c));
  const setColPrefix = (key: string, prefix: string) => setColDefs((p) => p.map((c) => c.key === key ? { ...c, prefix } : c));
  const setColSuffix = (key: string, suffix: string) => setColDefs((p) => p.map((c) => c.key === key ? { ...c, suffix } : c));

  const liveRows         = result ? extractArrayAtPath(result.data, selectedPath) : [];
  const filteredLiveRows = applyRowFilters(liveRows, rowFilters.filter((f) => f.field));

  // ── Fullscreen viewer derived data ────────────────────────────────────────
  const FS_PALETTE = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6'];

  // Detect which columns contain numeric values (sample first 5 rows)
  const numericColKeys = new Set(
    colDefs
      .filter((c) => liveRows.slice(0, 5).some((r) => {
        const v = getNestedValue(r, c.key);
        return v !== null && v !== undefined && !isNaN(Number(v)) && String(v).trim() !== '';
      }))
      .map((c) => c.key),
  );

  // Effective X/Y keys — fall back to first string/numeric column
  const fsXKey = chartXKey || colDefs.find((c) => !numericColKeys.has(c.key))?.key || colDefs[0]?.key || '';
  const fsYKey = chartYKey || [...numericColKeys][0] || colDefs[0]?.key || '';

  // Table: filter rows by search
  const fsFilteredRows = fsSearch.trim()
    ? liveRows.filter((row) =>
        colDefs.some((c) => {
          const v = getNestedValue(row, c.key);
          return String(v ?? '').toLowerCase().includes(fsSearch.toLowerCase());
        }),
      )
    : liveRows;

  // Table: sort
  const fsSortedRows = fsSortKey
    ? [...fsFilteredRows].sort((a, b) => {
        const av = String(getNestedValue(a, fsSortKey) ?? '');
        const bv = String(getNestedValue(b, fsSortKey) ?? '');
        const numA = Number(av), numB = Number(bv);
        const cmp = !isNaN(numA) && !isNaN(numB) ? numA - numB : av.localeCompare(bv);
        return fsSortDir === 'asc' ? cmp : -cmp;
      })
    : fsFilteredRows;

  // Chart data
  const fsChartData = liveRows.slice(0, 50).map((row) => ({
    name: String(getNestedValue(row, fsXKey) ?? ''),
    value: Number(getNestedValue(row, fsYKey) ?? 0),
  }));

  const handleApply = () => {
    const active = colDefs.filter((c) => c.selected);
    const activeFilters = rowFilters.filter((f) => f.field);
    onApply({
      ...props,
      columns: active.map((c) => c.label),
      rows: filteredLiveRows.slice(0, 500).map((row) => {
        const mapped: Record<string, string> = {};
        active.forEach(({ key, label, prefix, suffix }) => {
          const v = getNestedValue(row, key);
          const raw = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          mapped[label] = `${prefix ?? ''}${raw}${suffix ?? ''}`;
        });
        return mapped;
      }),
      dataSource: {
        url: url.trim(), method, headers: headersMap(), dataPath: selectedPath,
        columnDefs: active.map(({ key, label, prefix, suffix }) => ({ key, label, prefix, suffix })),
        rowFilters: activeFilters,
      } satisfies StoredDatasource,
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const hasResult  = !!result;
  const canApply   = hasResult && colDefs.some((c) => c.selected);
  const jsonPreview = hasResult ? JSON.stringify(result.data, null, 2).slice(0, 4000) : '';
  const selectedCols = colDefs.filter((c) => c.selected).map((c) => c.key);

  return (
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
          <PanelInput type="url" placeholder="https://api.example.com/users"
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
            <p className="text-[9px] text-text-muted mt-0.5">Sent as Authorization: Bearer …</p>
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
          {/* Row: toggle label + fullscreen button */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowJson((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider hover:text-text transition-colors"
            >
              {showJson ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              JSON Response
            </button>
            <button
              onClick={() => setShowJsonFs(true)}
              title="View full screen"
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors px-1 py-0.5 rounded hover:bg-bg-hover"
            >
              <Maximize2 className="w-3 h-3" />
              <span className="hidden sm:inline">Full screen</span>
            </button>
          </div>

          {/* Inline collapsed preview */}
          {showJson && (
            <pre className="mt-1.5 text-[10px] bg-bg-subtle border border-border rounded-md p-2 overflow-auto max-h-28 whitespace-pre-wrap break-all leading-relaxed">
              {jsonPreview}{jsonPreview.length >= 4000 && '\n… (truncated)'}
            </pre>
          )}
        </div>
      )}

      {/* ── Full-screen data viewer (JSON · Table · Chart) ───────────────── */}
      {showJsonFs && hasResult && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-bg-card animate-fade-in">

          {/* ── Top bar ── */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-card flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Database className="w-4 h-4 text-accent-600 flex-shrink-0" />
              <span className="text-sm font-semibold">JSON Response</span>
              {url && (
                <span className="text-[11px] text-text-muted truncate max-w-xs hidden sm:block">
                  — {url}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowJsonFs(false)}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex items-center border-b border-border bg-bg-subtle flex-shrink-0 px-3 gap-1">
            {(
              [
                { id: 'json'  as const, icon: <Braces    className="w-3.5 h-3.5" />, label: 'JSON'  },
                { id: 'table' as const, icon: <Table2     className="w-3.5 h-3.5" />, label: 'Table' },
                { id: 'chart' as const, icon: <BarChart2  className="w-3.5 h-3.5" />, label: 'Chart' },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFsView(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                  fsView === tab.id
                    ? 'border-accent-600 text-accent-600'
                    : 'border-transparent text-text-muted hover:text-text',
                )}
              >
                {tab.icon}{tab.label}
              </button>
            ))}

            {/* Search — only for Table */}
            {fsView === 'table' && (
              <div className="ml-auto flex items-center gap-1.5 py-1">
                <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Search rows…"
                  value={fsSearch}
                  onChange={(e) => setFsSearch(e.target.value)}
                  className="text-xs bg-bg-input border border-border rounded-md px-2 py-1 focus:outline-none focus:border-accent-400 w-44"
                />
              </div>
            )}
          </div>

          {/* ── Content (fills remaining height, each view manages its own scroll) ── */}
          <div className="flex-1 min-h-0 relative">

            {/* ─ JSON ─ */}
            {fsView === 'json' && (
              <div className="absolute inset-0 overflow-auto p-4" style={{ fontFamily: 'ui-monospace, monospace' }}>
                <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-all text-text">
                  {JSON.stringify(result?.data, null, 2)}
                </pre>
              </div>
            )}

            {/* ─ Table ─ */}
            {fsView === 'table' && (
              <div className="absolute inset-0 overflow-auto">
                <table className="w-full border-collapse text-[12px]" style={{ minWidth: `${colDefs.length * 140}px` }}>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left bg-bg-subtle border-b border-border text-text-muted font-semibold w-10 whitespace-nowrap">
                        #
                      </th>
                      {colDefs.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => {
                            if (fsSortKey === col.key) {
                              setFsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            } else {
                              setFsSortKey(col.key);
                              setFsSortDir('asc');
                            }
                          }}
                          className="px-3 py-2 text-left bg-bg-subtle border-b border-border text-text-muted font-semibold whitespace-nowrap cursor-pointer select-none hover:text-accent-600 hover:bg-bg-hover transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span className="truncate max-w-[140px]" title={col.key}>{col.key}</span>
                            {fsSortKey === col.key
                              ? <span className="text-accent-600 text-[10px]">{fsSortDir === 'asc' ? '↑' : '↓'}</span>
                              : <ChevronsUpDown className="w-3 h-3 opacity-30 flex-shrink-0" />
                            }
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fsSortedRows.length === 0 ? (
                      <tr>
                        <td colSpan={colDefs.length + 1} className="text-center py-16 text-text-muted text-sm">
                          {fsSearch ? `No rows match "${fsSearch}"` : 'No data'}
                        </td>
                      </tr>
                    ) : (
                      fsSortedRows.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-bg-card' : 'bg-bg-subtle/40'}>
                          <td className="px-3 py-1.5 text-text-muted border-b border-border/50 tabular-nums">{i + 1}</td>
                          {colDefs.map((col) => {
                            const raw = getNestedValue(row, col.key);
                            const val = raw == null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
                            return (
                              <td
                                key={col.key}
                                title={val}
                                className="px-3 py-1.5 border-b border-border/50 truncate max-w-[180px] text-text"
                              >
                                {val || <span className="text-text-muted opacity-40">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ─ Chart ─ */}
            {fsView === 'chart' && (
              <div className="absolute inset-0 flex flex-col">
                {/* Chart controls */}
                <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 border-b border-border bg-bg-subtle flex-shrink-0 text-xs">
                  {/* Type selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted font-medium">Type</span>
                    <div className="flex border border-border rounded-md overflow-hidden">
                      {(['bar', 'line', 'pie'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setChartType(t)}
                          className={cn(
                            'px-3 py-1 font-medium capitalize transition-colors',
                            chartType === t
                              ? 'bg-accent-600 text-white'
                              : 'bg-bg-card text-text-muted hover:bg-bg-hover',
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* X axis / Label key */}
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted font-medium">{chartType === 'pie' ? 'Label' : 'X axis'}</span>
                    <select
                      value={fsXKey}
                      onChange={(e) => setChartXKey(e.target.value)}
                      className="text-xs bg-bg-input border border-border rounded-md px-2 py-1 focus:outline-none focus:border-accent-400 max-w-[160px]"
                    >
                      {colDefs.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
                    </select>
                  </div>

                  {/* Y axis / Value key */}
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted font-medium">{chartType === 'pie' ? 'Value' : 'Y axis'}</span>
                    <select
                      value={fsYKey}
                      onChange={(e) => setChartYKey(e.target.value)}
                      className="text-xs bg-bg-input border border-border rounded-md px-2 py-1 focus:outline-none focus:border-accent-400 max-w-[160px]"
                    >
                      {colDefs.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
                    </select>
                  </div>

                  {/* Numeric column hint */}
                  {numericColKeys.size === 0 && (
                    <span className="text-amber-600 dark:text-amber-400 text-[11px]">
                      ⚠ No numeric columns detected — select a column with numbers for Y axis
                    </span>
                  )}
                </div>

                {/* Chart canvas */}
                <div className="flex-1 min-h-0 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    {chartType === 'bar' ? (
                      <BarChart data={fsChartData} margin={{ top: 8, right: 24, bottom: 72, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {fsChartData.map((_, idx) => (
                            <Cell key={idx} fill={FS_PALETTE[idx % FS_PALETTE.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    ) : chartType === 'line' ? (
                      <LineChart data={fsChartData} margin={{ top: 8, right: 24, bottom: 72, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="value" stroke={FS_PALETTE[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    ) : (
                      <PieChart>
                        <Pie
                          data={fsChartData.slice(0, 20)}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius="65%"
                          label={({ name, percent }: { name?: string; percent?: number }) =>
                            `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)`
                          }
                        >
                          {fsChartData.slice(0, 20).map((_, idx) => (
                            <Cell key={idx} fill={FS_PALETTE[idx % FS_PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex-shrink-0 px-4 py-2 border-t border-border bg-bg-subtle flex items-center justify-between">
            <p className="text-[10px] text-text-muted">
              {liveRows.length} rows · {colDefs.length} col{colDefs.length !== 1 ? 's' : ''}
              {fsView === 'table' && fsSearch && ` · ${fsSortedRows.length} match${fsSortedRows.length !== 1 ? 'es' : ''}`}
              {fsView === 'chart' && ` · ${Math.min(fsChartData.length, chartType === 'pie' ? 20 : 50)} plotted`}
            </p>
            <p className="text-[10px] text-text-muted">
              <kbd className="px-1 py-0.5 bg-bg-card border border-border rounded text-[10px]">Esc</kbd> to close
            </p>
          </div>
        </div>
      )}

      {/* Path selector */}
      {detected.length > 1 && (
        <div>
          <Label>Data path</Label>
          <select value={selectedPath} onChange={(e) => handlePathChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
            {detected.map((d) => (
              <option key={d.path} value={d.path}>{d.path || '(root)'} — {d.count} rows</option>
            ))}
          </select>
        </div>
      )}

      {/* Row Filters */}
      {colDefs.length > 0 && (
        <div>
          <button onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider hover:text-text transition-colors">
            {showFilters ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Filter className="w-3 h-3" />
            Row Filters
            {rowFilters.filter((f) => f.field).length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-400 text-[9px] font-bold">
                {rowFilters.filter((f) => f.field).length}
              </span>
            )}
          </button>
          {showFilters && (
            <div className="mt-1.5 space-y-2">
              {rowFilters.map((f, i) => (
                <div key={i} className="rounded-md border border-border bg-bg-subtle p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-semibold text-text-muted uppercase tracking-wider">Rule {i + 1}</span>
                    <button onClick={() => setRowFilters((p) => p.filter((_, j) => j !== i))}
                      className="text-text-muted hover:text-red-500 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <select value={f.field}
                    onChange={(e) => setRowFilters((p) => p.map((r, j) => j === i ? { ...r, field: e.target.value } : r))}
                    className="w-full px-2 py-1.5 text-[10px] rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400">
                    <option value="">— select field —</option>
                    {colDefs.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
                  </select>
                  <div className="flex gap-1">
                    <select value={f.op}
                      onChange={(e) => setRowFilters((p) => p.map((r, j) => j === i ? { ...r, op: e.target.value as RowFilter['op'] } : r))}
                      className="flex-1 px-1.5 py-1.5 text-[10px] rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400">
                      <option value="eq">= equals</option>
                      <option value="neq">≠ not equal</option>
                      <option value="contains">contains</option>
                      <option value="startsWith">starts with</option>
                      <option value="endsWith">ends with</option>
                      <option value="gt">&gt; greater</option>
                      <option value="lt">&lt; less</option>
                      <option value="gte">≥ ≥</option>
                      <option value="lte">≤ ≤</option>
                    </select>
                    <input type="text" placeholder="value…" value={f.value}
                      onChange={(e) => setRowFilters((p) => p.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                      className="flex-1 px-2 py-1.5 text-[10px] rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400" />
                  </div>
                </div>
              ))}
              <button onClick={() => setRowFilters((p) => [...p, { field: colDefs[0]?.key ?? '', op: 'eq', value: '' }])}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-600 transition-colors w-full justify-center py-1 border border-dashed border-border rounded-md hover:border-accent-400">
                <Plus className="w-3 h-3" /> Add filter
              </button>
              {filteredLiveRows.length !== liveRows.length && (
                <p className="text-[10px] text-accent-600 dark:text-accent-400 font-medium text-center">
                  {filteredLiveRows.length} / {liveRows.length} rows match
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mini preview */}
      {hasResult && filteredLiveRows.length > 0 && (
        <MiniPreview
          rows={filteredLiveRows}
          columns={colDefs.map((c) => c.key)}
          highlight={selectedCols}
        />
      )}

      {/* Column picker */}
      {colDefs.length > 0 && (
        <div>
          <Label>Columns</Label>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
            {colDefs.map((col) => (
              <div
                key={col.key}
                className={cn(
                  'rounded-lg border transition-colors',
                  col.selected
                    ? 'border-accent-200 dark:border-accent-800 bg-accent-50/50 dark:bg-accent-950/20'
                    : 'border-border bg-bg-subtle opacity-50',
                )}
              >
                {/* Row 1: checkbox + key badge + label + eye */}
                <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                  <input
                    type="checkbox"
                    checked={col.selected}
                    onChange={() => toggleCol(col.key)}
                    className="w-3 h-3 accent-accent-600 flex-shrink-0"
                  />
                  <span
                    className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-bg-card border border-border text-text-muted truncate max-w-[64px] flex-shrink-0"
                    title={col.key}
                  >
                    {col.key}
                  </span>
                  <input
                    type="text"
                    placeholder="Header label"
                    value={col.label}
                    disabled={!col.selected}
                    onChange={(e) => setColLabel(col.key, e.target.value)}
                    className={cn(
                      'flex-1 min-w-0 px-2 py-1 text-[11px] rounded-md border border-border bg-bg-input',
                      'focus:outline-none focus:border-accent-400 transition-colors',
                    )}
                  />
                  <button
                    onClick={() => setViewingCol(col.key)}
                    title={`Preview "${col.key}"`}
                    className="flex-shrink-0 p-1 rounded text-text-muted hover:text-accent-600 hover:bg-bg-hover transition-colors"
                  >
                    <Eye className="w-3 h-3" />
                  </button>
                </div>

                {/* Row 2: prefix · value · suffix — only when selected */}
                {col.selected && (
                  <div className="flex items-center gap-1 px-2 pb-1.5">
                    <input
                      type="text"
                      placeholder="Prefix"
                      value={col.prefix ?? ''}
                      onChange={(e) => setColPrefix(col.key, e.target.value)}
                      className={cn(
                        'w-14 px-1.5 py-0.5 text-[10px] rounded border border-dashed border-border bg-bg-input',
                        'focus:outline-none focus:border-accent-400 transition-colors placeholder:text-text-muted/50',
                      )}
                    />
                    <div className="flex-1 flex items-center justify-center gap-1">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[9px] text-text-muted font-medium px-1">value</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <input
                      type="text"
                      placeholder="Suffix"
                      value={col.suffix ?? ''}
                      onChange={(e) => setColSuffix(col.key, e.target.value)}
                      className={cn(
                        'w-14 px-1.5 py-0.5 text-[10px] rounded border border-dashed border-border bg-bg-input',
                        'focus:outline-none focus:border-accent-400 transition-colors placeholder:text-text-muted/50',
                      )}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Column value viewer modal ──────────────────────────────────────── */}
      {viewingCol && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setViewingCol(null); }}
        >
          <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-modal-in max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Eye className="w-4 h-4 text-accent-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate" title={viewingCol}>{viewingCol}</p>
                  <p className="text-[10px] text-text-muted">{liveRows.length} rows</p>
                </div>
              </div>
              <button
                onClick={() => setViewingCol(null)}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors flex-shrink-0"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Values list */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-semibold text-text-muted bg-bg-subtle border-b border-border w-10">#</th>
                    <th className="px-3 py-1.5 text-left font-semibold text-text-muted bg-bg-subtle border-b border-border">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.map((row, i) => {
                    const raw = getNestedValue(row, viewingCol);
                    const val = raw == null
                      ? ''
                      : typeof raw === 'object'
                        ? JSON.stringify(raw)
                        : String(raw);
                    const isEmpty = val === '';
                    return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-bg-card' : 'bg-bg-subtle/50'}>
                        <td className="px-3 py-1.5 text-text-muted border-b border-border/50 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-1.5 border-b border-border/50 break-all">
                          {isEmpty
                            ? <span className="text-text-muted italic opacity-50">—</span>
                            : <span className="text-text">{val}</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer: unique count */}
            <div className="flex-shrink-0 px-4 py-2 border-t border-border bg-bg-subtle flex items-center justify-between">
              <p className="text-[10px] text-text-muted">
                {(() => {
                  const unique = new Set(
                    liveRows.map((r) => {
                      const v = getNestedValue(r, viewingCol);
                      return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                    }),
                  ).size;
                  return `${unique} unique value${unique !== 1 ? 's' : ''}`;
                })()}
              </p>
              <p className="text-[10px] text-text-muted">
                <kbd className="px-1 py-0.5 bg-bg-card border border-border rounded text-[10px]">Esc</kbd> to close
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Apply */}
      {colDefs.length > 0 && (
        <button onClick={handleApply} disabled={!canApply}
          className={cn(
            'w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
            'bg-bg-card border border-border hover:border-accent-400 hover:text-accent-600',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}>
          <Database className="w-3.5 h-3.5" /> Apply to Table
        </button>
      )}

      {/* Empty state */}
      {!hasResult && !fetchDs.isPending && !fetchDs.isError && (
        <div className="flex flex-col items-center gap-1.5 py-4 text-text-muted">
          <Database className="w-6 h-6 opacity-20" />
          <p className="text-[10px] text-center opacity-60 leading-relaxed">
            Enter an API URL above and click<br />Fetch Data to load columns
          </p>
        </div>
      )}
    </div>
  );
}
