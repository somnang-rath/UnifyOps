'use client';
import type { ReportElement } from '@/schemas/report';

interface Props { element: ReportElement }

export function ElementShape({ element }: Props) {
  const p = element.props as {
    shape?: 'rect' | 'circle' | 'triangle' | 'line';
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    borderRadius?: number;
    opacity?: number;
    gradient?: boolean;
    gradientEnd?: string;
    gradientDir?: 'to right' | 'to bottom' | 'to bottom right';
    shadow?: boolean;
  };

  const fill    = p.fill ?? '#6366f1';
  const stroke  = p.stroke ?? 'transparent';
  const sw      = p.strokeWidth ?? 0;
  const opacity = p.opacity ?? 1;

  const bg = p.gradient
    ? `linear-gradient(${p.gradientDir ?? 'to right'}, ${fill}, ${p.gradientEnd ?? '#a855f7'})`
    : fill;

  const boxShadow = p.shadow
    ? `0 6px 24px color-mix(in srgb, ${fill} 45%, transparent)`
    : undefined;

  // Line — flex-centered horizontal bar
  if (p.shape === 'line') {
    const h = sw > 0 ? sw : 2;
    return (
      <div className="w-full h-full flex items-center">
        <div style={{ width: '100%', height: h, background: bg, borderRadius: h, opacity }} />
      </div>
    );
  }

  // Triangle — SVG so it scales perfectly with no overflow
  if (p.shape === 'triangle') {
    return (
      <div className="w-full h-full" style={{ opacity }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points="50,2 98,98 2,98"
            fill={fill}
            stroke={sw > 0 ? stroke : 'none'}
            strokeWidth={sw}
          />
        </svg>
      </div>
    );
  }

  // Rect / Circle
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: bg,
        borderRadius: p.shape === 'circle' ? '50%' : `${p.borderRadius ?? 4}px`,
        border: sw > 0 ? `${sw}px solid ${stroke}` : 'none',
        opacity,
        boxShadow,
      }}
    />
  );
}
