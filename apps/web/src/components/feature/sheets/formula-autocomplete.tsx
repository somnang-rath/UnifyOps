'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const byName = (a: FnDef, b: FnDef) => a.name.localeCompare(b.name);
  return [...exact, ...prefix.sort(byName), ...contains.sort(byName)].slice(0, 10);
}

export function getActiveToken(val: string, cursor: number): string {
  if (!val.startsWith('=')) return '';
  const before = val.slice(1, cursor);
  const m = before.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
  return m ? m[0].toUpperCase() : '';
}

const ROW_H = 22;
const GAP = 4;

export function FormulaAutocomplete({
  token,
  position,
  onSelect,
  onDismiss,
  activeIndex,
  setActiveIndex,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState(position);
  const matches = filterFunctions(token);

  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(0);
  }, [matches.length, activeIndex, setActiveIndex]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Keep the panel inside the viewport: flip above the cell when it would
  // overflow the bottom, and clamp horizontally.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let { top, left } = position;
    if (top + height > window.innerHeight - GAP) {
      const above = position.top - height - ROW_H - GAP * 2;
      top = above >= GAP ? above : Math.max(GAP, window.innerHeight - height - GAP);
    }
    left = Math.max(GAP, Math.min(left, window.innerWidth - width - GAP));
    setPlacement({ top, left });
  }, [position, matches.length]);

  if (!matches.length) return null;

  const activeFn = matches[activeIndex];
  const q = token.toUpperCase();

  return (
    <div
      ref={panelRef}
      className="fixed z-[200] bg-bg-card border border-border rounded-sm shadow-lg overflow-hidden"
      style={{ top: placement.top, left: placement.left, minWidth: 260, maxWidth: 380 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Close button header */}
      <div className="flex items-center justify-end px-1 py-px bg-[var(--sh-header-bg)] border-b border-border">
        <button
          className="text-text-muted hover:text-text text-[10px] w-4 h-4 flex items-center justify-center rounded hover:bg-bg-hover transition-colors"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
          tabIndex={-1}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Function list — fixed row height so hovering never shifts the list */}
      <ul ref={listRef} className="max-h-[154px] overflow-y-auto py-0.5">
        {matches.map((fn, i) => {
          const isActive = i === activeIndex;
          const nameEl = fn.name.startsWith(q)
            ? (<>
                <span className="text-[var(--sh-accent-text)]">{fn.name.slice(0, q.length)}</span>
                <span className="text-text">{fn.name.slice(q.length)}</span>
              </>)
            : <span className="text-text">{fn.name}</span>;

          return (
            <li
              key={fn.name}
              className={`px-2 h-[22px] leading-[22px] truncate cursor-pointer select-none font-mono text-[12px] ${isActive ? 'bg-[var(--sh-header-bg-sel)]' : 'hover:bg-bg-hover'}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onSelect(fn.name)}
            >
              {nameEl}
            </li>
          );
        })}
      </ul>

      {/* Detail strip for the active function */}
      {activeFn && (
        <div className="px-2 py-1 border-t border-border bg-[var(--sh-header-bg)]">
          <div className="font-mono text-[11px] text-text-sub truncate">{activeFn.syntax}</div>
          <div className="text-[11px] text-text-muted leading-snug mt-0.5">{activeFn.desc}</div>
        </div>
      )}

      {/* Keyboard hints */}
      <div className="px-2 py-1 border-t border-border bg-[var(--sh-header-bg)]">
        <span className="text-[10px] text-text-muted">Tab to insert · ↑↓ to navigate · Esc to close</span>
      </div>
    </div>
  );
}
