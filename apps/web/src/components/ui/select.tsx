'use client';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * Sizes mirror Button/Input exactly (packages/ui). A Select sits next to a
 * Button on every toolbar in the product, so the two must resolve to the same
 * height, radius and border width from the same tokens — otherwise each new
 * toolbar needs per-screen nudging to look level.
 */
const SIZE: Record<SelectSize, string> = {
  xs: 'h-ctl-xs px-1.5 text-2xs gap-1',
  sm: 'h-ctl-sm px-2 text-xs',
  md: 'h-ctl-md px-2.5 text-sm',
  lg: 'h-ctl-lg px-3.5 text-sm',
};

export type SelectSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SelectProps<T extends string = string> {
  value: T;
  onValueChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  inline?: boolean;
  size?: SelectSize;
  disabled?: boolean;
  className?: string;
  /** Accessible name for a Select with no visible <label> beside it. */
  'aria-label'?: string;
}

export function Select<T extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  inline,
  size = 'md',
  disabled,
  className,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [focusedIdx, setFocusedIdx] = React.useState(-1);
  const [dropPos, setDropPos] = React.useState<{
    top?: number; bottom?: number; left: number; width: number; flipUp: boolean;
  }>({ left: 0, width: 0, flipUp: false });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);

  const computePos = React.useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const maxDropH = Math.min(280, window.innerHeight * 0.5);
    const spaceBelow = window.innerHeight - r.bottom - 8;
    if (spaceBelow >= maxDropH) {
      setDropPos({ top: r.bottom + 6, left: r.left, width: r.width, flipUp: false });
    } else {
      // anchor bottom of dropdown to just above the button
      setDropPos({ bottom: window.innerHeight - r.top + 6, left: r.left, width: r.width, flipUp: true });
    }
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    computePos();
    setOpen((o) => !o);
  };

  const openAt = React.useCallback((idx: number) => {
    computePos();
    setOpen(true);
    setFocusedIdx(idx);
  }, [computePos]);

  // Reset focusedIdx when dropdown closes
  React.useEffect(() => {
    if (!open) setFocusedIdx(-1);
  }, [open]);

  // Scroll focused item into view
  React.useEffect(() => {
    if (!open || focusedIdx < 0) return;
    const items = dropRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    items?.[focusedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx, open]);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (dropRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => { computePos(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, computePos]);

  const enabledIdxs = React.useMemo(
    () => options.reduce<number[]>((acc, o, i) => { if (!o.disabled) acc.push(i); return acc; }, []),
    [options],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        const selIdx = options.findIndex((o) => o.value === value);
        openAt(selIdx >= 0 ? selIdx : enabledIdxs[0] ?? 0);
      } else {
        setFocusedIdx((prev) => {
          const cur = enabledIdxs.indexOf(prev);
          return enabledIdxs[cur + 1] ?? enabledIdxs[0] ?? prev;
        });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        const selIdx = options.findIndex((o) => o.value === value);
        openAt(selIdx >= 0 ? selIdx : enabledIdxs[enabledIdxs.length - 1] ?? 0);
      } else {
        setFocusedIdx((prev) => {
          const cur = enabledIdxs.indexOf(prev);
          return enabledIdxs[cur - 1] ?? enabledIdxs[enabledIdxs.length - 1] ?? prev;
        });
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        const selIdx = options.findIndex((o) => o.value === value);
        openAt(selIdx >= 0 ? selIdx : enabledIdxs[0] ?? 0);
      } else if (focusedIdx >= 0 && !options[focusedIdx]?.disabled) {
        onValueChange(options[focusedIdx].value as T);
        setOpen(false);
      }
    }
  };

  const selected = options.find((o) => o.value === value);

  const dropdown = (
    <div
      ref={dropRef}
      role="listbox"
      style={{ top: dropPos.top, bottom: dropPos.bottom, left: dropPos.left, minWidth: dropPos.width }}
      className={cn(
        'fixed max-h-[min(280px,50vh)] overflow-y-auto z-[9999]',
        'bg-bg-card border border-border rounded-md shadow-lg p-1',
        'transition-[opacity,transform] duration-200 ease-[cubic-bezier(.16,1,.3,1)]',
        open
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : dropPos.flipUp
            ? 'opacity-0 translate-y-1.5 pointer-events-none'
            : 'opacity-0 -translate-y-1.5 pointer-events-none',
      )}
    >
      {options.map((o, idx) => {
        const isSel = o.value === value;
        const isFocused = focusedIdx === idx;
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={isSel}
            disabled={o.disabled}
            onMouseEnter={() => setFocusedIdx(idx)}
            onClick={() => {
              onValueChange(o.value);
              setOpen(false);
            }}
            className={cn(
              'flex items-center justify-between w-full text-left whitespace-nowrap',
              'px-2 h-ctl-md rounded-sm text-sm text-text bg-transparent border-0 cursor-pointer',
              'transition-colors duration-[120ms] ease-[cubic-bezier(.4,0,.2,1)]',
              'hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed',
              isSel &&
                'bg-[color:color-mix(in_srgb,var(--a)_14%,transparent)] text-accent font-medium',
              isFocused && !isSel && 'bg-bg-hover',
            )}
          >
            <span className="truncate">{o.label}</span>
            {isSel && <Check className="w-3.5 h-3.5 ml-2 text-accent" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        'relative',
        inline ? 'inline-block align-middle' : 'block',
        className,
      )}
      data-state={open ? 'open' : 'closed'}
    >
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Receiving focus must NOT open the popup (ARIA combobox pattern):
        // Modal's focus trap focuses the first focusable on open, and a Select
        // in that spot would auto-expand its dropdown. ArrowDown/Enter/Space
        // open it for keyboard users (handleKeyDown).
        onBlur={(e) => {
          if (dropRef.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        onClick={handleOpen}
        className={cn(
          // Same recipe as Input: 1px border, rounded-md, bg-bg-input, token focus.
          'flex items-center justify-between gap-1.5 whitespace-nowrap',
          'rounded-md border border-border bg-bg-input text-text text-left cursor-pointer',
          'transition-colors duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)]',
          'hover:border-border-strong focus:border-accent focus-visible:border-accent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          SIZE[size],
          inline ? 'w-auto min-w-[120px] max-w-[180px]' : 'w-full',
          open && 'border-accent',
        )}
      >
        <span
          className={cn(
            'flex-1 min-w-0 truncate',
            !selected && 'text-text-muted',
          )}
        >
          {selected?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown
          className={cn(
            'shrink-0 w-3.5 h-3.5 text-text-muted transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
            open && 'rotate-180',
          )}
        />
      </button>

      {typeof document !== 'undefined' &&
        ReactDOM.createPortal(dropdown, document.body)}
    </div>
  );
}
