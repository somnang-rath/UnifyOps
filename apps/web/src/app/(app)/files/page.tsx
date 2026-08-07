"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Download,
  FileText,
  FileUp,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImgIcon,
  LayoutGrid,
  Layers,
  Link as LinkIcon,
  ListTree,
  Move as MoveIcon,
  Pencil,
  Search,
  Share2,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { Field, Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import {
  filesService,
  useFileMutations,
  useFiles,
  useFileStats,
  useFolders,
} from "@/hooks/use-files"
import { useDebounce } from "@/hooks/use-debounce"
import { fmtBytes } from "@/lib/format"
import { useFormat } from "@prism/i18n"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast-store"
import { useAuthStore } from "@/stores/auth-store"
import type { AccessLevel, FileItem, Folder } from "@/schemas/file"
import { ShareFolderModal } from "@/components/feature/storage/share-folder-modal"
import { MoveFileModal } from "@/components/feature/storage/move-file-modal"
import { FileViewer } from "@/components/feature/storage/file-viewer"
import { fileIconFor } from "@/constants/images"
import { TextPrompt } from "../notes/_components/text-prompt"
import { StorageTree } from "./_components/storage-tree"

type View = "grid" | "list"

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const ACCESS_LABEL: Record<Exclude<AccessLevel, "owner">, string> = {
  none: "No access",
  read: "Read",
  upload: "Upload",
  edit: "Edit",
}

const accessBadge = (a: AccessLevel | undefined): string | null => {
  if (!a || a === "owner") return null
  return ACCESS_LABEL[a]
}

const CategoryIcon = (cat: FileItem["category"]) =>
  cat === "image" ? ImgIcon : cat === "link" ? LinkIcon : FileText

export default function FilesPage() {
  const [folderId, setFolderId] = useState<string | null>(null)
  const [view, setViewRaw] = useState<View>(() => {
    if (typeof window === "undefined") return "grid"
    return (localStorage.getItem("storage-view") as View) ?? "grid"
  })
  const setView = (v: View) => {
    setViewRaw(v)
    localStorage.setItem("storage-view", v)
  }
  const [q, setQ] = useState("")
  const debouncedQ = useDebounce(q, 220)

  const [renaming, setRenaming] = useState<FileItem | null>(null)
  const [deleting, setDeleting] = useState<FileItem | null>(null)
  const [moving, setMoving] = useState<FileItem | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [linking, setLinking] = useState(false)
  const [sharing, setSharing] = useState<Folder | null>(null)
  const [viewingIdx, setViewingIdx] = useState<number | null>(null)
  const [folderPrompt, setFolderPrompt] = useState<{
    parentId: string | null
  } | null>(null)
  const [progress, setProgress] = useState<{
    pct: number
    name: string
  } | null>(null)
  const [overlay, setOverlay] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)

  // Khmer does not sort like Latin text, so folder/file names go through
  // Intl.Collator for the active locale rather than a bare localeCompare.
  const { compareNames: cmpNames } = useFormat()
  const me = useAuthStore((s) => s.user)
  const { data: folders = [] } = useFolders()
  const { data: files = [], isLoading } = useFiles(folderId, debouncedQ)
  const { data: stats } = useFileStats()
  const m = useFileMutations()

  const currentFolder = useMemo(
    () => folders.find((f) => f._id === folderId) ?? null,
    [folders, folderId],
  )
  const currentAccess: AccessLevel = currentFolder?._access ?? "owner"

  const subfolders = useMemo(() => {
    const q = debouncedQ.trim().toLowerCase()
    const visible = new Set(folders.map((f) => f._id))
    return folders
      .filter((f) => {
        if (folderId === null) {
          return !f.parentId || !visible.has(f.parentId)
        }
        return f.parentId === folderId
      })
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true))
      .sort((a, b) => cmpNames(a.name, b.name))
  }, [folders, folderId, debouncedQ, cmpNames])

  const canUploadHere =
    currentAccess === "owner" ||
    currentAccess === "edit" ||
    currentAccess === "upload"
  const canCreateSubfolder = currentAccess === "owner"

  const breadcrumbName = useMemo(() => {
    if (folderId === null) return "All files"
    const path: string[] = []
    let cur: Folder | undefined = folders.find((f) => f._id === folderId)
    while (cur) {
      path.unshift(cur.name)
      cur = folders.find((f) => f._id === cur!.parentId)
    }
    return path.join(" / ")
  }, [folderId, folders])


  const upload = (f: File) => {
    if (f.size > MAX_UPLOAD_BYTES) {
      toast(
        `${f.name} is too large (${fmtBytes(f.size)}). Max upload is ${fmtBytes(MAX_UPLOAD_BYTES)}.`,
        "error",
      )
      return
    }
    setProgress({ pct: 0, name: f.name })
    m.upload.mutate(
      {
        file: f,
        folderId,
        onProgress: (pct) => setProgress({ pct, name: f.name }),
      },
      {
        onSettled: () => setTimeout(() => setProgress(null), 400),
      },
    )
  }
  const uploadMany = (list: FileList) => Array.from(list).forEach(upload)

  return (
    <div
      className="h-[calc(100vh-60px)] -my-5 relative"
      onDragEnter={(e) => {
        if (e.dataTransfer?.types.includes("Files")) setOverlay(true)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setOverlay(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files.length) return
        e.preventDefault()
        setOverlay(false)
        uploadMany(e.dataTransfer.files)
      }}
    >
      <main className="h-full bg-bg-card border border-border rounded-lg flex flex-col overflow-hidden relative">
        {/* Toolbar */}
        <div className="flex-shrink-0 z-10 flex items-center gap-1 px-3 py-2.5 border-b border-border bg-[color:color-mix(in_srgb,var(--bg-card)_92%,transparent)] backdrop-blur">
          <ActionButton
            title="Browse folders"
            onClick={() => setTreeOpen((v) => !v)}
            active={treeOpen}
          >
            <ListTree className="w-3.5 h-3.5" />
          </ActionButton>

          <button
            type="button"
            onClick={() => setTreeOpen(true)}
            className="px-2 py-1 rounded-sm text-[13px] font-semibold hover:bg-bg-hover transition-colors max-w-[280px] truncate"
            title={breadcrumbName}
          >
            {breadcrumbName}
          </button>
          {accessBadge(currentAccess) && (
            <span className="text-[9.5px] uppercase tracking-wider text-text-muted bg-bg-subtle px-1.5 py-[1px] rounded-xs">
              {accessBadge(currentAccess)}
            </span>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-2 px-2.5 min-w-[180px] bg-bg-subtle border border-border rounded-sm focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)] transition-[border-color,box-shadow] duration-[var(--dur)]">
            <Search className="w-3.5 h-3.5 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search files…"
              className="flex-1 bg-transparent border-0 py-1.5 text-[12.5px] outline-none placeholder:text-text-muted"
            />
          </div>

          <div className="inline-flex p-1 bg-bg-subtle border border-border rounded-sm">
            <SegBtn active={view === "grid"} onClick={() => setView("grid")}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </SegBtn>
            <SegBtn active={view === "list"} onClick={() => setView("list")}>
              <Layers className="w-3.5 h-3.5" />
            </SegBtn>
          </div>

          <span className="w-px h-5 bg-border mx-1" />

          {canCreateSubfolder && (
            <ActionButton
              title="New folder"
              onClick={() => setFolderPrompt({ parentId: folderId })}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </ActionButton>
          )}
          {canUploadHere && (
            <ActionButton title="Add link" onClick={() => setLinking(true)}>
              <LinkIcon className="w-3.5 h-3.5" />
            </ActionButton>
          )}
          {canUploadHere && (
            <ActionButton
              title="Upload file"
              onClick={() => fileInput.current?.click()}
              primary
            >
              <Upload className="w-3.5 h-3.5" />
            </ActionButton>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadMany(e.target.files)
              e.target.value = ""
            }}
          />
        </div>

        {/* Content area with popup overlay */}
        <div className="flex-1 relative overflow-hidden">
          {treeOpen && (
            <>
              {/* Backdrop — transparent, closes popup on click */}
              <div
                className="absolute inset-0 z-20"
                onMouseDown={() => setTreeOpen(false)}
              />
              {/* Popup z-30 — same stacking context as backdrop */}
              <div className="absolute left-4 top-2 w-[320px] h-[460px] z-30 origin-top-left flex flex-col bg-bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-popover-in">
                <StorageTree
                  current={folderId}
                  onPick={(id) => { setFolderId(id); setTreeOpen(false) }}
                  onShare={setSharing}
                  onRename={setRenamingFolder}
                  onDelete={setDeletingFolder}
                  onNewFolder={(parentId) => setFolderPrompt({ parentId })}
                />
              </div>
            </>
          )}

          {/* Scrollable content */}
          <div className="absolute inset-0 overflow-y-auto">

        {/* Stats row */}
        {stats && (
          <div className="px-5 py-2 border-b border-border flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>
              <b className="font-bold text-text-sub tabular-nums">
                {stats.files}
              </b>{" "}
              files
            </span>
            <span className="text-text-muted/60">·</span>
            <span>
              <b className="font-bold text-text-sub tabular-nums">
                {stats.folders}
              </b>{" "}
              folders
            </span>
            <span className="text-text-muted/60">·</span>
            <span>
              <b className="font-bold text-text-sub tabular-nums">
                {fmtBytes(stats.size)}
              </b>{" "}
              used
            </span>
            <span className="flex-1" />
            <span>Max {fmtBytes(MAX_UPLOAD_BYTES)} per file</span>
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className="mx-5 mt-3 px-3 py-2 bg-bg-card border border-border rounded-md">
            <div className="h-[5px] bg-bg-subtle rounded-full overflow-hidden mb-1.5">
              <div
                className="h-full bg-grad rounded-full transition-[width] duration-200"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <span className="text-[11px] text-text-muted tabular-nums">
              {progress.name} — {progress.pct}%
            </span>
          </div>
        )}

        {/* Content */}
        <div className="px-5 py-4">
          {isLoading ? (
            <div className="text-text-muted text-[13px]">Loading…</div>
          ) : subfolders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2.5 py-16">
              <FileUp className="w-10 h-10 text-text-muted opacity-50" />
              <strong className="text-[14px] font-semibold text-text-sub">
                {canUploadHere
                  ? "No files in this folder"
                  : "This folder is empty"}
              </strong>
              <span className="text-[12.5px] text-text-muted max-w-[320px]">
                {canUploadHere
                  ? "Drag & drop files here, or click Upload above."
                  : "You don't have permission to upload here."}
              </span>
              {canUploadHere && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" /> Upload
                </Button>
              )}
            </div>
          ) : view === "grid" ? (
            <div className="flex flex-col gap-5">
              {subfolders.length > 0 && (
                <section>
                  <h3 className="text-[10.5px] font-bold uppercase tracking-[.06em] text-text-muted mb-2">
                    Folders
                  </h3>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
                    {subfolders.map((f) => (
                      <FolderCard
                        key={f._id}
                        folder={f}
                        onOpen={setFolderId}
                        onShare={setSharing}
                        onRename={setRenamingFolder}
                        onDelete={setDeletingFolder}
                      />
                    ))}
                  </div>
                </section>
              )}
              {files.length > 0 && (
                <section>
                  {subfolders.length > 0 && (
                    <h3 className="text-[10.5px] font-bold uppercase tracking-[.06em] text-text-muted mb-2">
                      Files
                    </h3>
                  )}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
                    {files.map((f) => (
                      <FileCard
                        key={f._id}
                        file={f}
                        folderAccess={currentAccess}
                        isMyFile={f.ownerId === me?.id}
                        onOpen={(file) =>
                          setViewingIdx(
                            files.findIndex((x) => x._id === file._id),
                          )
                        }
                        onRename={setRenaming}
                        onDelete={setDeleting}
                        onMove={setMoving}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden divide-y divide-border bg-bg-card">
              {subfolders.map((f) => (
                <FolderListRow
                  key={f._id}
                  folder={f}
                  onOpen={setFolderId}
                  onShare={setSharing}
                  onRename={setRenamingFolder}
                  onDelete={setDeletingFolder}
                />
              ))}
              {files.map((f) => (
                <FileListRow
                  key={f._id}
                  file={f}
                  folderAccess={currentAccess}
                  isMyFile={f.ownerId === me?.id}
                  onOpen={(file) =>
                    setViewingIdx(files.findIndex((x) => x._id === file._id))
                  }
                  onRename={setRenaming}
                  onDelete={setDeleting}
                  onMove={setMoving}
                />
              ))}
            </div>
          )}
        </div>
          </div>{/* scrollable content */}
        </div>{/* flex content area */}
      </main>

      {overlay && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-[var(--overlay)] backdrop-blur-[6px]">
          <div className="px-6 py-5 bg-bg-card border border-border rounded-xl shadow-xl flex items-center gap-3">
            <span className="w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center">
              <FileUp className="w-7 h-7" />
            </span>
            <strong className="text-[16px]">
              Drop to upload to <em>{breadcrumbName}</em>
            </strong>
          </div>
        </div>
      )}

      <TextPrompt
        open={!!folderPrompt}
        title="New folder"
        label="Name"
        placeholder="e.g. Designs"
        confirmLabel="Create"
        onConfirm={(name) =>
          folderPrompt &&
          m.createFolder.mutate({ name, parentId: folderPrompt.parentId })
        }
        onClose={() => setFolderPrompt(null)}
      />
      <RenameModal item={renaming} onClose={() => setRenaming(null)} />
      <Confirm
        open={!!deleting}
        title="Delete file"
        body={
          <>
            This will permanently delete{" "}
            <strong>{deleting?.name}</strong>.
          </>
        }
        danger
        onConfirm={() => deleting && m.remove.mutate(deleting._id)}
        onClose={() => setDeleting(null)}
      />
      <AddLinkModal
        open={linking}
        folderId={folderId}
        onClose={() => setLinking(false)}
        onSubmit={(b) => {
          m.addLink.mutate(b)
          setLinking(false)
        }}
      />
      <ShareFolderModal folder={sharing} onClose={() => setSharing(null)} />
      <MoveFileModal file={moving} onClose={() => setMoving(null)} />
      <FileViewer
        files={files}
        index={viewingIdx}
        onIndexChange={setViewingIdx}
        onClose={() => setViewingIdx(null)}
      />
      <RenameFolderModal
        folder={renamingFolder}
        onClose={() => setRenamingFolder(null)}
      />
      <Confirm
        open={!!deletingFolder}
        title="Delete folder"
        body={
          <>
            Delete <strong>{deletingFolder?.name}</strong> and everything
            inside it? This cannot be undone.
          </>
        }
        danger
        onConfirm={() => {
          if (deletingFolder) {
            m.removeFolder.mutate(deletingFolder._id)
            if (folderId === deletingFolder._id) setFolderId(null)
          }
        }}
        onClose={() => setDeletingFolder(null)}
      />
    </div>
  )
}

function ActionButton({
  children,
  title,
  onClick,
  disabled,
  active,
  primary,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-8 h-8 rounded-sm flex items-center justify-center transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        active
          ? "bg-accent-50 text-accent shadow-xs"
          : primary
            ? "text-accent hover:bg-accent-50"
            : "text-text-muted hover:bg-bg-hover hover:text-text",
      )}
    >
      {children}
    </button>
  )
}

function SegBtn({
  active,
  children,
  onClick,
}: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-1.5 rounded-[4px] text-text-muted transition-all duration-[var(--dur)] hover:text-text",
        active && "bg-bg text-text shadow-sm",
      )}
    >
      {children}
    </button>
  )
}

function canMutateFile(access: AccessLevel, isMine: boolean): boolean {
  if (access === "owner" || access === "edit") return true
  if (access === "upload" && isMine) return true
  return false
}

function FileCard({
  file,
  folderAccess,
  isMyFile,
  onOpen,
  onRename,
  onDelete,
  onMove,
}: {
  file: FileItem
  folderAccess: AccessLevel
  isMyFile: boolean
  onOpen: (f: FileItem) => void
  onRename: (f: FileItem) => void
  onDelete: (f: FileItem) => void
  onMove: (f: FileItem) => void
}) {
  const Icon = CategoryIcon(file.category)
  const isImage = file.category === "image"
  const iconSrc = !isImage ? fileIconFor(file.name) : null
  const canMutate = canMutateFile(folderAccess, isMyFile)
  const badge = accessBadge(folderAccess)

  return (
    <div className="group bg-bg-card border border-border rounded-md overflow-hidden flex flex-col transition-all hover:shadow-sm hover:-translate-y-px hover:border-[color:color-mix(in_srgb,var(--a)_30%,var(--border))] duration-[var(--dur)]">
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="relative aspect-[5/4] flex items-center justify-center bg-bg-subtle overflow-hidden cursor-pointer"
      >
        {isImage ? (
          <img
            src={filesService.downloadUrl(file._id)}
            alt={file.name}
            className="w-full h-full object-cover"
          />
        ) : iconSrc ? (
          <img src={iconSrc} alt="" className="w-9 h-9 object-contain" />
        ) : (
          <Icon className="w-7 h-7 text-text-muted opacity-85" />
        )}
        {badge && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-[1px] text-[9px] uppercase tracking-wider font-bold bg-bg-card/90 text-text-sub rounded-xs backdrop-blur shadow-xs">
            {badge}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="px-2 pt-1.5 pb-0.5 flex-1 min-w-0 text-left"
      >
        <strong className="block text-[11.5px] font-semibold truncate leading-tight">
          {file.name}
        </strong>
        <span className="block text-[10px] text-text-muted tabular-nums mt-0.5">
          {file.category === "link"
            ? safeHost(file.url)
            : fmtBytes(file.size)}
        </span>
      </button>
      <Actions
        file={file}
        canMutate={canMutate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
        className="px-1.5 pb-1.5 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  )
}

function FolderCard({
  folder,
  onOpen,
  onShare,
  onRename,
  onDelete,
}: {
  folder: Folder
  onOpen: (id: string) => void
  onShare: (f: Folder) => void
  onRename: (f: Folder) => void
  onDelete: (f: Folder) => void
}) {
  const isOwner = folder._access === "owner"
  const badge = accessBadge(folder._access)
  return (
    <div className="group bg-bg-card border border-border rounded-md overflow-hidden flex flex-col transition-all hover:shadow-sm hover:-translate-y-px hover:border-[color:color-mix(in_srgb,var(--a)_30%,var(--border))] duration-[var(--dur)]">
      <button
        type="button"
        onClick={() => onOpen(folder._id)}
        className="relative aspect-[5/4] flex items-center justify-center bg-[color:color-mix(in_srgb,var(--a)_8%,var(--bg-subtle))] cursor-pointer"
      >
        <FolderIcon className="w-9 h-9 text-accent opacity-90" />
        {badge && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-[1px] text-[9px] uppercase tracking-wider font-bold bg-bg-card/90 text-text-sub rounded-xs backdrop-blur shadow-xs">
            {badge}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onOpen(folder._id)}
        className="px-2 pt-1.5 pb-0.5 flex-1 min-w-0 text-left"
      >
        <strong className="block text-[11.5px] font-semibold truncate leading-tight">
          {folder.name}
        </strong>
        <span className="block text-[10px] text-text-muted mt-0.5">
          Folder
        </span>
      </button>
      <FolderActions
        folder={folder}
        canMutate={isOwner}
        onShare={onShare}
        onRename={onRename}
        onDelete={onDelete}
        className="px-1.5 pb-1.5 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  )
}

function FileListRow({
  file,
  folderAccess,
  isMyFile,
  onOpen,
  onRename,
  onDelete,
  onMove,
}: {
  file: FileItem
  folderAccess: AccessLevel
  isMyFile: boolean
  onOpen: (f: FileItem) => void
  onRename: (f: FileItem) => void
  onDelete: (f: FileItem) => void
  onMove: (f: FileItem) => void
}) {
  const fmt = useFormat()
  const Icon = CategoryIcon(file.category)
  const iconSrc = file.category !== "image" ? fileIconFor(file.name) : null
  const canMutate = canMutateFile(folderAccess, isMyFile)
  const badge = accessBadge(folderAccess)

  return (
    <div className="group flex items-center gap-3 px-3 py-2 hover:bg-bg-subtle transition-colors">
      <span className="w-6 h-6 rounded-md flex items-center justify-center bg-bg-subtle text-text-muted overflow-hidden flex-shrink-0">
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            className="w-3.5 h-3.5 object-contain"
          />
        ) : (
          <Icon className="w-3.5 h-3.5" />
        )}
      </span>
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="flex-1 min-w-0 truncate text-left text-[12.5px] font-medium hover:text-accent transition-colors"
      >
        {file.name}
      </button>
      {badge && (
        <span className="text-[9.5px] uppercase tracking-wider text-text-muted bg-bg-subtle px-1.5 py-[1px] rounded-xs">
          {badge}
        </span>
      )}
      <span className="text-[11.5px] text-text-muted tabular-nums">
        {file.category === "link" ? "—" : fmtBytes(file.size)}
      </span>
      <span className="text-[11.5px] text-text-muted">
        {fmt.relative(file.updatedAt)}
      </span>
      <Actions
        file={file}
        canMutate={canMutate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
        className="opacity-0 group-hover:opacity-100"
      />
    </div>
  )
}

function FolderListRow({
  folder,
  onOpen,
  onShare,
  onRename,
  onDelete,
}: {
  folder: Folder
  onOpen: (id: string) => void
  onShare: (f: Folder) => void
  onRename: (f: Folder) => void
  onDelete: (f: Folder) => void
}) {
  const fmt = useFormat()
  const isOwner = folder._access === "owner"
  const badge = accessBadge(folder._access)
  return (
    <div className="group flex items-center gap-3 px-3 py-2 hover:bg-bg-subtle transition-colors">
      <span className="w-6 h-6 rounded-md flex items-center justify-center bg-[color:color-mix(in_srgb,var(--a)_12%,transparent)] text-accent flex-shrink-0">
        <FolderIcon className="w-3.5 h-3.5" />
      </span>
      <button
        type="button"
        onClick={() => onOpen(folder._id)}
        className="flex-1 min-w-0 truncate text-left text-[12.5px] font-medium hover:text-accent transition-colors"
      >
        {folder.name}
      </button>
      {badge && (
        <span className="text-[9.5px] uppercase tracking-wider text-text-muted bg-bg-subtle px-1.5 py-[1px] rounded-xs">
          {badge}
        </span>
      )}
      <span className="text-[11.5px] text-text-muted">
        {fmt.relative(folder.updatedAt)}
      </span>
      <FolderActions
        folder={folder}
        canMutate={isOwner}
        onShare={onShare}
        onRename={onRename}
        onDelete={onDelete}
        className="opacity-0 group-hover:opacity-100"
      />
    </div>
  )
}

function FolderActions({
  folder,
  canMutate,
  onShare,
  onRename,
  onDelete,
  className,
}: {
  folder: Folder
  canMutate: boolean
  onShare: (f: Folder) => void
  onRename: (f: Folder) => void
  onDelete: (f: Folder) => void
  className?: string
}) {
  if (!canMutate) return null
  return (
    <div className={cn("flex gap-0.5 transition-opacity duration-[var(--dur)]", className)}>
      <IconButton title="Share folder" onClick={() => onShare(folder)}>
        <Share2 className="w-3 h-3" />
      </IconButton>
      <IconButton title="Rename" onClick={() => onRename(folder)}>
        <Pencil className="w-3 h-3" />
      </IconButton>
      <IconButton title="Delete" danger onClick={() => onDelete(folder)}>
        <Trash2 className="w-3 h-3" />
      </IconButton>
    </div>
  )
}

function Actions({
  file,
  canMutate,
  onRename,
  onDelete,
  onMove,
  className,
}: {
  file: FileItem
  canMutate: boolean
  onRename: (f: FileItem) => void
  onDelete: (f: FileItem) => void
  onMove: (f: FileItem) => void
  className?: string
}) {
  return (
    <div className={cn("flex gap-0.5 transition-opacity duration-[var(--dur)]", className)}>
      {file.category !== "link" && (
        <a
          href={filesService.downloadUrl(file._id)}
          download={file.name}
          title="Download"
          className="w-6 h-6 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-subtle hover:text-text transition-colors"
        >
          <Download className="w-3 h-3" />
        </a>
      )}
      {canMutate && (
        <IconButton title="Move to folder" onClick={() => onMove(file)}>
          <MoveIcon className="w-3 h-3" />
        </IconButton>
      )}
      {canMutate && (
        <IconButton title="Rename" onClick={() => onRename(file)}>
          <Pencil className="w-3 h-3" />
        </IconButton>
      )}
      {canMutate && (
        <IconButton title="Delete" danger onClick={() => onDelete(file)}>
          <Trash2 className="w-3 h-3" />
        </IconButton>
      )}
    </div>
  )
}

function IconButton({
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

function safeHost(url?: string): string {
  if (!url) return "Link"
  try {
    return new URL(url).hostname
  } catch {
    return "Link"
  }
}

function RenameModal({
  item,
  onClose,
}: {
  item: FileItem | null
  onClose: () => void
}) {
  const { rename } = useFileMutations()
  const [name, setName] = useState("")
  if (item && name === "") setName(item.name)

  return (
    <Modal
      open={!!item}
      onClose={() => {
        onClose()
        setName("")
      }}
      size="sm"
      title="Rename file"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onClose()
              setName("")
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={() => {
              if (item && name.trim())
                rename.mutate({ id: item._id, name: name.trim() })
              onClose()
              setName("")
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  )
}

function RenameFolderModal({
  folder,
  onClose,
}: {
  folder: Folder | null
  onClose: () => void
}) {
  const { renameFolder } = useFileMutations()
  const [name, setName] = useState("")
  if (folder && name === "") setName(folder.name)

  const close = () => {
    onClose()
    setName("")
  }

  return (
    <Modal
      open={!!folder}
      onClose={close}
      size="sm"
      title="Rename folder"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || name.trim() === folder?.name}
            onClick={() => {
              if (folder && name.trim() && name.trim() !== folder.name)
                renameFolder.mutate({ id: folder._id, name: name.trim() })
              close()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  )
}

function AddLinkModal({
  open,
  folderId,
  onClose,
  onSubmit,
}: {
  open: boolean
  folderId: string | null
  onClose: () => void
  onSubmit: (b: {
    name: string
    url: string
    folderId: string | null
  }) => void
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Add link"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !url.trim()}
            onClick={() => {
              onSubmit({ name: name.trim(), url: url.trim(), folderId })
              setName("")
              setUrl("")
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Design system"
          autoFocus
        />
      </Field>
      <Field label="URL">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
      </Field>
    </Modal>
  )
}
