'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Kbd } from './primitives';

/**
 * ⌘K command palette (docs/plan/02-design-system.md §3 Tier 3, §4 shell).
 *
 * Presentational only: the app owns the item list, the query state (so it can
 * debounce async lookups), and what running an item does. This component owns
 * everything a palette must get right once: focus on open, ↑/↓/Enter/Escape,
 * scroll-into-view, grouping, ARIA (combobox → listbox → option), and the
 * footer hint row.
 */

export interface CommandPaletteItem {
  /** Stable key; falls back to the list index. */
  id?: string;
  /** Items render grouped under these headings, in first-seen order. */
  group: string;
  /** Pre-sized icon node (~15px). Colour is inherited — don't set text-*. */
  icon?: React.ReactNode;
  title: string;
  badge?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  /** Controlled query — the app filters/fetches and passes new `items`. */
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  emptyText?: string;
  /**
   * Accessible names. English defaults, overridable by the app — this package
   * takes no i18n dependency (ADR 0016 §2.5).
   */
  dialogLabel?: string;
  listLabel?: string;
}

/** Binds ⌘K / Ctrl+K globally while mounted. */
export function useCommandK(onOpen: () => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

export function CommandPalette({
  open,
  onClose,
  items,
  query,
  onQueryChange,
  placeholder = 'Type a command or search…',
  emptyText = 'No results',
  dialogLabel = 'Command palette',
  listLabel = 'Commands',
}: CommandPaletteProps) {
  const [sel, setSel] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useEffect(() => setMounted(true), []);

  // Reset + focus on open; reset selection whenever the result set changes.
  React.useEffect(() => {
    if (!open) return;
    setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);
  React.useEffect(() => setSel(0), [items.length, query]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[sel]?.onSelect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, sel, onClose]);

  React.useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open || !mounted) return null;

  const grouped = new Map<string, { item: CommandPaletteItem; idx: number }[]>();
  items.forEach((item, idx) => {
    const list = grouped.get(item.group) ?? [];
    list.push({ item, idx });
    grouped.set(item.group, list);
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      className="fixed inset-0 z-50 flex items-start justify-center px-5 pt-[12vh] pb-5 bg-[var(--overlay,rgba(10,10,30,.45))] backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[600px] bg-bg-card border border-border rounded-lg shadow-lg overflow-hidden animate-modal-in">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-text-muted flex-shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[sel] ? `${listId}-${sel}` : undefined}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent border-0 outline-none text-md placeholder:text-text-muted"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="max-h-[400px] overflow-y-auto p-1.5"
        >
          {items.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-text-muted">
              {emptyText}
            </div>
          ) : (
            Array.from(grouped.entries()).map(([group, list]) => (
              <div key={group} className="py-0.5">
                <div className="px-2.5 pt-2 pb-1 text-micro font-bold uppercase tracking-[.08em] text-text-muted select-none">
                  {group}
                </div>
                {list.map(({ item, idx }) => {
                  const selected = idx === sel;
                  return (
                    <button
                      key={item.id ?? idx}
                      type="button"
                      role="option"
                      id={`${listId}-${idx}`}
                      aria-selected={selected}
                      data-idx={idx}
                      tabIndex={-1}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => item.onSelect()}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-sm text-left transition-colors duration-[var(--dur)]',
                        selected
                          ? 'bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)]'
                          : 'text-text hover:bg-bg-hover',
                      )}
                    >
                      {item.icon && (
                        <span
                          className={cn(
                            'flex-shrink-0 flex items-center justify-center',
                            selected ? 'text-accent' : 'text-text-muted',
                          )}
                        >
                          {item.icon}
                        </span>
                      )}
                      <span className="flex-1 min-w-0 truncate">
                        {item.title}
                      </span>
                      {item.badge && (
                        <span className="text-micro px-1.5 py-px rounded-full bg-bg-hover text-text-muted">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-bg-subtle text-2xs text-text-muted">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> Navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd> Open
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Esc</Kbd> Close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
