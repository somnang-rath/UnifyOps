"use client"
import { useMemo, useState } from "react"
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  Pencil,
  Search,
  Share2,
  Trash2,
  Users,
} from "lucide-react"
import { useFolders } from "@/hooks/use-files"
import { cn } from "@/lib/utils"
import { useFormat } from "@prism/i18n"
import type { AccessLevel, Folder } from "@/schemas/file"

interface Props {
  current: string | null
  onPick: (id: string | null) => void
  onShare: (f: Folder) => void
  onRename: (f: Folder) => void
  onDelete: (f: Folder) => void
  onNewFolder: (parentId: string | null) => void
}

const ACCESS_LABEL: Record<Exclude<AccessLevel, "owner">, string> = {
  none: "No access",
  read: "Read",
  upload: "Upload",
  edit: "Edit",
}

export function StorageTree({
  current,
  onPick,
  onShare,
  onRename,
  onDelete,
  onNewFolder,
}: Props) {
  // Khmer does not sort like Latin text, so folder/file names go through
  // Intl.Collator for the active locale rather than a bare localeCompare.
  const { compareNames: cmpNames } = useFormat()
  const { data: folders = [] } = useFolders()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")

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

  const searching = q.trim().length > 0
  const matches = useMemo(() => {
    if (!searching) return []
    const needle = q.toLowerCase()
    return folders
      .filter((f) => f.name.toLowerCase().includes(needle))
      .sort((a, b) => cmpNames(a.name, b.name))
  }, [q, folders, searching, cmpNames])

  const renderTree = (
    parentId: string | null,
    depth: number,
    pool: Folder[],
  ): React.ReactNode[] => {
    const visibleIds = new Set(pool.map((f) => f._id))
    const childFolders = pool
      .filter((f) => {
        if (parentId === null) {
          return !f.parentId || !visibleIds.has(f.parentId)
        }
        return f.parentId === parentId
      })
      .sort((a, b) => cmpNames(a.name, b.name))

    const out: React.ReactNode[] = []
    for (const f of childFolders) {
      const isOwn = (f._access ?? "owner") === "owner"
      const hasChildren = pool.some((x) => x.parentId === f._id)
      const open = hasChildren && !collapsed.has(f._id)
      out.push(
        <FolderRow
          key={f._id}
          folder={f}
          depth={depth}
          open={open}
          hasChildren={hasChildren}
          isOwn={isOwn}
          active={current === f._id}
          onToggle={() => toggle(f._id)}
          onPick={() => onPick(f._id)}
          onAddFolder={() => onNewFolder(f._id)}
          onShare={() => onShare(f)}
          onRename={() => onRename(f)}
          onDelete={() => onDelete(f)}
        />,
      )
      if (open) out.push(...renderTree(f._id, depth + 1, pool))
    }
    return out
  }

  return (
    <aside className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-text-muted">
          Folders
        </span>
        <button
          type="button"
          onClick={() => onNewFolder(null)}
          title="New folder"
          className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-2 py-2 border-b border-border">
        <div className="flex items-center gap-2 px-2.5 bg-bg-subtle border border-border rounded-sm focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)] transition-[border-color,box-shadow] duration-[var(--dur)]">
          <Search className="w-3.5 h-3.5 text-text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search folders…"
            className="flex-1 bg-transparent border-0 py-1.5 text-[12.5px] outline-none placeholder:text-text-muted"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        <button
          type="button"
          onClick={() => onPick(null)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors hover:bg-bg-hover",
            current === null &&
              "bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent",
          )}
        >
          <span className="w-4 h-4" />
          <FolderIcon className="w-3.5 h-3.5 text-accent" />
          <span>All files</span>
        </button>

        {searching ? (
          matches.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-text-muted text-center">
              No folders match your search.
            </p>
          ) : (
            matches.map((f) => {
              const isOwn = (f._access ?? "owner") === "owner"
              return (
                <FolderRow
                  key={f._id}
                  folder={f}
                  depth={0}
                  open={false}
                  hasChildren={false}
                  isOwn={isOwn}
                  active={current === f._id}
                  onToggle={() => {}}
                  onPick={() => onPick(f._id)}
                  onAddFolder={() => onNewFolder(f._id)}
                  onShare={() => onShare(f)}
                  onRename={() => onRename(f)}
                  onDelete={() => onDelete(f)}
                />
              )
            })
          )
        ) : (
          <>
            {renderTree(null, 0, ownFolders)}
            {sharedFolders.length > 0 && (
              <div className="mt-3 px-3 py-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-text-muted border-t border-border">
                <Users className="w-3 h-3" />
                Shared with me
              </div>
            )}
            {sharedFolders.length > 0 && renderTree(null, 0, sharedFolders)}
          </>
        )}
      </div>
    </aside>
  )
}

function FolderRow({
  folder,
  depth,
  open,
  hasChildren,
  isOwn,
  active,
  onToggle,
  onPick,
  onAddFolder,
  onShare,
  onRename,
  onDelete,
}: {
  folder: Folder
  depth: number
  open: boolean
  hasChildren: boolean
  isOwn: boolean
  active: boolean
  onToggle: () => void
  onPick: () => void
  onAddFolder: () => void
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
        "group relative flex items-center gap-1 pr-1 py-1 hover:bg-bg-hover transition-colors cursor-pointer",
        active &&
          "bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent",
      )}
      style={{ paddingLeft: depth * 14 + 6 }}
      onClick={onPick}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
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
      <FolderIcon
        className={cn(
          "w-3.5 h-3.5 flex-shrink-0",
          active ? "text-accent" : "text-text-muted",
        )}
      />
      <span
        className="flex-1 min-w-0 text-[12.5px] font-semibold truncate"
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

function IconAction({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "w-6 h-6 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-subtle transition-colors",
        danger ? "hover:text-red" : "hover:text-text",
      )}
    >
      {children}
    </button>
  )
}

