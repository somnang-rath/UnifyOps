'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, Check, Search, X } from 'lucide-react';
import { uniqueValuesInColumn } from '@/lib/sheets/filter';
import type { Sheet, SheetFilterCriterion } from '@/schemas/workbook';
import { cn } from '@/lib/utils';

interface Props {
  sheet: Sheet;
  col: number;
  x: number;
  y: number;
  onClose: () => void;
  onSort: (dir: 'asc' | 'desc') => void;
  onSetCriterion: (criterion: SheetFilterCriterion | null) => void;
}

const POPOVER_W = 260;
const POPOVER_H = 380;

export function FilterPopover({
  sheet,
  col,
  x,
  y,
  onClose,
  onSort,
  onSetCriterion,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  const existing = sheet.filter?.criteria?.[String(col)];
  const range = sheet.filter?.range;

  const values = useMemo(
    () => (range ? uniqueValuesInColumn(sheet, col, range) : []),
    [sheet, col, range],
  );

  // Selected set: values currently included by the filter. If no criterion
  // exists for this column or it's not an `in` filter, default to all-selected.
  const initialSelected = useMemo(() => {
    if (existing?.op === 'in' && Array.isArray(existing.value)) {
      return new Set(
        (existing.value as unknown[]).map((v) =>
          v == null ? '' : String(v),
        ),
      );
    }
    return new Set(values);
  }, [existing, values]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  // If `values` changes (e.g. user edits sheet under us), keep selection in sync
  useEffect(() => {
    setSelected((cur) => {
      const next = new Set<string>();
      for (const v of values) if (cur.has(v)) next.add(v);
      // If the filter wasn't user-narrowed yet, default to everything selected.
      return cur.size === 0 ? new Set(values) : next.size === 0 ? new Set(values) : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - POPOVER_W - 8);
  const top = Math.min(y, window.innerHeight - POPOVER_H - 8);

  const filtered = useMemo(() => {
    if (!query.trim()) return values;
    const q = query.toLowerCase();
    return values.filter((v) => v.toLowerCase().includes(q));
  }, [values, query]);

  const allSelected =
    selected.size === values.length && values.every((v) => selected.has(v));

  const toggle = (v: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const apply = () => {
    if (allSelected) {
      onSetCriterion(null);
    } else {
      onSetCriterion({ op: 'in', value: [...selected] });
    }
    onClose();
  };

  const clearForColumn = () => {
    onSetCriterion(null);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-card border border-border rounded-md shadow-lg flex flex-col text-[13px]"
      style={{ left, top, width: POPOVER_W, height: POPOVER_H }}
    >
      <div className="px-2 py-1.5 border-b border-border flex items-center gap-1">
        <button
          onClick={() => {
            onSort('asc');
            onClose();
          }}
          className="flex-1 px-2 py-1 rounded hover:bg-bg-hover flex items-center gap-1.5 text-[12px]"
        >
          <ArrowUpAZ className="w-3.5 h-3.5" />
          Sort A → Z
        </button>
        <button
          onClick={() => {
            onSort('desc');
            onClose();
          }}
          className="flex-1 px-2 py-1 rounded hover:bg-bg-hover flex items-center gap-1.5 text-[12px]"
        >
          <ArrowDownAZ className="w-3.5 h-3.5" />
          Sort Z → A
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-border relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter values"
          className="w-full pl-6 pr-2 py-1 bg-bg-input border border-border rounded text-[12px] outline-none focus:border-accent"
        />
      </div>

      <div className="px-2 py-1 border-b border-border flex items-center gap-2 text-[11.5px]">
        <button
          onClick={() => setSelected(new Set(values))}
          className="text-accent hover:underline"
        >
          Select all
        </button>
        <span className="text-text-muted">·</span>
        <button
          onClick={() => setSelected(new Set())}
          className="text-accent hover:underline"
        >
          Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            No matches
          </div>
        ) : (
          filtered.map((v) => {
            const checked = selected.has(v);
            return (
              <button
                key={v}
                onClick={() => toggle(v)}
                className={cn(
                  'w-full px-2 py-1 flex items-center gap-2 rounded text-left hover:bg-bg-hover',
                )}
              >
                <span
                  className={cn(
                    'w-4 h-4 rounded-sm border flex items-center justify-center shrink-0',
                    checked
                      ? 'bg-accent border-accent text-white'
                      : 'border-border bg-bg-input',
                  )}
                >
                  {checked && <Check className="w-3 h-3" />}
                </span>
                <span className="truncate text-[12px]">
                  {v === '' ? (
                    <em className="text-text-muted">(Blanks)</em>
                  ) : (
                    v
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="px-2 py-1.5 border-t border-border flex items-center justify-between gap-2">
        <button
          onClick={clearForColumn}
          className="px-2 py-1 text-[12px] text-text-muted hover:text-text inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Clear filter
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="px-2 py-1 text-[12px] rounded hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="px-3 py-1 text-[12px] rounded bg-accent text-white hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
