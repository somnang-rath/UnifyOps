'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { useProject, useProjectMutations } from '@/hooks/use-projects';
import { usePublicInstance } from '@/hooks/use-public-instance';
import { useAuthStore } from '@/stores/auth-store';
import {
  AddCoverButton,
  CoverBanner,
} from '@/components/feature/cover/cover-banner';
import { CoverImagePicker } from '@/components/feature/cover/cover-image-picker';
import { BlockEditor } from './_components/block-editor';
import type { NoteBlock } from '@/schemas/note';
import { cn } from '@/lib/utils';

const AUTOSAVE_MS = 1200;
const emptyDoc = (): NoteBlock[] => [{ type: 'text', value: '' }];

export default function ProjectOverviewPage() {
  const id = useParams<{ id: string }>().id;
  const { data: project } = useProject(id);
  const { updateOverview, update } = useProjectMutations();
  const me = useAuthStore((s) => s.user);
  const { data: instance } = usePublicInstance();

  // Cover affordances (ADR 0010). `canEditCover` mirrors the actual
  // PATCH /projects/:id guard, which is owner-only (projects.service.update
  // throws Forbidden for anyone else — members and role-admins included), so
  // we never offer an action that would 403.
  const unsplashEnabled = instance?.config.UNSPLASH_ENABLED === true;
  const canEditCover = !!me && !!project && me.id === project.ownerId;
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const setCover = (coverImage: string | null) => {
    if (project) update.mutate({ id: project._id, body: { coverImage } });
  };

  const [blocks, setBlocks] = useState<NoteBlock[]>(emptyDoc);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which project's overview is currently loaded so we only hydrate once
  // per project (and don't clobber unsaved edits when the query refetches).
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!project) return;
    if (loadedFor.current === project._id) return;
    loadedFor.current = project._id;
    setBlocks(project.overview?.length ? project.overview : emptyDoc());
    setDirty(false);
  }, [project]);

  const save = () => {
    if (!project) return;
    updateOverview.mutate({ id: project._id, overview: blocks });
    setDirty(false);
  };

  // Debounced autosave once the doc is dirty.
  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, dirty]);

  const onDirty = () => setDirty(true);

  const saving = updateOverview.isPending;

  return (
    <div className="max-w-[820px] mx-auto group/ovh">
      {project?.coverImage && (
        <CoverBanner
          src={project.coverImage}
          fallbackColor={project.color}
          canEdit={canEditCover}
          unsplashEnabled={unsplashEnabled}
          onChange={() => setCoverPickerOpen(true)}
          onRemove={() => setCover(null)}
          className="mb-4"
        />
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-text">Overview</h2>
        <div className="flex items-center gap-2">
          {/* Hover-reveal (§5.2): quiet chrome; settings row is the
              discoverable path on touch devices. */}
          {unsplashEnabled && canEditCover && !project?.coverImage && (
            <AddCoverButton
              onClick={() => setCoverPickerOpen(true)}
              className="opacity-0 group-hover/ovh:opacity-100 focus-visible:opacity-100"
            />
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[12px]',
              saving ? 'text-text-muted' : dirty ? 'text-amber' : 'text-green',
            )}
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
              </>
            ) : dirty ? (
              'Unsaved changes'
            ) : (
              <>
                <Check className="w-3.5 h-3.5" /> Saved
              </>
            )}
          </span>
        </div>
      </div>

      <BlockEditor blocks={blocks} setBlocks={setBlocks} onDirty={onDirty} />

      <CoverImagePicker
        open={coverPickerOpen}
        onClose={() => setCoverPickerOpen(false)}
        value={project?.coverImage ?? null}
        onSelect={(url) => setCover(url)}
      />
    </div>
  );
}
