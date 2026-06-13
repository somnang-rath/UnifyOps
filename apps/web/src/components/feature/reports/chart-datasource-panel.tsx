'use client';
import { useState } from 'react';
import {
  useFetchDatasource,
  extractArrayAtPath,
  type DetectedArray,
} from '@/hooks/use-report-datasource';
import { cn } from '@/lib/utils';
import {
  BarChart2, ChevronDown, ChevronRight, KeyRound, Loader2, Maximize2, Plus, RefreshCw, Trash2, Wifi, X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StoredChartDatasource = {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  dataPath?: string;
  nameKey: string;
  valueKey: string;
  value2Key?: string;
  colorKey?: string;
};

type HeaderRow = { key: string; value: string };

interface Props {
  props: Record<string, unknown>;
  onApply: (patch: Record<string, unknown>) => void;
  onFetched?: (rawApiResponse: unknown) => void;
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
        {(optional || !value) && <option value="">— {optional ? 'none' : 'pick field'} —</option>}
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
                {cols.map((col) => (
                  <td key={col} title={String(row[col] ?? '')}
                    className={cn(
                      'px-2 py-1 border-b border-border/50 truncate max-w-[80px]',
                      highlight.includes(col)
                        ? 'text-accent-700 dark:text-accent-400 font-medium'
                        : 'text-text-muted',
                    )}>
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

const PALETTE = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6'];

export function ChartDataSourcePanel({ props, onApply, onFetched }: Props) {
  const stored = props.dataSource as StoredChartDatasource | undefined;

  const [url, setUrl]         = useState(stored?.url ?? '');
  const [method, setMethod]   = useState<'GET' | 'POST'>(stored?.method ?? 'GET');
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.entries(stored?.headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [bearerToken, setBearerToken] = useState('');
  const [showAuth,    setShowAuth]    = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showJson,       setShowJson]       = useState(false);
  const [jsonFullscreen, setJsonFullscreen] = useState(false);
  const [selectedPath, setSelectedPath] = useState(stored?.dataPath ?? '');
  const [nameKey,   setNameKey]   = useState(stored?.nameKey   ?? '');
  const [valueKey,  setValueKey]  = useState(stored?.valueKey  ?? '');
  const [value2Key, setValue2Key] = useState(stored?.value2Key ?? '');
  const [colorKey,  setColorKey]  = useState(stored?.colorKey  ?? '');

  const chartType = (props.chartType as string | undefined) ?? 'bar';
  const isDualAxis = chartType === 'bar-line';

  const fetchDs  = useFetchDatasource();
  const result   = fetchDs.data;
  const detected: DetectedArray[] = result?.detected ?? [];
  const activeArray = detected.find((d) => d.path === selectedPath) ?? detected[0];
  const cols        = activeArray?.columns ?? [];

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
          const strCol  = first.columns.find((c) => c.type === 'string');
          const numCols = first.columns.filter((c) => c.type === 'number');
          if (strCol)    setNameKey(strCol.key);
          if (numCols[0]) setValueKey(numCols[0].key);
          if (isDualAxis && numCols[1]) setValue2Key(numCols[1].key);
        }
        onFetched?.(res.data);
        setShowJson(true);
      },
    });
  };

  const handlePathChange = (path: string) => {
    setSelectedPath(path);
    const arr = detected.find((d) => d.path === path);
    if (arr) {
      const strCol  = arr.columns.find((c) => c.type === 'string');
      const numCols = arr.columns.filter((c) => c.type === 'number');
      if (strCol)    setNameKey(strCol.key);
      if (numCols[0]) setValueKey(numCols[0].key);
      if (isDualAxis && numCols[1]) setValue2Key(numCols[1].key);
    }
  };

  const liveRows = result ? extractArrayAtPath(result.data, selectedPath) : [];

  const handleApply = () => {
    if (!result || !nameKey || !valueKey) return;
    onApply({
      ...props,
      dataSource: {
        url: url.trim(), method, headers: headersMap(), dataPath: selectedPath,
        nameKey, valueKey,
        ...(isDualAxis && value2Key ? { value2Key } : {}),
        ...(colorKey ? { colorKey } : {}),
      } satisfies StoredChartDatasource,
      rawApiResponse: result.data,
      rawSeriesRows: liveRows.slice(0, 50),
      seriesData: liveRows.slice(0, 50).map((row, i) => ({
        name:  String(row[nameKey] ?? ''),
        value: Number(row[valueKey] ?? 0),
        ...(isDualAxis && value2Key ? { value2: Number(row[value2Key] ?? 0) } : {}),
        color: colorKey && row[colorKey] ? String(row[colorKey]) : PALETTE[i % PALETTE.length],
      })),
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const hasResult  = !!result;
  const canApply   = hasResult && !!nameKey && !!valueKey;
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

      {/* Method + URL */}
      <div>
        <Label>API URL</Label>
        <div className="flex gap-1">
          <select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
            className="px-1.5 py-1.5 text-xs rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 w-16 flex-shrink-0">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <PanelInput type="url" placeholder="https://api.example.com/sales"
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
            <pre className="flex-1 overflow-auto p-4 text-[12px] bg-bg-subtle font-mono whitespace-pre-wrap break-all leading-relaxed text-text">
              {JSON.stringify(result?.data, null, 2)}
            </pre>
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

      {/* Row count */}
      {hasResult && detected.length === 1 && (
        <p className="text-[10px] text-text-muted">
          {detected[0].count} rows{detected[0].path ? ` at "${detected[0].path}"` : ' at root'}
        </p>
      )}

      {/* Mini preview */}
      {hasResult && liveRows.length > 0 && (
        <MiniPreview
          rows={liveRows}
          columns={cols.map((c) => c.key)}
          highlight={[nameKey, valueKey, isDualAxis ? value2Key : ''].filter(Boolean)}
        />
      )}

      {/* Field pickers */}
      {cols.length > 0 && (
        <>
          <FieldSelect label="Name field (X axis / label)" value={nameKey} columns={cols} onChange={setNameKey} />
          <FieldSelect label={isDualAxis ? 'Bar value field (left Y axis)' : 'Value field (Y axis / numeric)'}
            value={valueKey} columns={cols} preferNumeric onChange={setValueKey} />
          {isDualAxis && (
            <FieldSelect label="Line value field (right Y axis)" value={value2Key} columns={cols} preferNumeric optional onChange={setValue2Key} />
          )}
          <FieldSelect label="Color field (optional)" value={colorKey} columns={cols} optional onChange={setColorKey} />
        </>
      )}

      {/* Apply */}
      {cols.length > 0 && (
        <button onClick={handleApply} disabled={!canApply}
          className={cn(
            'w-full py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
            'bg-bg-card border border-border hover:border-accent-400 hover:text-accent-600',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}>
          <BarChart2 className="w-3.5 h-3.5" /> Apply to Chart
        </button>
      )}

      {/* Empty state */}
      {!hasResult && !fetchDs.isPending && !fetchDs.isError && (
        <div className="flex flex-col items-center gap-1.5 py-4 text-text-muted">
          <BarChart2 className="w-6 h-6 opacity-20" />
          <p className="text-[10px] text-center opacity-60 leading-relaxed">
            Enter an API URL and click<br />Fetch Data to map chart fields
          </p>
        </div>
      )}
    </div>
  );
}
