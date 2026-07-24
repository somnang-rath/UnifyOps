'use client';
import { useState } from 'react';
import { Switch } from '@prism/ui';
import { Confirm } from '@/components/ui/confirm';
import { PublicLinkRow } from '@/components/feature/publish/public-link-row';
import { useProjectPublish } from '@/hooks/use-projects';
import type { Project } from '@/schemas/project';

// Public Space origin — used to build the shareable link (ADR 0002 §6).
const SPACE_URL = process.env.NEXT_PUBLIC_SPACE_URL ?? '';

/**
 * "Publish to Space" card in project settings (publish-to-space spec §2.3).
 * Rendered owner-only by the caller — publishing is a project PATCH-level
 * write (ADR 0012 §4). Turning on publishes immediately (same as wiki);
 * turning off confirms, because it breaks a shared URL. No optimistic
 * update — the Switch flips on success.
 */
export function PublishSection({ project }: { project: Project }) {
  const pub = useProjectPublish(project._id);
  const [confirmingOff, setConfirmingOff] = useState(false);

  const pending = pub.publish.isPending || pub.unpublish.isPending;
  const published = !!project.isPublic && !!project.anchor;
  const url = published && SPACE_URL ? `${SPACE_URL}/spaces/${project.anchor}` : '';

  const toggle = (next: boolean) => {
    if (pending) return;
    if (next) pub.publish.mutate();
    else setConfirmingOff(true);
  };

  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">Publish to Space</h2>
      <div className="bg-bg-card border border-border rounded-lg px-4 py-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="text-[13px] font-semibold">Public board</div>
          <Switch
            checked={published}
            onCheckedChange={toggle}
            disabled={pending}
            aria-label="Publish project to Space"
          />
        </div>
        {/* Mandatory privacy copy — the user-facing promise matching the
            public issue projection (ADR 0012 §5). */}
        <p className="text-[12px] text-text-muted mt-1">
          Anyone with the link can view this project&rsquo;s work items —
          titles, status, priority, labels and due dates only. No assignees,
          comments or descriptions.
        </p>
        {published && (
          <div className="mt-3 pt-3 border-t border-border">
            {SPACE_URL ? (
              <PublicLinkRow url={url} />
            ) : (
              <p className="text-[12px] text-text-muted">
                Set <code>NEXT_PUBLIC_SPACE_URL</code> to show the shareable
                link.
              </p>
            )}
          </div>
        )}
      </div>

      <Confirm
        open={confirmingOff}
        title="Unpublish project"
        body="Unpublish project — the public link will stop working."
        onConfirm={() => pub.unpublish.mutate()}
        onClose={() => setConfirmingOff(false)}
      />
    </section>
  );
}
