'use client';
import { useEffect, useRef } from 'react';
import { FUNCTION_REGISTRY, type FnDef } from '@/lib/sheets/function-registry';

interface Props {
  token: string;
  position: { top: number; left: number };
  onSelect: (name: string) => void;
  onDismiss: () => void;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
}

export function filterFunctions(token: string): FnDef[] {
  if (!token) return [];
  const q = token.toUpperCase();
  const exact: FnDef[] = [];
  const prefix: FnDef[] = [];
  const contains: FnDef[] = [];
  for (const fn of FUNCTION_REGISTRY) {
    if (fn.name === q) exact.push(fn);
    else if (fn.name.startsWith(q)) prefix.push(fn);
    else if (fn.name.includes(q)) contains.push(fn);
  }
  return [...exact, ...prefix, ...contains].slice(0, 10);
}

export function getActiveToken(val: string, cursor: number): string {
  if (!val.startsWith('=')) return '';
  const before = val.slice(1, cursor);
  const m = before.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
  return m ? m[0].toUpperCase() : '';
}

export function FormulaAutocomplete({
  token,
  position,
  onSelect,
  onDismiss,
  activeIndex,
  setActiveIndex,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const matches = filterFunctions(token);

  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(0);
  }, [matches.length, activeIndex, setActiveIndex]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!matches.length) return null;

  const activeFn = matches[activeIndex];
  const q = token.toUpperCase();

  return (
    <div
      className="fixed z-[200] bg-white border border-[#dadce0] rounded-sm shadow-lg overflow-hidden"
      style={{ top: position.top, left: position.left, minWidth: 300, maxWidth: 420 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Close button header */}
      <div className="flex items-center justify-end px-2 py-0.5 bg-[#f8f9fa] border-b border-[#dadce0]">
        <button
          className="text-[#5f6368] hover:text-[#202124] text-[11px] w-5 h-5 flex items-center justify-center rounded hover:bg-[#e8eaed] transition-colors"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
          tabIndex={-1}
        >
          ✕
        </button>
      </div>

      {/* Function list */}
      <ul ref={listRef} className="max-h-[210px] overflow-y-auto divide-y divide-[#f1f3f4]">
        {matches.map((fn, i) => {
          const isActive = i === activeIndex;
          const nameEl = fn.name.startsWith(q)
            ? (<>
                <span className="text-[#1967d2] ">{fn.name.slice(0, q.length)}</span>
                <span className="text-[#444746] ">{fn.name.slice(q.length)}</span>
              </>)
            : <span className="text-[#444746] ">{fn.name}</span>;

          return (
            <li
              key={fn.name}
              className={`px-3 py-2 cursor-pointer select-none ${isActive ? 'bg-[#e8f0fe]' : 'hover:bg-[#f1f3f4]'}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onSelect(fn.name)}
            >
              <div className="font-mono text-[13px]">{nameEl}</div>
              {isActive && (
                <div className="text-[11px] text-[#5f6368] mt-0.5 leading-snug">{fn.descKh}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Syntax strip */}
      {activeFn && (
        <div className="px-3 py-1 border-t border-[#dadce0] bg-[#f8f9fa]">
          <span className="font-mono text-[11px] text-[#444746] truncate block">{activeFn.syntax}</span>
        </div>
      )}

      {/* Khmer keyboard hints */}
      <div className="px-3 py-1 border-t border-[#dadce0] bg-[#f8f9fa]">
        <span className="text-[10px] text-[#80868b]">ចុច Tab ដើម្បីទទួលយក ។ ចុច ↑↓ ដើម្បីរើស</span>
      </div>
    </div>
  );
}
