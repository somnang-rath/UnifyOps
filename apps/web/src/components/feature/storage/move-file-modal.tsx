'use client';
import { useMemo, useState } from 'react';
import { ChevronRight, Folder as FolderIcon, Home, Users } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useFileMutations, useFolders } from '@/hooks/use-files';
import { cn } from '@/lib/utils';
import type { AccessLevel, FileItem, Folder } from '@/schemas/file';

const canWriteHere = (a?: AccessLevel) =>
  a === 'owner' || a === 'edit' || a === 'upload';

export function MoveFileModal({
  file,
  onClose,
}: {
  file: FileItem | null;
  onClose: () => void;
}) {
  const { data: folders = [] } = useFolders();
  const { move } = useFileMutations();
  const [target, setTarget] = useState<string | null>(null);

  const isOpen = !!file;
  const close = () => {
    setTarget(null);
    onClose();
  };

  const own = useMemo(
    () => folders.filter((f) => f._access === 'owner'),
    [folders],
  );
  const shared = useMemo(
    () => folders.filter((f) => f._access && f._access !== 'owner'),
    [folders],
  );

  const submit = () => {
    if (!file) return;
    if (target === file.folderId) {
      close();
      return;
    }
    move.mutate({ id: file._id, folderId: target });
    close();
  };

  return (
    <Modal
      open={isOpen}
      onClose={close}
      size="sm"
      title={file ? `Move “${file.name}”` : 'Move file'}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={target === (file?.folderId ?? null)}
            onClick={submit}
          >
            Move
          </Button>
        </>
      }
    >
      {file && (
        <div className="space-y-2">
          <p className="text-[12px] text-text-muted">
            Choose a destination folder.
          </p>
          <div className="border border-border rounded-md bg-bg-card max-h-[320px] overflow-y-auto">
            <RootRow
              label="My files (root)"
              selected={target === null}
              onSelect={() => setTarget(null)}
              currentFolderId={file.folderId}
            />
            <FolderList
              folders={own}
              rootKey="root"
              currentFolderId={file.folderId}
              target={target}
              onSelect={setTarget}
            />
            {shared.length > 0 && (
              <>
                <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-text-muted border-t border-border bg-bg-subtle/40">
                  <Users className="w-3 h-3" />
                  Shared with me
                </div>
                <FolderList
                  folders={shared}
                  rootKey="shared-root"
                  currentFolderId={file.folderId}
                  target={target}
                  onSelect={setTarget}
                />
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function RootRow({
  label,
  selected,
  onSelect,
  currentFolderId,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  currentFolderId: string | null;
}) {
  const isCurrent = currentFolderId === null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors hover:bg-bg-hover border-b border-border',
        selected &&
          'bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent',
      )}
    >
      <Home className="w-3.5 h-3.5 text-accent" />
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {isCurrent && (
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          current
        </span>
      )}
    </button>
  );
}

function FolderList({
  folders,
  rootKey,
  currentFolderId,
  target,
  onSelect,
}: {
  folders: Folder[];
  rootKey: 'root' | 'shared-root';
  currentFolderId: string | null;
  target: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const byParent = useMemo(() => {
    const visible = new Set(folders.map((f) => f._id));
    const m = new Map<string | 'root' | 'shared-root', Folder[]>();
    folders.forEach((f) => {
      const parentVisible = f.parentId && visible.has(f.parentId);
      const k = parentVisible ? (f.parentId as string) : rootKey;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [folders, rootKey]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const render = (f: Folder, depth: number): React.ReactNode => {
    const kids = byParent.get(f._id) ?? [];
    const isOpen = !collapsed.has(f._id);
    const isCurrent = currentFolderId === f._id;
    const writable = canWriteHere(f._access);
    const isSel = target === f._id;

    return (
      <div key={f._id}>
        <button
          type="button"
          disabled={!writable || isCurrent}
          onClick={() => writable && !isCurrent && onSelect(f._id)}
          className={cn(
            'w-full flex items-center gap-1.5 py-1.5 pr-2 text-[13px] text-left transition-colors',
            'hover:bg-bg-hover',
            'disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            isSel &&
              'bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {kids.length > 0 ? (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(f._id);
              }}
              className="p-0.5 rounded-sm hover:bg-bg-hover/60 cursor-pointer"
            >
              <ChevronRight
                className={cn(
                  'w-3 h-3 transition-transform',
                  isOpen && 'rotate-90',
                )}
              />
            </span>
          ) : (
            <span className="w-3 h-3 inline-block" />
          )}
          <FolderIcon className="w-3.5 h-3.5 text-accent" />
          <span className="flex-1 min-w-0 truncate">{f.name}</span>
          {isCurrent && (
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              current
            </span>
          )}
          {!writable && !isCurrent && (
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              read-only
            </span>
          )}
        </button>
        {isOpen && kids.map((c) => render(c, depth + 1))}
      </div>
    );
  };

  const roots = byParent.get(rootKey) ?? [];
  return <>{roots.map((f) => render(f, 0))}</>;
}
