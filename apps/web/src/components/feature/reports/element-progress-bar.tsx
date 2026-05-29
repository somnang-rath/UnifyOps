'use client';
import type { ReportElement } from '@/schemas/report';

interface Props { element: ReportElement }

export function ElementProgressBar({ element }: Props) {
  const p = element.props as {
    label?: string;
    value?: number;
    maxValue?: number;
    color?: string;
    trackColor?: string;
    barHeight?: number;
    showValue?: boolean;
    rounded?: boolean;
    labelColor?: string;
    fontSize?: number;
    background?: string;
    fontFamily?: string;
  };

  const value   = p.value   ?? 0;
  const max     = p.maxValue ?? 100;
  const pct     = Math.min(100, Math.max(0, max > 0 ? (value / max) * 100 : 0));
  const color   = p.color   ?? '#6366f1';
  const barH    = p.barHeight ?? 12;
  const rounded = p.rounded !== false;
  const radius  = rounded ? barH / 2 : 2;

  return (
    <div
      className="w-full h-full flex flex-col justify-center"
      style={{
        padding: '6px 10px',
        background: p.background ?? 'transparent',
        gap: 6,
        fontFamily: p.fontFamily ?? 'inherit',
      }}
    >
      {/* Label + percentage row */}
      {(p.label !== undefined || p.showValue) && (
        <div className="flex items-center justify-between" style={{ fontSize: p.fontSize ?? 11 }}>
          {p.label !== undefined && (
            <span style={{ color: p.labelColor ?? 'var(--text-sub)', fontWeight: 500, lineHeight: 1 }}>
              {p.label || 'Progress'}
            </span>
          )}
          {p.showValue && (
            <span style={{ color, fontWeight: 700, marginLeft: 'auto', lineHeight: 1 }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}

      {/* Track */}
      <div
        style={{
          width: '100%',
          height: barH,
          background: p.trackColor ?? 'color-mix(in srgb, var(--text) 10%, transparent)',
          borderRadius: radius,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Fill */}
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: radius,
          }}
        />
      </div>
    </div>
  );
}
