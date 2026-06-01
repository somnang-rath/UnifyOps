'use client';
import type { ReportElement } from '@/schemas/report';
import { ImageIcon } from 'lucide-react';

interface Props { element: ReportElement }

export function ElementImage({ element }: Props) {
  const p = element.props as {
    src?: string;
    alt?: string;
    objectFit?: 'cover' | 'contain' | 'fill';
    borderRadius?: number;
    border?: boolean;
    borderColor?: string;
    borderWidth?: number;
    opacity?: number;
    caption?: string;
    removeBackground?: boolean;
  };

  const radius  = p.borderRadius ?? 0;
  const opacity = p.opacity ?? 1;
  const border  = p.border
    ? `${p.borderWidth ?? 2}px solid ${p.borderColor ?? '#e5e7eb'}`
    : 'none';

  if (!p.src) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center bg-bg-subtle border border-dashed border-border text-text-muted gap-2"
        style={{ borderRadius: radius, opacity }}
      >
        <div className="w-12 h-12 rounded-xl bg-bg-card border border-border flex items-center justify-center">
          <ImageIcon className="w-6 h-6 opacity-40" />
        </div>
        <span className="text-xs">Enter image URL in the panel</span>
      </div>
    );
  }

  if (p.caption) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden" style={{ opacity, borderRadius: radius, border }}>
        <img
          src={p.src}
          alt={p.alt ?? ''}
          style={{
            flex: 1,
            width: '100%',
            minHeight: 0,
            objectFit: p.objectFit ?? 'cover',
            display: 'block',
            mixBlendMode: p.removeBackground ? 'multiply' : undefined,
          }}
        />
        <div className="text-[11px] text-center text-text-muted bg-bg-subtle px-2 py-1 flex-shrink-0 border-t border-border">
          {p.caption}
        </div>
      </div>
    );
  }

  return (
    <img
      src={p.src}
      alt={p.alt ?? ''}
      style={{
        width: '100%',
        height: '100%',
        objectFit: p.objectFit ?? 'cover',
        display: 'block',
        borderRadius: radius,
        border,
        opacity,
        mixBlendMode: p.removeBackground ? 'multiply' : undefined,
      }}
    />
  );
}
