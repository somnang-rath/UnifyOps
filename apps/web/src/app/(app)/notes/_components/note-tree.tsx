"use client"
import { useMemo, useState } from "react"
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  Folder as FolderIcon,
  Move as MoveIcon,
  Pencil,
  Search,
  Share2,
  Star,
  Trash2,
  Users,
} from "lucide-react"
import {
  useNoteFolders,
  useNoteMutations,
  useNotesList,
} from "@/hooks/use-notes"
import { Confirm } from "@/components/ui/confirm"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import type { AccessLevel, Note, NoteFolder } from "@/schemas/note"
import { TextPrompt } from "./text-prompt"
import { MoveNoteModal } from "./move-note-modal"
import { ShareFolderModal } from "@/components/feature/notes/share-folder-modal"
import { blocksPreview } from "./constants"
import { NoteIcon } from "./note-icon"

interface Props {
  activeId: string | null
  onPick: (id: string) => void
  onNewNote: (folderId: string | null) => void
  onNewFolder: (parentId: string | null) => void
}

const ACCESS_LABEL: Record<Exclude<AccessLevel, "owner">, string> = {
  none: "No access",
  read: "Read",
  upload: "Create",
  edit: "Edit",
}

const descendantFolderIds = (folders: NoteFolder[], rootId: string) => {
  const out: string[] = []
  const walk = (pid: string) =>
    folders
      .filter((f) => f.parentId === pid)
      .forEach((f) => {
        out.push(f._id)
        walk(f._id)
      })
  walk(rootId)
  return out
}

export function NoteTree({ activeId, onPick, onNewNote, onNewFolder }: Props) {
  const { data: notes = [] } = useNotesList()
  const { data: folders = [] } = useNoteFolders()
  const m = useNoteMutations()
  const me = useAuthStore((s) => s.user)

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")
  const [renameNote, setRenameNote] = useState<Note | null>(null)
  const [renameFolder, setRenameFolder] = useState<NoteFolder | null>(null)
  const [deleteNote, setDeleteNote] = useState<Note | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<NoteFolder | null>(null)
  const [moveNote, setMoveNote] = useState<Note | null>(null)
  const [sharing, setSharing] = useState<NoteFolder | null>(null)
  const [dragging, setDragging] = useState(false)
  const [overTarget, setOverTarget] = useState<string | "root" | null>(null)

  const doMove = (noteId: string, folderId: string | null) => {
    const n = notes.find((x) => x._id === noteId)
    if (!n) return
    if ((n.folderId ?? null) === folderId) return
    m.update.mutate({ id: noteId, body: { folderId } })
  }

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const ownFolders = useMemo(
    () => folders.filter((f) => (f._access ?? "owner") === "owner"),
    [folders],
  )
  const sharedFolders = useMemo(
    () => folders.filter((f) => f._access && f._access !== "owner"),
    [folders],
  )

  const folderImpact = useMemo(() => {
    if (!deleteFolder) return { folders: 0, notes: 0 }
    const ids = [
      deleteFolder._id,
      ...descendantFolderIds(folders, deleteFolder._id),
    ]
    return {
      folders: ids.length - 1,
      notes: notes.filter((n) => n.folderId && ids.includes(n.folderId)).length,
    }
  }, [deleteFolder, folders, notes])

  // Search mode: flat list
  const searching = q.trim().length > 0
  const matches = useMemo(() => {
    if (!searching) return []
    const needle = q.toLowerCase()
    return notes
      .filter(
        (n) =>
          (n.title || "").toLowerCase().includes(needle) ||
          (n.tags || []).some((t) => t.toLowerCase().includes(needle)) ||
          blocksPreview(n.blocks).toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
  }, [q, notes, searching])

  /**
   * Render a tree rooted at `parentId`, drawing only folders inside `pool`.
   * `rootVisibleIds` is the set of folder ids the renderer treats as "visible"
   * when deciding whether to root a folder under `parentId === null` (used for
   * the shared tree, whose roots are shared folders whose own parent isn't
   * itself shared with me).
   */
  const renderTree = (
    parentId: string | null,
    depth: number,
    pool: NoteFolder[],
    includeNotesPredicate: (n: Note) => boolean,
  ): React.ReactNode[] => {
    const visibleIds = new Set(pool.map((f) => f._id))
    const childFolders = pool
      .filter((f) => {
        if (parentId === null) {
          // Roots = no parent, or parent not in this pool.
          return !f.parentId || !visibleIds.has(f.parentId)
        }
        return f.parentId === parentId
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    const childNotes =
      parentId === null
        ? notes
            .filter((n) => !n.folderId && includeNotesPredicate(n))
            .sort(
              (a, b) =>
                Number(b.pinned) - Number(a.pinned) ||
                new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
            )
        : notes
            .filter(
              (n) => n.folderId === parentId && includeNotesPredicate(n),
            )
            .sort(
              (a, b) =>
                Number(b.pinned) - Number(a.pinned) ||
                new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
            )

    const out: React.ReactNode[] = []
    for (const f of childFolders) {
      const isOwn = (f._access ?? "owner") === "owner"
      const hasChildren =
        pool.some((x) => x.parentId === f._id) ||
        notes.some((n) => n.folderId === f._id && includeNotesPredicate(n))
      const open = hasChildren && !collapsed.has(f._id)
      out.push(
        <FolderRow
          key={`f-${f._id}`}
          folder={f}
          depth={depth}
          open={open}
          hasChildren={hasChildren}
          isOwn={isOwn}
          isDropTarget={overTarget === f._id}
          onDragOver={() => setOverTarget(f._id)}
          onDragLeave={() =>
            setOverTarget((cur) => (cur === f._id ? null : cur))
          }
          onDropNote={(noteId) => {
            doMove(noteId, f._id)
            setOverTarget(null)
          }}
          onToggle={() => toggle(f._id)}
          onAddFolder={() => onNewFolder(f._id)}
          onAddNote={() => onNewNote(f._id)}
          onShare={() => setSharing(f)}
          onRename={() => setRenameFolder(f)}
          onDelete={() => setDeleteFolder(f)}
        />,
      )
      if (open)
        out.push(...renderTree(f._id, depth + 1, pool, includeNotesPredicate))
    }
    for (const n of childNotes) {
      const isOwnNote = n.ownerId === me?.id
      out.push(
        <NoteRow
          key={`n-${n._id}`}
          note={n}
          depth={depth}
          active={activeId === n._id}
          canMutate={isOwnNote}
          onPick={() => onPick(n._id)}
          onRename={() => setRenameNote(n)}
          onDelete={() => setDeleteNote(n)}
          onMove={() => setMoveNote(n)}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => {
            setDragging(false)
            setOverTarget(null)
          }}
        />,
      )
    }
    return out
  }

  return (
    <aside className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-text-muted">
          Notes
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNewFolder(null)}
            title="New folder"
            className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNewNote(null)}
            title="New note"
            className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-2 py-2 border-b border-border">
        <div className="flex items-center gap-2 px-2.5 bg-bg-subtle border border-border rounded-sm focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)] transition-[border-color,box-shadow] duration-[var(--dur)]">
          <Search className="w-3.5 h-3.5 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 bg-transparent border-0 py-1.5 text-[12.5px] outline-none placeholder:text-text-muted"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {dragging && (
          <div
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("application/x-note-id"))
                return
              e.preventDefault()
              e.dataTransfer.dropEffect = "move"
              setOverTarget("root")
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null))
                return
              setOverTarget((cur) => (cur === "root" ? null : cur))
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("application/x-note-id")
              if (!id) return
              e.preventDefault()
              doMove(id, null)
              setOverTarget(null)
            }}
            className={cn(
              "mx-2 mb-1.5 px-3 py-2 text-[11.5px] text-center text-text-muted border border-dashed border-border rounded-sm transition-colors",
              overTarget === "root" &&
                "bg-[color:color-mix(in_srgb,var(--a)_14%,transparent)] border-accent text-accent",
            )}
          >
            Drop here to move to root
          </div>
        )}
        {searching ? (
          matches.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-text-muted text-center">
              No notes match your search.
            </p>
          ) : (
            matches.map((n) => (
              <NoteRow
                key={n._id}
                note={n}
                depth={0}
                active={activeId === n._id}
                canMutate={n.ownerId === me?.id}
                onPick={() => onPick(n._id)}
                onRename={() => setRenameNote(n)}
                onDelete={() => setDeleteNote(n)}
                onMove={() => setMoveNote(n)}
                onDragStart={() => setDragging(true)}
                onDragEnd={() => {
                  setDragging(false)
                  setOverTarget(null)
                }}
              />
            ))
          )
        ) : notes.length === 0 && folders.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-text-muted text-center">
            No notes yet. Click <strong>+</strong> above.
          </p>
        ) : (
          <>
            {renderTree(
              null,
              0,
              ownFolders,
              (n) => n.ownerId === me?.id,
            )}
            {sharedFolders.length > 0 && (
              <div className="mt-3 px-3 py-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-text-muted border-t border-border">
                <Users className="w-3 h-3" />
                Shared with me
              </div>
            )}
            {sharedFolders.length > 0 &&
              renderTree(null, 0, sharedFolders, () => true)}
          </>
        )}
      </div>

      <TextPrompt
        open={!!renameNote}
        title="Rename note"
        label="Title"
        initial={renameNote?.title || ""}
        onConfirm={(v) =>
          renameNote &&
          m.update.mutate({ id: renameNote._id, body: { title: v } })
        }
        onClose={() => setRenameNote(null)}
      />
      <TextPrompt
        open={!!renameFolder}
        title="Rename folder"
        label="Name"
        initial={renameFolder?.name || ""}
        onConfirm={(v) =>
          renameFolder &&
          m.renameFolder.mutate({ id: renameFolder._id, name: v })
        }
        onClose={() => setRenameFolder(null)}
      />
      <Confirm
        open={!!deleteNote}
        title="Delete note"
        body={
          <>
            This will permanently delete{" "}
            <strong>{deleteNote?.title || "Untitled"}</strong>.
          </>
        }
        danger
        onConfirm={() => deleteNote && m.remove.mutate(deleteNote._id)}
        onClose={() => setDeleteNote(null)}
      />
      <Confirm
        open={!!deleteFolder}
        title="Delete folder"
        body={
          folderImpact.folders || folderImpact.notes ? (
            <>
              Delete <strong>{deleteFolder?.name}</strong>,{" "}
              {folderImpact.folders} subfolder(s) and {folderImpact.notes}{" "}
              note(s)?
            </>
          ) : (
            <>
              Delete folder <strong>{deleteFolder?.name}</strong>?
            </>
          )
        }
        danger
        onConfirm={() =>
          deleteFolder && m.removeFolder.mutate(deleteFolder._id)
        }
        onClose={() => setDeleteFolder(null)}
      />
      <MoveNoteModal note={moveNote} onClose={() => setMoveNote(null)} />
      <ShareFolderModal
        folder={sharing}
        onClose={() => setSharing(null)}
      />
    </aside>
  )
}

function FolderRow({
  folder,
  depth,
  open,
  hasChildren,
  isOwn,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDropNote,
  onToggle,
  onAddFolder,
  onAddNote,
  onShare,
  onRename,
  onDelete,
}: {
  folder: NoteFolder
  depth: number
  open: boolean
  hasChildren: boolean
  isOwn: boolean
  isDropTarget: boolean
  onDragOver: () => void
  onDragLeave: () => void
  onDropNote: (noteId: string) => void
  onToggle: () => void
  onAddFolder: () => void
  onAddNote: () => void
  onShare: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const accessLbl =
    folder._access && folder._access !== "owner"
      ? ACCESS_LABEL[folder._access]
      : null
  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 pr-1 py-1 hover:bg-bg-hover transition-colors",
        isDropTarget &&
          "bg-[color:color-mix(in_srgb,var(--a)_14%,transparent)] outline outline-1 outline-accent rounded-sm",
      )}
      style={{ paddingLeft: depth * 14 + 6 }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/x-note-id")) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        onDragOver()
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        onDragLeave()
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("application/x-note-id")
        if (!id) return
        e.preventDefault()
        onDropNote(id)
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasChildren}
        className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
      >
        <ChevronRight
          className={cn(
            "w-3 h-3 transition-transform duration-[var(--dur)]",
            open && "rotate-90",
          )}
        />
      </button>
      <FolderIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
      <span
        className="flex-1 min-w-0 text-[12.5px] font-semibold truncate cursor-pointer"
        onClick={onToggle}
        title={folder.name}
      >
        {folder.name}
      </span>
      {accessLbl && (
        <span
          title={`Shared with you — ${accessLbl}`}
          className="ml-1 text-[9.5px] uppercase tracking-wider text-text-muted bg-bg-subtle px-1.5 py-[1px] rounded-xs"
        >
          {accessLbl}
        </span>
      )}
      {isOwn && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
          <IconAction title="Share folder" onClick={onShare}>
            <Share2 className="w-3 h-3" />
          </IconAction>
          <IconAction title="New folder inside" onClick={onAddFolder}>
            <FolderPlus className="w-3 h-3" />
          </IconAction>
          <IconAction title="New note inside" onClick={onAddNote}>
            <FilePlus className="w-3 h-3" />
          </IconAction>
          <IconAction title="Rename" onClick={onRename}>
            <Pencil className="w-3 h-3" />
          </IconAction>
          <IconAction title="Delete" onClick={onDelete} danger>
            <Trash2 className="w-3 h-3" />
          </IconAction>
        </div>
      )}
    </div>
  )
}

function NoteRow({
  note,
  depth,
  active,
  canMutate,
  onPick,
  onRename,
  onDelete,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  note: Note
  depth: number
  active: boolean
  canMutate: boolean
  onPick: () => void
  onRename: () => void
  onDelete: () => void
  onMove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      className={cn(
        "group relative flex items-start gap-1.5 pr-1 py-1.5 cursor-pointer transition-colors ",
        active
          ? "bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent"
          : "hover:bg-bg-hover",
      )}
      style={{ paddingLeft: depth * 14 + 22 }}
      onClick={onPick}
      title={note.title || "Untitled — drag to a folder to move"}
      draggable={canMutate}
      onDragStart={(e) => {
        if (!canMutate) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData("application/x-note-id", note._id)
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <span className="mt-px flex-shrink-0 inline-flex items-center justify-center w-3.5 h-3.5">
        <NoteIcon value={note.emoji} size={14} />
      </span>
      <span className="flex-1 min-w-0 inline-flex items-center gap-1.5">
        <strong className="text-[12.5px] font-semibold truncate">
          {note.title || "Untitled"}
        </strong>
        {note.pinned && (
          <Star className="w-3 h-3 fill-amber text-amber flex-shrink-0" />
        )}
      </span>
      {canMutate && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
          <IconAction
            title="Move to folder"
            onClick={(e) => {
              e.stopPropagation()
              onMove()
            }}
          >
            <MoveIcon className="w-3 h-3" />
          </IconAction>
          <IconAction
            title="Rename"
            onClick={(e) => {
              e.stopPropagation()
              onRename()
            }}
          >
            <Pencil className="w-3 h-3" />
          </IconAction>
          <IconAction
            title="Delete"
            danger
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="w-3 h-3" />
          </IconAction>
        </div>
      )}
    </div>
  )
}

function IconAction({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "w-6 h-6 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-subtle transition-colors",
        danger ? "hover:text-red" : "hover:text-text",
      )}
    >
      {children}
    </button>
  )
}
