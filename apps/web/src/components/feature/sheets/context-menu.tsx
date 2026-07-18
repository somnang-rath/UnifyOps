'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface CtxMenuItem {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export interface CtxMenuSection {
  items: CtxMenuItem[];
}

interface Props {
  x: number;
  y: number;
  sections: CtxMenuSection[];
  onClose: () => void;
}

export function ContextMenu({ x, y, sections, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) onCloseRef.current();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onCloseRef.current();
    };
    const onScroll = () => onCloseRef.current();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Clamp to viewport once mounted so the menu never overflows the screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = x + rect.width > vw - 8 ? Math.max(8, vw - rect.width - 8) : x;
    const ny = y + rect.height > vh - 8 ? Math.max(8, vh - rect.height - 8) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="fixed bg-bg-card border border-border rounded-md shadow-lg py-1 z-[100] text-[13px] min-w-[240px]"
      style={{ top: pos.y, left: pos.x }}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {sections.map((sec, si) => (
        <div key={si}>
          {si > 0 && (
            <div className="h-px bg-border my-1 mx-2" aria-hidden />
          )}
          {sec.items.map((it, ii) => (
            <button
              key={ii}
              disabled={it.disabled}
              onClick={() => {
                if (it.disabled) return;
                it.onClick?.();
                onClose();
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 flex items-center gap-2.5 hover:bg-bg-hover',
                it.disabled &&
                  'opacity-50 cursor-not-allowed hover:bg-transparent',
              )}
            >
              <span className="w-4 inline-flex items-center justify-center text-text-muted">
                {it.icon}
              </span>
              <span className="flex-1">{it.label}</span>
              {it.shortcut && (
                <span className="text-[11px] text-text-muted">
                  {it.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
