'use client';
import { useEffect, useState } from 'react';
import {
  useFetchDatasource,
  extractArrayAtPath,
  type DetectedArray,
} from '@/hooks/use-report-datasource';
import { formatKpiValue, applyAggregation, type NumberFormat, type Aggregation } from '@/lib/kpi-format';
import { cn } from '@/lib/utils';
import {
  ChevronDown, ChevronRight, Hash, KeyRound, Layers, Loader2, Plus, RefreshCw, Trash2, Wifi,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WidgetMode = 'kpi' | 'series';

export type WidgetSourceMode = 'array' | 'direct';

export type StoredWidgetDatasource = {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  dataPath?: string;
  sourceMode?: WidgetSourceMode;
  directPath?: string;
  widgetMode: WidgetMode;
  valueKey: string;
  nameKey?: string;
  aggregation?: Aggregation;
  numberFormat?: NumberFormat;
  currencySymbol?: string;
};

type HeaderRow = { key: string; value: string };

interface Props {
  props: Record<string, unknown>;
  onApply: (patch: Record<string, unknown>) => void;
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

function FieldSelect({
  label, value, columns, preferNumeric, optional, onChange,
}: {
  label: string; value: string;
  columns: { key: string; type: string }[];
  preferNumeric?: boolean; optional?: boolean;
  onChange: (v: string) => void;
}) {
  const sorted = preferNumeric
    ? [...columns.filter((c) => c.type === 'number'), ...columns.filter((c) => c.type !== 'number')]
    : columns;
  return (
    <div>
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
        {(optional || !value) && <option value="">— pick field —</option>}
        {sorted.map((c) => (
          <option key={c.key} value={c.key}>{c.key}{c.type === 'number' ? ' (#)' : ''}</option>
        ))}
      </select>
    </div>
  );
}

function MiniPreview({ rows, columns, highlight }: {
  rows: Record<string, unknown>[];
  columns: string[];
  highlight: string[];
}) {
  if (!rows.length || !columns.length) return null;
  const preview = rows.slice(0, 5);
  const cols = columns.slice(0, 6);
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
                {cols.map((col) => (
                  <td key={col} className={cn(
                    'px-2 py-1 border-b border-border/50 truncate max-w-[80px]',
                    highlight.includes(col)
                      ? 'text-accent-700 dark:text-accent-400 font-medium'
                      : 'text-text-muted',
                  )} title={String(row[col] ?? '')}>
                    {String(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WidgetDataSourcePanel({ props, onApply }: Props) {
  const stored = props.dataSource as StoredWidgetDatasource | undefined;

  const [url, setUrl]         = useState(stored?.url ?? '');
  const [method, setMethod]   = useState<'GET' | 'POST'>(stored?.method ?? 'GET');
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.entries(stored?.headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [bearerToken, setBearerToken] = useState('');
  const [showAuth,    setShowAuth]    = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showJson,    setShowJson]    = useState(false);
  const [selectedPath, setSelectedPath]   = useState(stored?.dataPath ?? '');
  const [sourceMode,   setSourceMode]     = useState<WidgetSourceMode>(stored?.sourceMode ?? 'array');
  const [directPath,   setDirectPath]     = useState(stored?.directPath ?? '');
  const [widgetMode,   setWidgetMode]     = useState<WidgetMode>(stored?.widgetMode ?? 'kpi');
  const [valueKey,     setValueKey]       = useState(stored?.valueKey ?? '');
  const [nameKey,      setNameKey]        = useState(stored?.nameKey ?? '');
  const [aggregation,  setAggregation]    = useState<Aggregation>(stored?.aggregation ?? 'first');
  const [numberFormat, setNumberFormat]   = useState<NumberFormat>(stored?.numberFormat ?? 'raw');
  const [currencySymbol, setCurrencySymbol] = useState(stored?.currencySymbol ?? '$');

  const fetchDs  = useFetchDatasource();
  const result   = fetchDs.data;
  const detected: DetectedArray[] = result?.detected ?? [];
  const activeArray = detected.find((d) => d.path === selectedPath) ?? detected[0];
  const cols        = activeArray?.columns ?? [];

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
          setSourceMode('array');
          const first = res.detected[0];
          setSelectedPath(first.path);
          const numCol = first.columns.find((c) => c.type === 'number');
          const strCol = first.columns.find((c) => c.type === 'string');
          if (numCol) setValueKey(numCol.key);
          if (strCol) setNameKey(strCol.key);
        } else {
          // Fallback to direct mode for scalar/nested responses
          setSourceMode('direct');
        }
        setShowJson(true);
      },
    });
  };

  const handlePathChange = (path: string) => {
    setSelectedPath(path);
    const arr = detected.find((d) => d.path === path);
    if (arr) {
      const numCol = arr.columns.find((c) => c.type === 'number');
      const strCol = arr.columns.find((c) => c.type === 'string');
      if (numCol) setValueKey(numCol.key);
      if (strCol) setNameKey(strCol.key);
    }
  };

  const liveRows = result ? extractArrayAtPath(result.data, selectedPath) : [];

  function getNestedDirect(data: unknown, path: string): unknown {
    if (!path) return undefined;
    const parts = path.split('.');
    let cur: unknown = data;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }

  // Flatten root object fields for direct path picker
  function flatRootFields(data: unknown): { key: string; value: unknown }[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const results: { key: string; value: unknown }[] = [];
    function walk(obj: Record<string, unknown>, prefix: string) {
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          walk(v as Record<string, unknown>, fullKey);
        } else if (typeof v === 'number' || typeof v === 'string') {
          results.push({ key: fullKey, value: v });
        }
      }
    }
    walk(data as Record<string, unknown>, '');
    return results.slice(0, 40);
  }

  const rootFields = result ? flatRootFields(result.data) : [];

  // Live preview of the computed KPI value
  const previewKpi = (() => {
    if (!result || widgetMode !== 'kpi') return null;
    if (sourceMode === 'direct') {
      if (!directPath) return null;
      const val = getNestedDirect(result.data, directPath);
      if (val == null) return null;
      return formatKpiValue(Number(val), numberFormat, currencySymbol);
    }
    if (!valueKey) return null;
    const raw = applyAggregation(liveRows, valueKey, aggregation);
    return formatKpiValue(raw, numberFormat, currencySymbol);
  })();

  const handleApply = () => {
    if (!result) return;
    if (sourceMode === 'direct' && !directPath) return;
    if (sourceMode === 'array' && !valueKey) return;
    const hm = headersMap();
    const ds: StoredWidgetDatasource = {
      url: url.trim(), method, headers: hm,
      sourceMode,
      ...(sourceMode === 'direct' ? { directPath } : { dataPath: selectedPath }),
      widgetMode, valueKey,
      ...(widgetMode === 'series' ? { nameKey } : {}),
      aggregation, numberFormat, currencySymbol,
    };

    if (widgetMode === 'kpi') {
      let kpiVal: string | number = '';
      if (sourceMode === 'direct') {
        const val = getNestedDirect(result.data, directPath);
        kpiVal = formatKpiValue(Number(val ?? 0), numberFormat, currencySymbol);
      } else {
        const raw = applyAggregation(liveRows, valueKey, aggregation);
        kpiVal = formatKpiValue(raw, numberFormat, currencySymbol);
      }
      onApply({
        ...props,
        dataSource: ds,
        kpiValue: kpiVal,
        kpiLabel: (props.title as string) ?? (sourceMode === 'direct' ? directPath : valueKey),
      });
    } else {
      const PALETTE = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899'];
      onApply({
        ...props,
        dataSource: ds,
        seriesData: liveRows.slice(0, 20).map((row, i) => ({
          name:  nameKey ? String(row[nameKey] ?? '') : String(i),
          value: Number(row[valueKey] ?? 0),
          color: PALETTE[i % PALETTE.length],
        })),
      });
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const hasResult = !!result;
  const canApply  = hasResult && (
    (sourceMode === 'direct' && !!directPath) ||
    (sourceMode === 'array'  && !!valueKey && (widgetMode === 'kpi' || !!nameKey))
  );
  const jsonPreview = hasResult ? JSON.stringify(result.data, null, 2).slice(0, 4000) : '';

  return (
    <div className="space-y-3 text-xs">
      {/* Active badge */}
      {stored?.url && (
        <div className="flex items-center gap-1.5 bg-accent-50 dark:bg-accent-950/30 border border-accent-200 dark:border-accent-800 rounded-md px-2 py-1.5">
          <Wifi className="w-3 h-3 text-accent-600 flex-shrink-0" />
          <span className="text-accent-700 dark:text-accent-400 truncate text-[10px]">Live: {stored.url}</span>
        </div>
      )}

      {/* Widget mode selector */}
      <div>
        <Label>Widget mode</Label>
        <div className="flex gap-1">
          {([
            { id: 'kpi'    as WidgetMode, label: 'KPI Card',    Icon: Hash },
            { id: 'series' as WidgetMode, label: 'Series Bars', Icon: Layers },
          ]).map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setWidgetMode(id)}
              className={cn(
                'flex-1 py-1.5 text-[10px] rounded-md border flex items-center justify-center gap-1 transition-colors font-semibold',
                widgetMode === id
                  ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                  : 'border-border text-text-muted hover:text-text',
              )}>
              <Icon className="w-3 h-3" />{label}
            </button>
          ))}
        </div>
      </div>

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

      {/* Bearer Token shortcut */}
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
          <button onClick={() => setShowJson((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider hover:text-text transition-colors">
            {showJson ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            JSON Response
          </button>
          {showJson && (
            <pre className="mt-1.5 text-[10px] bg-bg-subtle border border-border rounded-md p-2 overflow-auto max-h-28 whitespace-pre-wrap break-all leading-relaxed">
              {jsonPreview}{jsonPreview.length >= 4000 && '\n… (truncated)'}
            </pre>
          )}
        </div>
      )}

      {/* Source mode selector */}
      {hasResult && (rootFields.length > 0 || detected.length > 0) && (
        <div>
          <Label>Source type</Label>
          <div className="flex gap-1">
            {([
              { id: 'direct' as WidgetSourceMode, label: 'Direct field' },
              { id: 'array'  as WidgetSourceMode, label: 'Array + aggregate' },
            ]).map(({ id, label }) => (
              <button key={id} onClick={() => setSourceMode(id)}
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

      {/* Direct path picker */}
      {hasResult && sourceMode === 'direct' && rootFields.length > 0 && (
        <div>
          <Label>Pick field</Label>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {rootFields.map((f) => (
              <button key={f.key} onClick={() => setDirectPath(f.key)}
                className={cn(
                  'flex items-center justify-between px-2 py-1.5 rounded-md border text-[10px] transition-colors text-left',
                  directPath === f.key
                    ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                    : 'border-border text-text-muted hover:text-text',
                )}>
                <span className="font-mono font-semibold">{f.key}</span>
                <span className="opacity-70 ml-2 truncate max-w-[80px]">{String(f.value)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Path selector (array mode only) */}
      {hasResult && sourceMode === 'array' && detected.length > 1 && (
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

      {/* Field pickers (array mode only) */}
      {hasResult && sourceMode === 'array' && cols.length > 0 && (
        <>
          <FieldSelect label={widgetMode === 'kpi' ? 'Value field (number)' : 'Value field (Y axis)'}
            value={valueKey} columns={cols} preferNumeric onChange={setValueKey} />
          {widgetMode === 'series' && (
            <FieldSelect label="Name field (label)" value={nameKey} columns={cols} onChange={setNameKey} />
          )}
        </>
      )}

      {/* KPI — Aggregation + Number format */}
      {widgetMode === 'kpi' && sourceMode === 'array' && cols.length > 0 && (
        <>
          <div>
            <Label>Aggregation</Label>
            <div className="grid grid-cols-3 gap-1">
              {(['first','sum','count','avg','min','max'] as Aggregation[]).map((agg) => (
                <button key={agg} onClick={() => setAggregation(agg)}
                  className={cn(
                    'py-1 text-[10px] rounded-md border transition-colors font-semibold capitalize',
                    aggregation === agg
                      ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                      : 'border-border text-text-muted hover:text-text',
                  )}>
                  {agg.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Number format</Label>
            <select value={numberFormat} onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
              <option value="raw">Raw (1234567)</option>
              <option value="number">Number (1,234,567)</option>
              <option value="currency">Currency ($1,234.56)</option>
              <option value="percent">Percent (45.2%)</option>
              <option value="compact">Compact (1.2M)</option>
            </select>
          </div>

          {numberFormat === 'currency' && (
            <div>
              <Label>Currency symbol</Label>
              <div className="flex gap-1">
                {['$','€','£','¥','฿','KHR'].map((s) => (
                  <button key={s} onClick={() => setCurrencySymbol(s)}
                    className={cn(
                      'flex-1 py-1 text-[10px] rounded-md border transition-colors font-mono',
                      currencySymbol === s
                        ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 text-accent-700 dark:text-accent-400'
                        : 'border-border text-text-muted hover:text-text',
                    )}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live KPI preview */}
          {previewKpi !== null && (
            <div className="flex items-center justify-center gap-2 bg-bg-subtle border border-border rounded-md py-2 px-3">
              <span className="text-[10px] text-text-muted">Preview:</span>
              <span className="text-base font-bold text-accent-600 dark:text-accent-400">{previewKpi}</span>
            </div>
          )}
        </>
      )}

      {/* Direct mode — number format + preview */}
      {hasResult && sourceMode === 'direct' && widgetMode === 'kpi' && (
        <>
          <div>
            <Label>Number format</Label>
            <select value={numberFormat} onChange={(e) => setNumberFormat(e.target.value as NumberFormat)}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors">
              <option value="raw">Raw (1234567)</option>
              <option value="number">Number (1,234,567)</option>
              <option value="currency">Currency ($1,234.56)</option>
              <option value="percent">Percent (45.2%)</option>
              <option value="compact">Compact (1.2M)</option>
            </select>
          </div>
          {previewKpi !== null && (
            <div className="flex items-center justify-center gap-2 bg-bg-subtle border border-border rounded-md py-2 px-3">
              <span className="text-[10px] text-text-muted">Preview:</span>
              <span className="text-base font-bold text-accent-600 dark:text-accent-400">{previewKpi}</span>
            </div>
          )}
        </>
      )}

      {/* Mini data preview (array mode) */}
      {hasResult && sourceMode === 'array' && liveRows.length > 0 && cols.length > 0 && (
        <MiniPreview
          rows={liveRows}
          columns={cols.map((c) => c.key)}
          highlight={[valueKey, nameKey].filter(Boolean)}
        />
      )}

      {/* Apply */}
      {hasResult && canApply && (
        <button onClick={handleApply} disabled={!canApply}
          className={cn(
            'w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
            'bg-bg-card border border-border hover:border-accent-400 hover:text-accent-600',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}>
          <Hash className="w-3.5 h-3.5" />
          Apply to Widget
        </button>
      )}

      {/* Empty state */}
      {!hasResult && !fetchDs.isPending && !fetchDs.isError && (
        <div className="flex flex-col items-center gap-1.5 py-4 text-text-muted">
          <Hash className="w-6 h-6 opacity-20" />
          <p className="text-[10px] text-center opacity-60 leading-relaxed">
            Enter an API URL and click<br />Fetch Data to configure the widget
          </p>
        </div>
      )}
    </div>
  );
}
