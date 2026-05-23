'use client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}
interface MenuSection {
  items: (MenuItem | 'divider')[];
}
export interface MenuDef {
  name: string;
  sections: MenuSection[];
}

interface Props {
  menus: MenuDef[];
}

export function MenuBar({ menus }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onClick = (ev: MouseEvent) => {
      if (!barRef.current?.contains(ev.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={barRef} className="flex items-center gap-0 mt-0.5 relative">
      {menus.map((m, i) => (
        <div key={m.name} className="relative">
          <button
            type="button"
            className={cn(
              'text-[13px] text-text-sub px-2 py-0.5 rounded hover:bg-bg-hover',
              open === i && 'bg-bg-hover',
            )}
            onClick={() => setOpen((cur) => (cur === i ? null : i))}
            onMouseEnter={() => {
              if (open !== null) setOpen(i);
            }}
          >
            {m.name}
          </button>
          {open === i && (
            <div className="absolute top-full left-0 mt-1 min-w-[240px] bg-white border border-border rounded-md shadow-lg py-1 z-40 text-[13px]">
              {m.sections.map((section, si) => (
                <div key={si}>
                  {si > 0 && (
                    <div className="h-px bg-border my-1 mx-2" aria-hidden />
                  )}
                  {section.items.map((it, ii) => {
                    if (it === 'divider') {
                      return (
                        <div
                          key={ii}
                          className="h-px bg-border my-1 mx-2"
                          aria-hidden
                        />
                      );
                    }
                    return (
                      <button
                        key={ii}
                        disabled={it.disabled}
                        onClick={() => {
                          if (it.disabled) return;
                          it.onClick?.();
                          setOpen(null);
                        }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 flex items-center gap-3 hover:bg-bg-hover',
                          it.disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent',
                        )}
                      >
                        <span className="flex-1">{it.label}</span>
                        {it.shortcut && (
                          <span className="text-[11px] text-text-muted">
                            {it.shortcut}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
