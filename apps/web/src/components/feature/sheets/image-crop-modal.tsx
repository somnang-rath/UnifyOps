'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  src: string;
  onApply: (newSrc: string) => void;
  onClose: () => void;
  /** Lock crop to 1:1 square (ideal for circular avatars) */
  squareLock?: boolean;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se';
type DragMode = Handle | 'move' | null;

interface Crop {
  // In natural-image coordinates
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_DISPLAY = 560;

export function ImageCropModal({ src, onApply, onClose, squareLock }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startMouse: { x: number; y: number };
    startCrop: Crop;
  } | null>(null);
  const [, force] = useState(0);

  // Initialize crop once we know the image's natural dimensions.
  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    setNatural({ w: nw, h: nh });
    if (squareLock) {
      const side = Math.min(nw, nh);
      setCrop({ x: Math.floor((nw - side) / 2), y: Math.floor((nh - side) / 2), w: side, h: side });
    } else {
      setCrop({ x: 0, y: 0, w: nw, h: nh });
    }
  };

  // The display scale shrinks the image so the longest edge fits MAX_DISPLAY.
  const scale = natural
    ? Math.min(1, MAX_DISPLAY / Math.max(natural.w, natural.h))
    : 1;

  const startDrag = useCallback(
    (mode: DragMode, ev: React.MouseEvent) => {
      if (!crop) return;
      ev.preventDefault();
      ev.stopPropagation();
      dragRef.current = {
        mode,
        startMouse: { x: ev.clientX, y: ev.clientY },
        startCrop: { ...crop },
      };
    },
    [crop],
  );

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !natural) return;
      const dx = (ev.clientX - d.startMouse.x) / scale;
      const dy = (ev.clientY - d.startMouse.y) / scale;
      const c = d.startCrop;
      const minSize = 8;
      let nx = c.x;
      let ny = c.y;
      let nw = c.w;
      let nh = c.h;
      switch (d.mode) {
        case 'move':
          nx = clamp(c.x + dx, 0, natural.w - c.w);
          ny = clamp(c.y + dy, 0, natural.h - c.h);
          break;
        case 'se': {
          if (squareLock) {
            const side = clamp(Math.min(c.w + dx, c.h + dy), minSize, Math.min(natural.w - c.x, natural.h - c.y));
            nw = nh = side;
          } else {
            nw = clamp(c.w + dx, minSize, natural.w - c.x);
            nh = clamp(c.h + dy, minSize, natural.h - c.y);
          }
          break;
        }
        case 'sw': {
          if (squareLock) {
            const side = clamp(Math.min(c.w - dx, c.h + dy), minSize, Math.min(c.x + c.w, natural.h - c.y));
            nw = nh = side;
            nx = c.x + c.w - nw;
          } else {
            const newX = clamp(c.x + dx, 0, c.x + c.w - minSize);
            nw = c.w - (newX - c.x);
            nx = newX;
            nh = clamp(c.h + dy, minSize, natural.h - c.y);
          }
          break;
        }
        case 'ne': {
          if (squareLock) {
            const side = clamp(Math.min(c.w + dx, c.h - dy), minSize, Math.min(natural.w - c.x, c.y + c.h));
            nw = nh = side;
            ny = c.y + c.h - nh;
          } else {
            nw = clamp(c.w + dx, minSize, natural.w - c.x);
            const newY = clamp(c.y + dy, 0, c.y + c.h - minSize);
            nh = c.h - (newY - c.y);
            ny = newY;
          }
          break;
        }
        case 'nw': {
          if (squareLock) {
            const side = clamp(Math.min(c.w - dx, c.h - dy), minSize, Math.min(c.x + c.w, c.y + c.h));
            nw = nh = side;
            nx = c.x + c.w - nw;
            ny = c.y + c.h - nh;
          } else {
            const newX = clamp(c.x + dx, 0, c.x + c.w - minSize);
            const newY = clamp(c.y + dy, 0, c.y + c.h - minSize);
            nw = c.w - (newX - c.x);
            nh = c.h - (newY - c.y);
            nx = newX;
            ny = newY;
          }
          break;
        }
      }
      setCrop({ x: nx, y: ny, w: nw, h: nh });
    };
    const onUp = () => {
      dragRef.current = null;
      force((v) => v + 1);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [scale, natural]);

  const apply = () => {
    if (!natural || !crop) return;
    const img = imgRef.current;
    if (!img) return;
    const cw = Math.round(crop.w);
    const ch = Math.round(crop.h);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (squareLock) {
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
    const out = canvas.toDataURL('image/png');
    onApply(out);
  };

  const reset = () => {
    if (!natural) return;
    if (squareLock) {
      const side = Math.min(natural.w, natural.h);
      setCrop({ x: Math.floor((natural.w - side) / 2), y: Math.floor((natural.h - side) / 2), w: side, h: side });
    } else {
      setCrop({ x: 0, y: 0, w: natural.w, h: natural.h });
    }
  };

  // Display-space rectangle for overlay positioning
  const cropDisp = crop && natural
    ? {
        x: crop.x * scale,
        y: crop.y * scale,
        w: crop.w * scale,
        h: crop.h * scale,
      }
    : null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-bg-card rounded-lg shadow-xl p-5 max-w-[640px] w-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-semibold">{squareLock ? 'Crop profile photo' : 'Crop image'}</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-[20px] leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          className="relative inline-block select-none bg-[#0e0e0e]"
          style={{
            width: natural ? natural.w * scale : MAX_DISPLAY,
            height: natural ? natural.h * scale : MAX_DISPLAY * 0.6,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt=""
            onLoad={onImgLoad}
            draggable={false}
            style={{
              width: natural ? natural.w * scale : 'auto',
              height: natural ? natural.h * scale : 'auto',
              display: 'block',
            }}
          />

          {cropDisp && (
            <>
              {/* Dimming overlay outside crop rect: four rectangles */}
              <div
                className="absolute bg-black/55 pointer-events-none"
                style={{ left: 0, top: 0, width: '100%', height: cropDisp.y }}
              />
              <div
                className="absolute bg-black/55 pointer-events-none"
                style={{
                  left: 0,
                  top: cropDisp.y + cropDisp.h,
                  width: '100%',
                  height: `calc(100% - ${cropDisp.y + cropDisp.h}px)`,
                }}
              />
              <div
                className="absolute bg-black/55 pointer-events-none"
                style={{
                  left: 0,
                  top: cropDisp.y,
                  width: cropDisp.x,
                  height: cropDisp.h,
                }}
              />
              <div
                className="absolute bg-black/55 pointer-events-none"
                style={{
                  left: cropDisp.x + cropDisp.w,
                  top: cropDisp.y,
                  width: `calc(100% - ${cropDisp.x + cropDisp.w}px)`,
                  height: cropDisp.h,
                }}
              />

              {/* Crop rectangle with move-cursor and handles */}
              <div
                onMouseDown={(ev) => startDrag('move', ev)}
                className="absolute border-2 border-white cursor-move"
                style={{
                  left: cropDisp.x,
                  top: cropDisp.y,
                  width: cropDisp.w,
                  height: cropDisp.h,
                }}
              >
                {squareLock && (
                  <div className="absolute inset-0 rounded-full border-[3px] border-dashed border-white/90 pointer-events-none" />
                )}
                <Handle position="nw" onMouseDown={(ev) => startDrag('nw', ev)} />
                <Handle position="ne" onMouseDown={(ev) => startDrag('ne', ev)} />
                <Handle position="sw" onMouseDown={(ev) => startDrag('sw', ev)} />
                <Handle position="se" onMouseDown={(ev) => startDrag('se', ev)} />
              </div>
            </>
          )}
        </div>

        {natural && crop && (
          <div className="text-[11px] text-text-muted mt-2">
            {squareLock ? `${Math.round(crop.w)} × ${Math.round(crop.h)} px (circle)` : `${Math.round(crop.w)} × ${Math.round(crop.h)} px`}
            <span className="mx-2">·</span>
            from {natural.w} × {natural.h}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={reset}>
            Reset
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function Handle({
  position,
  onMouseDown,
}: {
  position: Handle;
  onMouseDown: (ev: React.MouseEvent) => void;
}) {
  const corner = {
    nw: 'top-[-6px] left-[-6px] cursor-nwse-resize',
    ne: 'top-[-6px] right-[-6px] cursor-nesw-resize',
    sw: 'bottom-[-6px] left-[-6px] cursor-nesw-resize',
    se: 'bottom-[-6px] right-[-6px] cursor-nwse-resize',
  }[position];
  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute w-3 h-3 bg-white border border-[#1a73e8] ${corner}`}
    />
  );
}
