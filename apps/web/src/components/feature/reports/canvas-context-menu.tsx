'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ContextAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean; // render a divider BEFORE this item
  submenu?: ContextAction[];
  onClick?: () => void;
}

// ── Recursive menu item list ─────────────────────────────────────────────────

function MenuItems({
  actions,
  onClose,
}: {
  actions: ContextAction[];
  onClose: () => void;
}) {
  const [subOpen, setSubOpen] = useState<string | null>(null);

  return (
    <>
      {actions.map((action, i) => (
        <div key={action.id}>
          {action.separator && i > 0 && (
            <div className="my-1 h-px bg-border mx-2" />
          )}

          {action.submenu ? (
            /* Item with submenu */
            <div
              className="relative"
              onMouseEnter={() => setSubOpen(action.id)}
              onMouseLeave={() => setSubOpen(null)}
            >
              <button
                disabled={action.disabled}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-[7px] text-left text-[13px] transition-colors rounded-sm mx-0.5',
                  !action.disabled && 'hover:bg-bg-hover',
                  action.disabled && 'opacity-40 cursor-not-allowed',
                )}
              >
                {action.icon && (
                  <span className="w-4 h-4 flex-shrink-0 text-text-muted flex items-center justify-center [&_svg]:w-4 [&_svg]:h-4">
                    {action.icon}
                  </span>
                )}
                <span className="flex-1 text-text">{action.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              </button>

              {subOpen === action.id && (
                <div className="absolute left-full top-[-4px] ml-1.5 w-52 bg-bg-card border border-border rounded-xl shadow-2xl py-1 z-10 animate-fade-in">
                  <MenuItems actions={action.submenu} onClose={onClose} />
                </div>
              )}
            </div>
          ) : (
            /* Regular item */
            <button
              onClick={() => {
                if (!action.disabled) {
                  action.onClick?.();
                  onClose();
                }
              }}
              disabled={action.disabled}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-[7px] text-left text-[13px] transition-colors',
                !action.disabled && !action.danger && 'hover:bg-bg-hover',
                !action.disabled && action.danger &&
                  'hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500',
                action.disabled && 'opacity-40 cursor-not-allowed',
              )}
            >
              {action.icon && (
                <span
                  className={cn(
                    'w-4 h-4 flex-shrink-0 flex items-center justify-center [&_svg]:w-4 [&_svg]:h-4',
                    action.danger ? 'text-red-500' : 'text-text-muted',
                  )}
                >
                  {action.icon}
                </span>
              )}
              <span className="flex-1">{action.label}</span>
              {action.shortcut && (
                <kbd className="text-[10px] text-text-muted bg-bg-subtle border border-border px-1.5 py-0.5 rounded font-mono tracking-tight">
                  {action.shortcut}
                </kbd>
              )}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

// ── Root context menu ────────────────────────────────────────────────────────

interface Props {
  x: number;
  y: number;
  actions: ContextAction[];
  onClose: () => void;
}

export function CanvasContextMenu({ x, y, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Measure after paint and flip up/left if the menu would overflow the viewport
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const left = x + w > window.innerWidth  ? x - w : x;
    const top  = y + h > window.innerHeight ? y - h : y;
    setPos({ left: Math.max(0, left), top: Math.max(0, top) });
  }, [x, y, actions]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[500] w-56 bg-bg-card border border-border rounded-xl shadow-2xl py-1.5 animate-fade-in"
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItems actions={actions} onClose={onClose} />
    </div>
  );
}
