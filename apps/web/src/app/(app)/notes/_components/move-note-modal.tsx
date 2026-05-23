'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Folder as FolderIcon,
  Home,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useNoteFolders, useNoteMutations } from '@/hooks/use-notes';
import { cn } from '@/lib/utils';
import type { Note, NoteFolder } from '@/schemas/note';

export function MoveNoteModal({
  note,
  onClose,
}: {
  note: Note | null;
  onClose: () => void;
}) {
  const { data: folders = [] } = useNoteFolders();
  const { update } = useNoteMutations();
  const [target, setTarget] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const isOpen = !!note;
  const currentFolderId = note?.folderId ?? null;

  useEffect(() => {
    if (note) setTarget(note.folderId ?? null);
  }, [note]);

  const byParent = useMemo(() => {
    const m = new Map<string | 'root', NoteFolder[]>();
    folders.forEach((f) => {
      const k = (f.parentId ?? 'root') as string | 'root';
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return m;
  }, [folders]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const close = () => {
    setTarget(null);
    onClose();
  };

  const submit = () => {
    if (!note) return;
    if (target === (note.folderId ?? null)) {
      close();
      return;
    }
    update.mutate({ id: note._id, body: { folderId: target } });
    close();
  };

  const renderNode = (f: NoteFolder, depth: number): React.ReactNode => {
    const kids = byParent.get(f._id) ?? [];
    const isOpen = !collapsed.has(f._id);
    const isSel = target === f._id;

    return (
      <div key={f._id}>
        <button
          type="button"
          onClick={() => setTarget(f._id)}
          className={cn(
            'w-full flex items-center gap-1.5 py-1.5 pr-2 text-[13px] text-left transition-colors hover:bg-bg-hover',
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
          {isSel && <Check className="w-3.5 h-3.5" />}
        </button>
        {isOpen && kids.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  const roots = byParent.get('root') ?? [];

  return (
    <Modal
      open={isOpen}
      onClose={close}
      size="sm"
      title={note ? `Move “${note.title || 'Untitled'}”` : 'Move note'}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={target === (note?.folderId ?? null)}
            onClick={submit}
          >
            Move
          </Button>
        </>
      }
    >
      <div className="border border-border rounded-md bg-bg-card max-h-[360px] overflow-y-auto">
        <button
          type="button"
          onClick={() => setTarget(null)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors hover:bg-bg-hover border-b border-border',
            target === null &&
              'bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent',
          )}
        >
          <Home className="w-3.5 h-3.5 text-accent" />
          <span className="flex-1 min-w-0 truncate">Root (no folder)</span>
          {currentFolderId === null && (
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              current
            </span>
          )}
          {target === null && currentFolderId !== null && (
            <Check className="w-3.5 h-3.5" />
          )}
        </button>
        {roots.map((f) => renderNode(f, 0))}
        {folders.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-text-muted">
            No folders yet. Create one from the sidebar.
          </p>
        )}
      </div>
    </Modal>
  );
}
