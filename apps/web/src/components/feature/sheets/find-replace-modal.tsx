'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { rcToA1 } from '@/lib/sheets/a1';
import { formatComputed } from '@/lib/sheets/formula';
import type { Sheet } from '@/schemas/workbook';

interface FindOpts {
  caseSensitive: boolean;
  matchEntireCell: boolean;
  searchInFormulas: boolean;
}

interface Match {
  r: number;
  c: number;
  a1: string;
}

interface Props {
  mode: 'find' | 'replace';
  sheet: Sheet;
  computed: Record<string, unknown>;
  onClose: () => void;
  onNavigate: (r: number, c: number) => void;
  onReplaceAll: (replacements: Array<{ r: number; c: number; newValue: string }>) => void;
  onReplaceOne: (r: number, c: number, newValue: string) => void;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cellText(
  a1: string,
  sheet: Sheet,
  computed: Record<string, unknown>,
  searchInFormulas: boolean,
): string {
  const cell = sheet.cells?.[a1];
  if (!cell) return '';
  if (searchInFormulas && cell.f) return cell.f;
  if (cell.f) return String(formatComputed(computed[a1]) ?? '');
  return cell.v != null ? String(cell.v) : '';
}

function doReplace(
  text: string,
  search: string,
  replacement: string,
  opts: FindOpts,
): string {
  if (opts.matchEntireCell) {
    const match = opts.caseSensitive
      ? text === search
      : text.toLowerCase() === search.toLowerCase();
    return match ? replacement : text;
  }
  const flags = opts.caseSensitive ? 'g' : 'gi';
  return text.replace(new RegExp(escapeRegex(search), flags), replacement);
}

export function FindReplaceModal({
  mode: initialMode,
  sheet,
  computed,
  onClose,
  onNavigate,
  onReplaceAll,
  onReplaceOne,
}: Props) {
  const [mode, setMode] = useState(initialMode);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState<FindOpts>({
    caseSensitive: false,
    matchEntireCell: false,
    searchInFormulas: false,
  });
  const [matchIdx, setMatchIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  // Escape key closes the panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const matches = useMemo<Match[]>(() => {
    if (!search) return [];
    const out: Match[] = [];
    const needle = opts.caseSensitive ? search : search.toLowerCase();
    for (let r = 0; r < sheet.rowCount; r++) {
      for (let c = 0; c < sheet.colCount; c++) {
        const a1 = rcToA1(r, c);
        const text = cellText(a1, sheet, computed, opts.searchInFormulas);
        if (!text) continue;
        const haystack = opts.caseSensitive ? text : text.toLowerCase();
        const hit = opts.matchEntireCell ? haystack === needle : haystack.includes(needle);
        if (hit) out.push({ r, c, a1 });
      }
    }
    return out;
  }, [search, sheet, computed, opts]);

  const clampedIdx = matches.length ? matchIdx % matches.length : 0;

  const navigate = useCallback(
    (idx: number) => {
      if (!matches.length) return;
      const i = ((idx % matches.length) + matches.length) % matches.length;
      setMatchIdx(i);
      onNavigate(matches[i].r, matches[i].c);
    },
    [matches, onNavigate],
  );

  const findNext = useCallback(() => navigate(clampedIdx + 1), [navigate, clampedIdx]);
  const findPrev = useCallback(() => navigate(clampedIdx - 1), [navigate, clampedIdx]);

  const replaceOne = useCallback(() => {
    if (!matches.length || !replacement) return;
    const m = matches[clampedIdx];
    const a1 = m.a1;
    const text = cellText(a1, sheet, computed, opts.searchInFormulas);
    const newValue = doReplace(text, search, replacement, opts);
    onReplaceOne(m.r, m.c, newValue);
    findNext();
  }, [matches, clampedIdx, replacement, sheet, computed, opts, search, onReplaceOne, findNext]);

  const replaceAll = useCallback(() => {
    if (!matches.length || !replacement) return;
    const replacements = matches.map((m) => {
      const text = cellText(m.a1, sheet, computed, opts.searchInFormulas);
      return { r: m.r, c: m.c, newValue: doReplace(text, search, replacement, opts) };
    });
    onReplaceAll(replacements);
    setMatchIdx(0);
  }, [matches, replacement, sheet, computed, opts, search, onReplaceAll]);

  const toggle = (key: keyof FindOpts) =>
    setOpts((o) => ({ ...o, [key]: !o[key] }));

  return (
    <div
      className={cn(
        'fixed top-[130px] right-4 z-50 w-[340px] bg-bg-card border border-border rounded-lg shadow-lg text-[13px]',
        'animate-fade-in',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex gap-3">
          <button
            className={cn('font-medium pb-0.5', mode === 'find' ? 'border-b-2 border-accent text-accent' : 'text-text-muted')}
            onClick={() => setMode('find')}
          >
            Find
          </button>
          <button
            className={cn('font-medium pb-0.5', mode === 'replace' ? 'border-b-2 border-accent text-accent' : 'text-text-muted')}
            onClick={() => setMode('replace')}
          >
            Replace
          </button>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-3 space-y-2">
        {/* Search input */}
        <div className="flex gap-1">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setMatchIdx(0); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.shiftKey ? findPrev() : findNext(); } }}
            placeholder="Find…"
            className="flex-1 border border-border rounded px-2 py-1.5 outline-none focus:border-accent text-[13px] bg-bg-input"
          />
          <button
            onClick={findPrev}
            disabled={!matches.length}
            title="Previous (Shift+Enter)"
            className="p-1.5 rounded border border-border hover:bg-bg-hover disabled:opacity-40"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={findNext}
            disabled={!matches.length}
            title="Next (Enter)"
            className="p-1.5 rounded border border-border hover:bg-bg-hover disabled:opacity-40"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Replace input */}
        {mode === 'replace' && (
          <div className="flex gap-1">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with…"
              className="flex-1 border border-border rounded px-2 py-1.5 outline-none focus:border-accent text-[13px] bg-bg-input"
            />
          </div>
        )}

        {/* Match count */}
        <p className="text-text-muted text-[12px]">
          {search
            ? matches.length
              ? `${clampedIdx + 1} of ${matches.length} matches`
              : 'No matches'
            : 'Type to search'}
        </p>

        {/* Options */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-sub">
          {(
            [
              ['caseSensitive', 'Case sensitive'],
              ['matchEntireCell', 'Match entire cell'],
              ['searchInFormulas', 'Search in formulas'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={opts[key]}
                onChange={() => toggle(key)}
                className="accent-accent"
              />
              {label}
            </label>
          ))}
        </div>

        {/* Action buttons */}
        {mode === 'replace' && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={replaceOne}
              disabled={!matches.length || !replacement}
              className="px-3 py-1.5 rounded border border-border hover:bg-bg-hover disabled:opacity-40 text-[12px]"
            >
              Replace
            </button>
            <button
              onClick={replaceAll}
              disabled={!matches.length || !replacement}
              className="px-3 py-1.5 rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40 text-[12px]"
            >
              Replace all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
