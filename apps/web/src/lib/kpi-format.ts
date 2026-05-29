export type NumberFormat = 'raw' | 'number' | 'currency' | 'percent' | 'compact';
export type Aggregation  = 'first' | 'sum' | 'count' | 'avg' | 'min' | 'max';

export function formatKpiValue(
  value: number | string,
  format: NumberFormat = 'raw',
  currencySymbol = '$',
): string {
  const n = Number(value);
  if (isNaN(n)) return String(value);
  switch (format) {
    case 'number':
      return n.toLocaleString('en-US');
    case 'currency':
      return `${currencySymbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent':
      return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    case 'compact':
      if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
      if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
      if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return n.toLocaleString('en-US');
    default:
      return String(value);
  }
}

/** Read a (possibly nested) value from a row using a dot-notation path. */
function getNestedNum(row: Record<string, unknown>, key: string): number {
  if (!key.includes('.')) return Number(row[key] ?? 0);
  const parts = key.split('.');
  let cur: unknown = row;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return 0;
    cur = (cur as Record<string, unknown>)[part];
  }
  return Number(cur ?? 0);
}

export function applyAggregation(
  rows: Record<string, unknown>[],
  valueKey: string,
  aggregation: Aggregation = 'first',
): number {
  if (!rows.length) return 0;
  const vals = rows.map((r) => getNestedNum(r, valueKey)).filter((v) => !isNaN(v));
  switch (aggregation) {
    case 'count': return rows.length;
    case 'sum':   return vals.reduce((a, b) => a + b, 0);
    case 'avg':   return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    case 'min':   return vals.length ? Math.min(...vals) : 0;
    case 'max':   return vals.length ? Math.max(...vals) : 0;
    default:      return vals[0] ?? 0; // 'first'
  }
}
