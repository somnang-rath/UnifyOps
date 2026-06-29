'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pencil, Trash2 } from 'lucide-react';
import { rangeLabel } from '@/lib/sheets/chart-data';
import type { Sheet, SheetChart } from '@/schemas/workbook';
import { ChartView } from './chart-view';

interface Props {
  sheet: Sheet;
  computed: Record<string, unknown>;
  readOnly: boolean;
  onEdit: (chart: SheetChart) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
}

const MIN_W = 220;
const MIN_H = 160;

export function ChartOverlay({
  sheet,
  computed,
  readOnly,
  onEdit,
  onRemove,
  onMove,
}: Props) {
  const charts = sheet.charts ?? [];
  const [drag, setDrag] = useState<DragState | null>(null);
  // Live rect during a drag — avoids mutating the workbook on every pointermove.
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      setLive({
        x: Math.max(0, d.orig.x + dx),
        y: Math.max(0, d.orig.y + dy),
        w: d.orig.w,
        h: d.orig.h,
      });
    } else {
      setLive({
        x: d.orig.x,
        y: d.orig.y,
        w: Math.max(MIN_W, d.orig.w + dx),
        h: Math.max(MIN_H, d.orig.h + dy),
      });
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (d && live) onMove(d.id, live);
    setDrag(null);
    setLive(null);
  }, [live, onMove]);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [drag, onPointerMove, onPointerUp]);

  const startDrag = (
    e: React.PointerEvent,
    chart: SheetChart,
    mode: 'move' | 'resize',
  ) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setLive({ x: chart.x, y: chart.y, w: chart.w, h: chart.h });
    setDrag({
      id: chart.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: chart.x, y: chart.y, w: chart.w, h: chart.h },
    });
  };

  if (!charts.length) return null;

  return (
    <>
      {charts.map((chart) => {
        const rect =
          drag?.id === chart.id && live
            ? live
            : { x: chart.x, y: chart.y, w: chart.w, h: chart.h };
        const active = drag?.id === chart.id;
        return (
          <div
            key={chart.id}
            className="absolute z-20 bg-white border border-[#dadce0] rounded-lg shadow-lg flex flex-col group/chart"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              boxShadow: active
                ? '0 0 0 2px var(--a), 0 8px 24px rgba(0,0,0,.18)'
                : undefined,
            }}
          >
            {/* Header / drag handle */}
            <div
              className="flex items-center gap-2 px-2.5 h-8 border-b border-[#eee] cursor-move select-none shrink-0"
              onPointerDown={(e) => startDrag(e, chart, 'move')}
            >
              <span className="flex-1 truncate text-[12px] font-medium text-text">
                {chart.title || 'Chart'}
              </span>
              <span className="text-[10px] text-text-muted font-mono shrink-0">
                {rangeLabel(chart)}
              </span>
              {!readOnly && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/chart:opacity-100 transition-opacity shrink-0">
                  <button
                    title="Download as PNG"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => downloadChartPng(chart.id, chart.title)}
                    className="p-1 rounded text-text-muted hover:text-text hover:bg-bg-hover"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    title="Edit chart"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onEdit(chart)}
                    className="p-1 rounded text-text-muted hover:text-text hover:bg-bg-hover"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    title="Delete chart"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onRemove(chart.id)}
                    className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-bg-hover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Chart body */}
            <div className="flex-1 min-h-0 p-2" data-chart-body={chart.id}>
              <ChartView sheet={sheet} computed={computed} chart={chart} />
            </div>

            {/* Resize handle */}
            {!readOnly && (
              <div
                className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
                onPointerDown={(e) => startDrag(e, chart, 'resize')}
                style={{
                  background:
                    'linear-gradient(135deg, transparent 50%, #bbb 50%, #bbb 60%, transparent 60%, transparent 70%, #bbb 70%, #bbb 80%, transparent 80%)',
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Serialise the chart's rendered SVG to a PNG and trigger a download.
 * Best-effort: silently no-ops if the SVG can't be found or the canvas
 * export is blocked.
 */
function downloadChartPng(chartId: string, title?: string) {
  const host = document.querySelector<HTMLElement>(`[data-chart-body="${chartId}"]`);
  const svg = host?.querySelector('svg');
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const scale = 2; // export at 2x for crisp output
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(title || 'chart').replace(/[^\w-]+/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
