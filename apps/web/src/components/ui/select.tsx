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

export interface SelectProps<T extends string = string> {
  value: T;
  onValueChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  inline?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  inline,
  disabled,
  className,
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [focusedIdx, setFocusedIdx] = React.useState(-1);
  const [dropPos, setDropPos] = React.useState({ top: 0, left: 0, width: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);
  const isMouseFocusRef = React.useRef(false);

  const computePos = React.useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 6, left: r.left, width: r.width });
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
      style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
      className={cn(
        'fixed max-h-[min(280px,50vh)] overflow-y-auto z-[9999]',
        'bg-bg-card border-[1.5px] border-border rounded-sm shadow-lg p-1',
        'transition-[opacity,transform] duration-200 ease-[cubic-bezier(.16,1,.3,1)]',
        open
          ? 'opacity-100 translate-y-0 pointer-events-auto'
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
              'px-2.5 py-2 rounded-xs text-[13px] text-text bg-transparent border-0 cursor-pointer',
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
        onMouseDown={() => { isMouseFocusRef.current = true; }}
        onFocus={() => {
          if (!isMouseFocusRef.current) {
            const selIdx = options.findIndex((o) => o.value === value);
            openAt(selIdx >= 0 ? selIdx : 0);
          }
          isMouseFocusRef.current = false;
        }}
        onBlur={(e) => {
          if (dropRef.current?.contains(e.relatedTarget as Node)) return;
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-2 rounded-sm border-[1.5px] border-border bg-bg-input text-text text-left text-[13px] cursor-pointer',
          'transition-[border-color,box-shadow] duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)]',
          'hover:border-[color:color-mix(in_srgb,var(--a)_50%,var(--border))]',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_rgba(99,102,241,.15)]',
          'disabled:opacity-55 disabled:cursor-not-allowed',
          inline ? 'min-w-[140px] w-auto px-3 py-2' : 'w-full px-3 py-[9px]',
          open && 'border-accent shadow-[0_0_0_3px_rgba(99,102,241,.15)]',
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
            'flex-shrink-0 w-3 h-3 text-text-muted transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
            open && 'rotate-180',
          )}
        />
      </button>

      {typeof document !== 'undefined' &&
        ReactDOM.createPortal(dropdown, document.body)}
    </div>
  );
}
