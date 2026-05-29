'use client';
import type { ReportElement } from '@/schemas/report';

interface Props { element: ReportElement }

export function ElementDivider({ element }: Props) {
  const p = element.props as {
    color?: string;
    thickness?: number;
    style?: 'solid' | 'dashed' | 'dotted';
    label?: string;
  };

  const color     = p.color ?? '#e5e7eb';
  const thickness = p.thickness ?? 1;
  const lineStyle = p.style ?? 'solid';

  const lineEl = (
    <div
      style={{
        flex: 1,
        height: lineStyle === 'solid' ? thickness : 0,
        background: lineStyle === 'solid' ? color : undefined,
        borderTop: lineStyle !== 'solid' ? `${thickness}px ${lineStyle} ${color}` : undefined,
      }}
    />
  );

  if (p.label) {
    return (
      <div className="w-full h-full flex items-center gap-3">
        {lineEl}
        <span style={{ color, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {p.label}
        </span>
        {lineEl}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center">
      {lineEl}
    </div>
  );
}
