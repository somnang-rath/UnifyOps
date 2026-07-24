'use client';
import * as React from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@prism/ui';
import { cn } from '@/lib/utils';

export interface CoverBannerProps {
  /** Cover URL; null renders nothing (no empty banner chrome). */
  src: string | null;
  /** Gradient base when the hotlinked image 404s — project color, usually. */
  fallbackColor?: string;
  /** false ⇒ display-only: no Change/Remove overlay at all. */
  canEdit: boolean;
  /** Gates "Change cover" only — Remove works with Unsplash off (§1). */
  unsplashEnabled: boolean;
  /** Open the picker. */
  onChange: () => void;
  /** Parent PATCHes { coverImage: null } — no confirm, it's reversible. */
  onRemove: () => void;
  className?: string;
}

/**
 * 4:1 cover banner (docs/plan/05-cover-image-picker.md §4). Hotlinked images
 * can die (ADR 0010 consequences) — a broken img swaps to a gradient so the
 * banner never collapses.
 */
export function CoverBanner({
  src,
  fallbackColor,
  canEdit,
  unsplashEnabled,
  onChange,
  onRemove,
  className,
}: CoverBannerProps) {
  const [broken, setBroken] = React.useState(false);
  // A new URL deserves a fresh attempt.
  React.useEffect(() => setBroken(false), [src]);

  if (!src) return null;

  const fallbackBg = fallbackColor
    ? `linear-gradient(135deg, ${fallbackColor}, color-mix(in srgb, ${fallbackColor} 40%, var(--bg-subtle)))`
    : 'var(--grad)';

  const overlayBtn = 'shadow-sm bg-bg-card/90 backdrop-blur-sm';

  return (
    <div
      className={cn(
        'relative group/cover w-full aspect-[4/1] max-h-[200px] min-h-[96px]',
        'rounded-lg overflow-hidden border border-border',
        className,
      )}
    >
      {broken ? (
        <div
          aria-hidden="true"
          className="w-full h-full"
          style={{ background: fallbackBg }}
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- hotlinked cover URL, no optimizer (ADR 0010 §3) */
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      )}
      {canEdit && (
        <div
          className={cn(
            'absolute bottom-2 right-2 flex gap-1.5',
            'opacity-0 group-hover/cover:opacity-100 focus-within:opacity-100',
            'transition-opacity duration-[var(--dur)]',
          )}
        >
          {unsplashEnabled && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onChange}
              className={overlayBtn}
            >
              <ImagePlus /> Change cover
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onRemove}
            className={overlayBtn}
          >
            <Trash2 /> Remove
          </Button>
        </div>
      )}
    </div>
  );
}

/** Ghost "Add cover" trigger when no cover exists — visibility is the
 *  parent's concern (§5/§6); this stays stateless. */
export function AddCoverButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn('text-text-muted hover:text-text', className)}
    >
      <ImagePlus className="w-3.5 h-3.5" /> Add cover
    </Button>
  );
}
