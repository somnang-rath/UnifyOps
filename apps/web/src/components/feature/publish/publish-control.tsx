'use client';
import { useEffect, useRef, useState } from 'react';
import { CloudOff, Globe, Loader2 } from 'lucide-react';
import { Tooltip } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PublicLinkRow } from './public-link-row';

export interface PublishControlProps {
  /** Current state. anchor must be set when published is true. */
  published: boolean;
  anchor: string | null;
  /** NEXT_PUBLIC_SPACE_URL; '' shows the "set the env var" hint (wiki behavior). */
  spaceUrl: string;
  pending: boolean; // publish/unpublish mutation in flight
  onPublish: () => void;
  onUnpublish: () => void;
  /** Renders the trigger disabled with a Tooltip (v1 workspace-view case). */
  disabled?: boolean;
  disabledReason?: string;
  size?: 'sm'; // default 'sm', matches wiki
  className?: string;
}

/**
 * Publish-to-Space control (publish-to-space spec §2.1), extracted from the
 * wiki page's inline PublishControl and reused by wiki, ViewsBar and project
 * settings. Stays in apps/web: it depends on the web toast store + clipboard
 * flow. Presentational otherwise — mutations stay with callers.
 */
export function PublishControl({
  published,
  anchor,
  spaceUrl,
  pending,
  onPublish,
  onUnpublish,
  disabled,
  disabledReason,
  size = 'sm',
  className,
}: PublishControlProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const isPublic = published && !!anchor;
  // Space serves published content under its /spaces base path (ADR 0002 §5).
  const url = isPublic && spaceUrl ? `${spaceUrl}/spaces/${anchor}` : '';

  if (disabled) {
    // CSS-only Tooltip shows on focus too, so keyboard users get the reason.
    return (
      <Tooltip label={disabledReason ?? 'Publishing unavailable'}>
        <Button size={size} variant="outline" disabled className={className}>
          <Globe className="w-3.5 h-3.5" />
          Publish
        </Button>
      </Tooltip>
    );
  }

  if (!isPublic) {
    return (
      <Button
        size={size}
        variant="outline"
        onClick={onPublish}
        disabled={pending}
        className={className}
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Globe className="w-3.5 h-3.5" />
        )}
        Publish
      </Button>
    );
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <Button
        size={size}
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="text-green"
      >
        <Globe className="w-3.5 h-3.5" /> Public
      </Button>
      <div
        className={cn(
          'absolute right-0 top-full mt-2 w-[320px] z-30 origin-top-right',
          'bg-[color:color-mix(in_srgb,var(--bg-card)_94%,transparent)] backdrop-blur-2xl',
          'border border-border rounded-lg shadow-xl p-3',
          open ? 'animate-popover-in' : 'hidden',
        )}
      >
        <p className="text-[11px] font-bold uppercase tracking-[.08em] text-text-muted mb-2">
          Public link
        </p>
        {spaceUrl ? (
          <PublicLinkRow url={url} className="mb-2.5" />
        ) : (
          <p className="text-[12px] text-text-muted mb-2.5">
            Set <code>NEXT_PUBLIC_SPACE_URL</code> to show the shareable link.
          </p>
        )}
        <Button
          size={size}
          variant="outline"
          onClick={() => {
            onUnpublish();
            setOpen(false);
          }}
          disabled={pending}
          className="w-full justify-center text-red"
        >
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CloudOff className="w-3.5 h-3.5" />
          )}
          Unpublish
        </Button>
      </div>
    </div>
  );
}
