'use client';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toast-store';

/**
 * The read-only-input + Copy + ExternalLink cluster shared by the
 * PublishControl popover and the project-settings "Publish to Space" card
 * (publish-to-space spec §2.1/§2.3). Markup lifted verbatim from the wiki
 * publish popover so the affordance stays identical everywhere.
 */
export function PublicLinkRow({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const copy = () => {
    if (!url) return;
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast('Link copied', 'success'))
      .catch(() => toast('Could not copy link', 'error'));
  };

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 bg-bg-subtle border border-border rounded-sm px-2 py-1.5 text-[12px] text-text-sub outline-none"
      />
      <Button size="sm" variant="outline" onClick={copy} title="Copy link">
        <Copy className="w-3.5 h-3.5" />
      </Button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title="Open in Space"
        className="inline-flex items-center justify-center w-8 h-8 rounded-sm border border-border text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
