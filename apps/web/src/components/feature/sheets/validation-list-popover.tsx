'use client';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  values: string[];
  current: string | null;
  x: number;
  y: number;
  onPick: (v: string) => void;
  onClose: () => void;
}

export function ValidationListPopover({
  values,
  current,
  x,
  y,
  onPick,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
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

  const W = 200;
  const H = Math.min(280, values.length * 28 + 12);
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - H - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-border rounded-md shadow-lg py-1 overflow-y-auto"
      style={{ left, top, width: W, maxHeight: H }}
    >
      {values.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-text-muted">
          No options configured.
        </div>
      ) : (
        values.map((v) => (
          <button
            key={v}
            onClick={() => {
              onPick(v);
              onClose();
            }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-[12px] hover:bg-bg-hover truncate',
              v === current && 'bg-bg-subtle',
            )}
          >
            {v}
          </button>
        ))
      )}
    </div>
  );
}
