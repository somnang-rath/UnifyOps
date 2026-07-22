'use client';
import * as React from 'react';
import { Check, ImageOff, Search } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  InputWithIcon,
  Modal,
  Skeleton,
  Spinner,
} from '@prism/ui';
import { useDebounce } from '@/hooks/use-debounce';
import { usePublicInstance } from '@/hooks/use-public-instance';
import {
  triggerUnsplashDownload,
  useUnsplashSearch,
  type UnsplashPhoto,
} from '@/hooks/use-unsplash';
import { cn } from '@/lib/utils';

const UNSPLASH_HOME =
  'https://unsplash.com/?utm_source=prism&utm_medium=referral';

/** Opening the modal shows photos immediately instead of an empty grid. */
const DEFAULT_QUERY = 'wallpapers';

export interface CoverImagePickerProps {
  open: boolean;
  onClose: () => void;
  /** Current cover URL — marks the matching tile as selected. */
  value?: string | null;
  /** Receives `urls.regular`. The parent owns the PATCH; the picker only
   *  fires the download trigger and closes. */
  onSelect: (url: string) => void;
}

/**
 * Unsplash cover picker (docs/plan/05-cover-image-picker.md §3).
 * Presentational — no project/wiki ids; parents wire the mutation.
 */
export function CoverImagePicker({
  open,
  onClose,
  value,
  onSelect,
}: CoverImagePickerProps) {
  const [input, setInput] = React.useState('');
  const debounced = useDebounce(input, 350);
  const query = debounced.trim() || DEFAULT_QUERY;

  const { data: instance } = usePublicInstance();
  // Effective boolean (ADR 0010 §1) — the client never learns why it's off.
  const instanceEnabled = instance?.config.UNSPLASH_ENABLED === true;

  const search = useUnsplashSearch(query, {
    enabled: open && instanceEnabled,
  });

  const pages = search.data?.pages;
  const photos = React.useMemo(
    () => pages?.flatMap((p) => p.results) ?? [],
    [pages],
  );
  // Belt-and-braces gate (ADR 0010 §6): instance boolean off, or the search
  // itself reported configured:false (toggle flipped mid-session).
  const notConfigured =
    !instanceEnabled || (pages ? pages[0].configured === false : false);

  const select = (photo: UnsplashPhoto) => {
    // Compliance ping — fire-and-forget, never awaited (ADR 0010 §4).
    triggerUnsplashDownload(photo.downloadLocation);
    onSelect(photo.urls.regular);
    onClose();
  };

  const initialLoading = search.isLoading;
  const initialError = search.isError && !pages;
  const appendError = search.isError && !!pages;

  return (
    <Modal open={open} onClose={onClose} title="Choose cover" size="md">
      <div className="flex flex-col gap-3">
        {!notConfigured && (
          <InputWithIcon
            icon={<Search />}
            autoFocus
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search Unsplash…"
            aria-label="Search Unsplash photos"
          />
        )}

        {notConfigured ? (
          <EmptyState
            icon={<ImageOff />}
            label="Unsplash is not configured"
            hint="Ask your instance admin to enable it in God Mode → Images."
          />
        ) : initialLoading ? (
          <div className="grid grid-cols-3 gap-2 max-h-[340px] overflow-y-auto">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/2] rounded-md" />
            ))}
          </div>
        ) : initialError ? (
          <ErrorState
            message="Unsplash didn’t respond — try again."
            onRetry={() => void search.refetch()}
          />
        ) : photos.length === 0 ? (
          <EmptyState
            icon={<ImageOff />}
            label={`No photos for "${query}"`}
            hint="Try a different search."
          />
        ) : (
          <div className="max-h-[340px] overflow-y-auto flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  selected={value === photo.urls.regular}
                  onSelect={() => select(photo)}
                />
              ))}
            </div>
            {appendError && (
              <p className="text-2xs text-red text-center">
                Couldn’t load more.{' '}
                <button
                  type="button"
                  onClick={() => void search.fetchNextPage()}
                  className="underline underline-offset-2 hover:text-red"
                >
                  Retry
                </button>
              </p>
            )}
            {search.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                full
                disabled={search.isFetchingNextPage}
                onClick={() => void search.fetchNextPage()}
              >
                {search.isFetchingNextPage && <Spinner size={12} />}
                Load more
              </Button>
            )}
          </div>
        )}

        {/* Footer attribution — Unsplash guideline (ADR 0010 §4). */}
        <p className="text-2xs text-text-muted pt-2 border-t border-border">
          Photos from{' '}
          <a
            href={UNSPLASH_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Unsplash
          </a>
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------- Photo tile ------------------------------- */

function PhotoTile({
  photo,
  selected,
  onSelect,
}: {
  photo: UnsplashPhoto;
  selected: boolean;
  onSelect: () => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className={cn(
        'relative group rounded-md overflow-hidden',
        selected && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-card',
      )}
      // Dominant color paints before the image loads.
      style={{ background: photo.color ?? 'var(--bg-subtle)' }}
    >
      <button
        type="button"
        aria-label={`Photo by ${photo.user.name}`}
        onClick={onSelect}
        className="block w-full aspect-[3/2] group-hover:ring-1 group-hover:ring-inset group-hover:ring-white/20"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked Unsplash URL, no optimizer (ADR 0010 §3) */}
        <img
          src={photo.urls.small}
          alt={photo.alt ?? ''}
          loading="lazy"
          draggable={false}
          className="w-full h-full object-cover"
        />
      </button>
      {selected && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center"
        >
          <Check className="w-3.5 h-3.5" />
        </span>
      )}
      {/* Attribution scrim — sibling of the button (no link-in-button nesting). */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 px-1.5 py-1 text-[10px] text-white truncate',
          'bg-gradient-to-t from-black/60 to-transparent',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          'transition-opacity duration-[var(--dur)]',
        )}
      >
        Photo by{' '}
        <a
          href={photo.user.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className="underline-offset-2 hover:underline"
        >
          {photo.user.name}
        </a>{' '}
        on{' '}
        <a
          href={UNSPLASH_HOME}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className="underline-offset-2 hover:underline"
        >
          Unsplash
        </a>
      </div>
    </div>
  );
}
