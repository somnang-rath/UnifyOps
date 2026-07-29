"use client"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AxiosError } from "axios"
import {
  BookOpen,
  Check,
  CloudOff,
  Download,
  FilePlus,
  Folder as FolderIcon,
  FolderPlus,
  ListTree,
  Loader2,
  Lock,
  Maximize2,
  Mic,
  Minimize2,
  NotebookPen,
  Save,
  Sparkles,
  Star,
  StretchHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import {
  CollaborativeEditor,
  CollabToolbar,
  userColor,
  type ConnectionStatus,
  type Editor,
  type PresenceUser,
  type SaveState,
} from "@prism/editor"
import { Avatar } from "@prism/ui"
import {
  notesApi,
  useNote,
  useNoteFolders,
  useNoteMutations,
} from "@/hooks/use-notes"
import { useNoteCollab } from "@/hooks/use-note-collab"
import { uploadEditorFile } from "@/lib/editor-upload"
import { useAuthStore } from "@/stores/auth-store"
import { toast } from "@/stores/toast-store"
import { Confirm } from "@/components/ui/confirm"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { SkeletonText } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { AuthUser } from "@/schemas/auth"
import type { Note, NoteFolder } from "@/schemas/note"
import { NoteTree } from "./note-tree"
import { TextPrompt } from "./text-prompt"
import { AUTOSAVE_MS, EMOJIS, TEMPLATES, readTime } from "./constants"
import { LUCIDE_ICONS, NoteIcon, lucideValue } from "./note-icon"

/**
 * Metadata-only draft (ADR 0009 §6): content edits go through Yjs → apps/live,
 * so the REST autosave carries only title/emoji/tags/pinned/folder.
 */
interface Draft {
  title: string
  emoji: string
  tags: string[]
  pinned: boolean
  folderId: string | null
}

const TEMPLATE_ICONS: Record<string, typeof BookOpen> = {
  lesson: BookOpen,
  meeting: Mic,
  journal: NotebookPen,
  project: FolderIcon,
}

const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_URL ?? ""

const EDITOR_PLACEHOLDER =
  "Start writing — use the toolbar for tasks, tables, images…"

/**
 * Content measure. The gutters are whatever is left over, so this is really a
 * "how much side margin do you want" control — the reason it's a user setting
 * and not a constant is that the right answer differs per screen and per note
 * (prose vs. wide tables). Persisted in localStorage, no server round-trip.
 */
const WIDTHS = [
  { key: "narrow", label: "Narrow", hint: "680px", cls: "max-w-[680px]" },
  { key: "normal", label: "Normal", hint: "880px", cls: "max-w-[880px]" },
  { key: "wide", label: "Wide", hint: "1140px", cls: "max-w-[1140px]" },
  { key: "full", label: "Full width", hint: "no limit", cls: "max-w-none" },
] as const

type WidthKey = (typeof WIDTHS)[number]["key"]

/** Wide by default: the old fixed 760px left far too much dead gutter. */
const DEFAULT_WIDTH: WidthKey = "wide"

const emptyDraft = (folderId: string | null = null): Draft => ({
  title: "",
  emoji: "📄",
  tags: [],
  pinned: false,
  folderId,
})

/** Collab state lifted from the keyed editor pane into the action bar/footer. */
interface CollabUi {
  status: ConnectionStatus
  saveState: SaveState
  presence: PresenceUser[]
  /** null until the token resolves (unknown). */
  canWrite: boolean | null
  /** Token mint failed and no usable token is held — the red state (§3.2). */
  tokenFailed: boolean
  /** Token still loading (before the first mint resolves). */
  connecting: boolean
  /**
   * The token minted fine but the live server never answered the socket —
   * apps/live is down, or NEXT_PUBLIC_LIVE_URL points somewhere it isn't.
   * Distinct from `tokenFailed` (auth) and `disconnected` (dropped mid-session).
   */
  unreachable: boolean
  /**
   * The live server answered but refused the socket — an expired or revoked
   * collab token, not a reachability problem. Retrying re-mints the token.
   */
  rejected: boolean
}

const initialCollabUi = (): CollabUi => ({
  status: "connecting",
  saveState: "saving",
  presence: [],
  canWrite: null,
  tokenFailed: false,
  connecting: true,
  unreachable: false,
  rejected: false,
})

/**
 * The full Notes editor. Lives outside `page.tsx` because Next only allows a
 * page file to export the default route (plus reserved names) — this named
 * export lets the split-editor embed Notes natively via `embedded`.
 */
export function NotesView({ embedded = false }: { embedded?: boolean }) {
  const me = useAuthStore((s) => s.user)
  const { data: folders = [] } = useNoteFolders()
  const m = useNoteMutations()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [dirty, setDirty] = useState(false)
  // Fallback only: a 403 on the *metadata* autosave. Content read-only is known
  // up front from the collab token's canWrite (§3.3).
  const [metaReadOnly, setMetaReadOnly] = useState(false)
  const [tagInput, setTagInput] = useState("")
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<"icon" | "emoji">("icon")
  const [tplOpen, setTplOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [headerCompact, setHeaderCompact] = useState(false)
  const [width, setWidth] = useState<WidthKey>(DEFAULT_WIDTH)
  const [widthOpen, setWidthOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [folderPrompt, setFolderPrompt] = useState<{
    parentId: string | null
  } | null>(null)
  const [collabUi, setCollabUi] = useState<CollabUi>(initialCollabUi)
  const [words, setWords] = useState(0)
  // The Tiptap instance, lifted out of the editor pane so the toolbar can live
  // in the action bar at the top of the pane instead of above the text.
  const [editor, setEditor] = useState<Editor | null>(null)
  const retryRef = useRef<() => void>(() => {})
  const skipNextLoadRef = useRef(false)
  const persistRef = useRef(false)
  const emojiBtnRef = useRef<HTMLDivElement>(null)
  const tplBtnRef = useRef<HTMLDivElement>(null)
  const widthBtnRef = useRef<HTMLDivElement>(null)

  const { data: activeNote, error: activeNoteError } = useNote(activeId)

  // Reset per-note collab state synchronously when the open note changes so the
  // keyed pane below always reports into a clean slate.
  const [lastCollabId, setLastCollabId] = useState(activeId)
  if (lastCollabId !== activeId) {
    setLastCollabId(activeId)
    setCollabUi(initialCollabUi())
    setWords(0)
    setEditor(null)
  }

  const patchCollabUi = useCallback((patch: Partial<CollabUi>) => {
    setCollabUi((prev) => ({ ...prev, ...patch }))
  }, [])

  // Restore the last-open note on mount so switching pages and coming back
  // keeps your place instead of resetting to the empty "Select a note" screen.
  // (Read from localStorage in an effect — it's unavailable during SSR.)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notes-active-id")
      if (saved) setActiveId(saved)
    } catch {}
  }, [])

  // Persist the open note id whenever it changes. Skip the first run (mount,
  // before the restore effect above has applied) so we don't clobber the
  // stored value with the initial null.
  useEffect(() => {
    if (!persistRef.current) {
      persistRef.current = true
      return
    }
    try {
      if (activeId) localStorage.setItem("notes-active-id", activeId)
      else localStorage.removeItem("notes-active-id")
    } catch {}
  }, [activeId])

  // If the restored note no longer exists (deleted), drop back to the empty state.
  useEffect(() => {
    if (
      activeNoteError instanceof AxiosError &&
      activeNoteError.response?.status === 404
    ) {
      setActiveId(null)
      setDraft(emptyDraft())
    }
  }, [activeNoteError])

  // Load active note → draft (skip if we just saved and don't want a clobber)
  useEffect(() => {
    if (!activeNote) return
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false
      return
    }
    setDraft({
      title: activeNote.title || "",
      emoji: activeNote.emoji || "📄",
      tags: activeNote.tags || [],
      pinned: !!activeNote.pinned,
      folderId: activeNote.folderId ?? null,
    })
    setDirty(false)
    setMetaReadOnly(false)
  }, [activeNote])

  // Content read-only (known up front, §3.3) or metadata 403 fallback.
  const readOnly = metaReadOnly || collabUi.canWrite === false

  // Metadata auto-save (debounced). Skipped once we know the note is read-only.
  useEffect(() => {
    if (!dirty || !activeId || readOnly) return
    const t = setTimeout(() => {
      skipNextLoadRef.current = true
      m.update.mutate(
        { id: activeId, body: draft, config: { _skipErrorToast: true } },
        {
          onSuccess: () => setDirty(false),
          onError: (err) => {
            skipNextLoadRef.current = false
            if (
              err instanceof AxiosError &&
              err.response?.status === 403
            ) {
              setMetaReadOnly(true)
              return
            }
            toast("Save failed", "error")
          },
        },
      )
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [dirty, activeId, draft, m, readOnly])

  // Close popovers on outside click. Skip while a portal Modal is open.
  useEffect(() => {
    if (!emojiOpen && !tplOpen && !widthOpen) return
    const onDoc = (e: MouseEvent) => {
      if (document.querySelector(".animate-modal-in")) return
      const t = e.target as HTMLElement
      if (emojiOpen && emojiBtnRef.current && !emojiBtnRef.current.contains(t))
        setEmojiOpen(false)
      if (tplOpen && tplBtnRef.current && !tplBtnRef.current.contains(t))
        setTplOpen(false)
      if (widthOpen && widthBtnRef.current && !widthBtnRef.current.contains(t))
        setWidthOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [emojiOpen, tplOpen, widthOpen])

  // Keyboard shortcuts: Ctrl+S (save details), Ctrl+Shift+N, Esc (exit fullscreen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault()
        manualSave()
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault()
        createNote(null)
      }
      if (e.key === "Escape" && isFullscreen) {
        e.preventDefault()
        setIsFullscreen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, draft, isFullscreen])

  // Load layout preferences from localStorage after mount (unavailable in SSR).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notes-header-compact")
      if (saved !== null) setHeaderCompact(saved === "true")
      const w = localStorage.getItem("notes-editor-width")
      if (w && WIDTHS.some((o) => o.key === w)) setWidth(w as WidthKey)
    } catch {}
  }, [])

  // Lock body scroll while fullscreen
  useEffect(() => {
    if (!isFullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [isFullscreen])

  const updateDraft = (patch: Partial<Draft>) => {
    if (readOnly) return
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
  }

  const createNote = (folderId: string | null, fromTpl?: string) => {
    const tpl = fromTpl ? TEMPLATES.find((t) => t.key === fromTpl) : null
    // Template creation still POSTs blocks[] — the API's lazy migration
    // converts them to contentHTML on first open (spec §4).
    const body = tpl
      ? {
          title: tpl.title,
          emoji: tpl.emoji,
          tags: [...tpl.tags],
          blocks: tpl.blocks.map((b) => ({ ...b })),
          pinned: false,
          folderId,
        }
      : {
          ...emptyDraft(folderId),
          blocks: [{ type: "text" as const, value: "" }],
        }
    m.create.mutate(body, {
      onSuccess: (n: Note) => {
        setActiveId(n._id)
        toast(tpl ? "Template loaded" : "Note created", "success")
      },
      onError: () => toast("Failed to create note", "error"),
    })
  }

  const manualSave = () => {
    if (!activeId || !dirty || readOnly) return
    skipNextLoadRef.current = true
    m.update.mutate(
      { id: activeId, body: draft, config: { _skipErrorToast: true } },
      {
        onSuccess: () => {
          setDirty(false)
          toast("Details saved", "success")
        },
        onError: (err) => {
          skipNextLoadRef.current = false
          if (
            err instanceof AxiosError &&
            err.response?.status === 403
          ) {
            setMetaReadOnly(true)
            return
          }
          toast("Save failed", "error")
        },
      },
    )
  }

  // Content lives in Yjs and is snapshotted server-side — no pre-export flush.
  // (Edits inside the snapshot debounce window may miss the PDF by a few
  // seconds; accepted, matches wiki.)
  const exportPdf = async () => {
    if (!activeId) return
    try {
      toast("Generating PDF…", "info")
      const blob = await notesApi.exportPdf(activeId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${(draft.title || "note").replace(/[\\/:*?"<>|]+/g, "").trim() || "note"}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast("PDF downloaded", "success")
    } catch {
      toast("PDF export failed", "error")
    }
  }

  const togglePin = () => {
    if (!activeId || readOnly) return
    const next = !draft.pinned
    setDraft((d) => ({ ...d, pinned: next }))
    setDirty(true)
  }

  const deleteCurrent = () => {
    if (!activeId) return
    m.remove.mutate(activeId, {
      onSuccess: () => {
        setActiveId(null)
        setDraft(emptyDraft())
        setDirty(false)
      },
    })
  }

  const moveTo = (folderId: string | null) => {
    if (!activeId || readOnly) return
    setDraft((d) => ({ ...d, folderId }))
    setDirty(true)
    setMoveOpen(false)
  }

  const addTag = () => {
    const v = tagInput.trim().replace(/^#/, "")
    if (!v) return
    if (draft.tags.includes(v)) {
      setTagInput("")
      return
    }
    updateDraft({ tags: [...draft.tags, v] })
    setTagInput("")
  }

  const removeTag = (i: number) =>
    updateDraft({ tags: draft.tags.filter((_, idx) => idx !== i) })

  const toggleHeaderCompact = () => {
    const next = !headerCompact
    setHeaderCompact(next)
    try { localStorage.setItem("notes-header-compact", String(next)) } catch {}
  }

  const pickWidth = (key: WidthKey) => {
    setWidth(key)
    setWidthOpen(false)
    try { localStorage.setItem("notes-editor-width", key) } catch {}
  }

  const widthCls =
    (WIDTHS.find((o) => o.key === width) ?? WIDTHS[2]).cls

  const folderPath = useMemo(() => {
    const map = new Map(folders.map((f) => [f._id, f]))
    const walk = (id: string | null): string[] => {
      if (!id) return []
      const f = map.get(id)
      if (!f) return []
      return [...walk(f.parentId), f.name]
    }
    return (id: string | null) => walk(id)
  }, [folders])

  // Read-only banner copy (§3.3) — derived from data already on hand.
  const activeFolder: NoteFolder | undefined = activeNote?.folderId
    ? folders.find((f) => f._id === activeNote.folderId)
    : undefined
  const readOnlyNotice: React.ReactNode =
    activeFolder?._access === "read" ? (
      <>
        View only — you have read access to the folder{" "}
        <strong>{activeFolder.name}</strong>.
      </>
    ) : activeFolder?._access === "upload" &&
      activeNote &&
      me &&
      activeNote.ownerId !== me.id ? (
      <>
        View only — upload access lets you add your own notes to{" "}
        <strong>{activeFolder.name}</strong>, but only its author can edit
        this one.
      </>
    ) : (
      <>View only — you don&apos;t have permission to edit this note.</>
    )

  // Footer dot + text (§1.4), mirroring the sync pill.
  const footer = collabUi.tokenFailed
    ? { dot: "bg-red", text: "Disconnected" }
    : collabUi.rejected
      ? { dot: "bg-red", text: "Access to this note was refused" }
      : collabUi.unreachable
      ? { dot: "bg-red", text: "Collaboration server unreachable" }
      : collabUi.connecting || collabUi.status === "connecting"
        ? { dot: "bg-text-muted", text: "Connecting…" }
        : collabUi.status === "disconnected"
          ? { dot: "bg-amber", text: "Offline — edits stored locally" }
          : collabUi.saveState === "saving"
            ? { dot: "bg-amber", text: "Syncing…" }
            : { dot: "bg-green", text: "Synced" }

  return (
    <div
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-50 bg-bg p-4"
          : embedded
            ? "h-full"
            : "h-[calc(100vh-60px)] -my-5",
      )}
    >
      <main className="h-full bg-bg-card border border-border rounded-lg flex flex-col overflow-hidden relative">
        {/* Action bar — document actions *and* the formatting toolbar, which
            used to sit above the text. The toolbar is always exactly one line
            (it collapses its own tail into a "More" popover), so the only
            question here is whether it shares this row: from xl up it does,
            below that it takes a full-width line of its own rather than being
            squeezed to nothing by the document actions. */}
        <div className="flex-shrink-0 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-border bg-[color:color-mix(in_srgb,var(--bg-card)_92%,transparent)] backdrop-blur relative z-10">
          {/* Browse notes */}
          <button
            type="button"
            title="Browse notes"
            onClick={() => setTreeOpen((v) => !v)}
            className={cn(
              "order-1 w-8 h-8 rounded-sm flex items-center justify-center transition-all duration-[var(--dur)]",
              treeOpen
                ? "bg-accent-50 text-accent shadow-xs"
                : "text-text-muted hover:bg-bg-hover hover:text-text",
            )}
          >
            <ListTree className="w-3.5 h-3.5" />
          </button>

          {/* Formatting toolbar (spec §2.3). Read-only notes get no toolbar —
              the lock banner in the card explains why. */}
          {activeId && collabUi.canWrite !== false && (
            <div className="order-3 w-full min-w-0 mt-1 pt-1.5 border-t border-border xl:order-2 xl:w-auto xl:flex-1 xl:mt-0 xl:pt-0 xl:border-t-0 xl:pl-1">
              <CollabToolbar
                editor={editor}
                onUpload={uploadEditorFile}
                variant="bar"
              />
            </div>
          )}

          {/* Document actions. On the shared row a left border keeps them from
              reading as a continuation of the formatting controls. */}
          <div className="order-2 ml-auto flex flex-wrap items-center justify-end gap-1 xl:order-3 xl:border-l xl:border-border xl:pl-2">
            {/* Presence + sync pill (§1.3/§1.4) — before the buttons so they stay
                visible at narrow widths. */}
            {activeId && (
              <>
                <PresenceStack users={collabUi.presence} />
                <SyncPill
                  connecting={collabUi.connecting}
                  status={collabUi.status}
                  tokenFailed={collabUi.tokenFailed}
                  unreachable={collabUi.unreachable}
                  rejected={collabUi.rejected}
                  onRetry={() => retryRef.current()}
                />
              </>
            )}

            <div ref={tplBtnRef} className="relative">
              <ActionButton
                title="Templates"
                onClick={() => setTplOpen((v) => !v)}
              >
                <Zap className="w-3.5 h-3.5" />
              </ActionButton>
              {tplOpen && (
                <div className="absolute right-0 top-full mt-1 w-[280px] bg-bg-card border border-border rounded-md shadow-lg overflow-hidden animate-slide-up z-20">
                  <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[.06em] font-bold text-text-muted border-b border-border">
                    Templates
                  </div>
                  {TEMPLATES.map((t) => {
                    const Icon = TEMPLATE_ICONS[t.key] || Sparkles
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          setTplOpen(false)
                          createNote(draft.folderId ?? null, t.key)
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-hover"
                      >
                        <Icon className="w-4 h-4 text-text-muted flex-shrink-0" />
                        <div className="flex-1 min-w-0 leading-tight">
                          <strong className="block text-[12.5px]">
                            {t.title}
                          </strong>
                          <span className="block text-[11px] text-text-muted">
                            {t.caption}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <ActionButton
              title={draft.pinned ? "Unpin" : "Pin"}
              onClick={togglePin}
              disabled={!activeId || readOnly}
              active={draft.pinned}
            >
              <Star className={cn("w-3.5 h-3.5", draft.pinned && "fill-amber")} />
            </ActionButton>
            <ActionButton
              title="Move to folder"
              onClick={() => setMoveOpen(true)}
              disabled={!activeId || readOnly}
            >
              <FolderIcon className="w-3.5 h-3.5" />
            </ActionButton>
            <ActionButton
              title="Delete note"
              onClick={() => setConfirmDelete(true)}
              disabled={!activeId || readOnly}
              danger
            >
              <Trash2 className="w-3.5 h-3.5" />
            </ActionButton>
            <ActionButton
              title="Export as PDF"
              onClick={exportPdf}
              disabled={!activeId}
            >
              <Download className="w-3.5 h-3.5" />
            </ActionButton>
            <span className="w-px h-5 bg-border mx-1" />
            <button
              type="button"
              title={headerCompact ? "Show full header" : "Compact header"}
              onClick={toggleHeaderCompact}
              className={cn(
                "w-8 h-8 rounded-sm flex items-center justify-center text-[11px] font-bold transition-colors",
                headerCompact
                  ? "bg-accent-50 text-accent"
                  : "text-text-muted hover:bg-bg-hover hover:text-text",
              )}
            >
              S
            </button>

            {/* Content width — how much gutter is left on either side. */}
            <div ref={widthBtnRef} className="relative">
              <ActionButton
                title="Content width"
                onClick={() => setWidthOpen((v) => !v)}
                active={widthOpen}
              >
                <StretchHorizontal className="w-3.5 h-3.5" />
              </ActionButton>
              {widthOpen && (
                <div className="absolute right-0 top-full mt-1 w-[200px] bg-bg-card border border-border rounded-md shadow-lg overflow-hidden animate-slide-up z-20">
                  <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[.06em] font-bold text-text-muted border-b border-border">
                    Content width
                  </div>
                  {WIDTHS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => pickWidth(o.key)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-bg-hover",
                        width === o.key && "text-accent",
                      )}
                    >
                      <span className="flex-1">{o.label}</span>
                      <span className="text-[11px] text-text-muted">
                        {o.hint}
                      </span>
                      {width === o.key && (
                        <Check className="w-3.5 h-3.5 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="w-px h-5 bg-border mx-1" />
            <ActionButton
              title="New folder"
              onClick={() => setFolderPrompt({ parentId: null })}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </ActionButton>
            <ActionButton title="New note" onClick={() => createNote(null)}>
              <FilePlus className="w-3.5 h-3.5" />
            </ActionButton>
            <ActionButton
              title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
              onClick={() => setIsFullscreen((v) => !v)}
              active={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </ActionButton>
            <ActionButton
              title={readOnly ? "Read-only" : "Save details"}
              onClick={manualSave}
              disabled={!activeId || !dirty || readOnly}
              primary
            >
              <Save className="w-3.5 h-3.5" />
            </ActionButton>
          </div>{/* action group */}
        </div>{/* action bar */}

        <div className="flex-1 relative overflow-hidden">
          {treeOpen && (
            <>
              {/* Backdrop z-20 — transparent, closes on click outside popup */}
              <div
                className="absolute inset-0 z-20"
                onMouseDown={() => setTreeOpen(false)}
              />
              {/* Popup z-30 — same stacking context as backdrop, always on top */}
              <div className="absolute left-4 top-2 w-[300px] h-[520px] z-30 origin-top-left flex flex-col bg-bg-card border border-border rounded-lg shadow-xl overflow-hidden animate-popover-in">
                <NoteTree
                  activeId={activeId}
                  onPick={(id) => { setActiveId(id); setTreeOpen(false) }}
                  onNewNote={(folderId) => { createNote(folderId); setTreeOpen(false) }}
                  onNewFolder={(parentId) => { setFolderPrompt({ parentId }); setTreeOpen(false) }}
                />
              </div>
            </>
          )}

          {/* Editor */}
          <div className="absolute inset-0 overflow-y-auto">
        {!activeId ? (
          <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-text-muted">
            <NotebookPen className="w-10 h-10 opacity-50" />
            <p className="text-[13px]">
              Select a note from the sidebar or create a new one.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => createNote(null)}
            >
              <FilePlus className="w-3.5 h-3.5" /> New note
            </Button>
          </div>
        ) : (
          <div className={cn("mx-auto py-6 px-4 sm:px-6", widthCls)}>
            <fieldset
              disabled={readOnly}
              className="contents disabled:opacity-100"
            >
            <div className={cn("flex items-center gap-2 mb-2", headerCompact && "pb-2.5 border-b border-border")}>
              <div ref={emojiBtnRef} className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen((v) => !v)}
                  className={cn(
                    "rounded-md flex items-center justify-center hover:bg-bg-subtle transition-colors disabled:hover:bg-transparent disabled:cursor-not-allowed",
                    headerCompact ? "w-6 h-6 rounded-sm" : "w-12 h-12",
                  )}
                  title="Change icon"
                >
                  <NoteIcon value={draft.emoji} size={headerCompact ? 16 : 32} />
                </button>
                {emojiOpen && (
                  <div className="absolute left-0 top-full mt-1 w-[300px] bg-bg-card border border-border rounded-md shadow-lg animate-slide-up z-20 overflow-hidden">
                    <div className="flex border-b border-border bg-bg-subtle p-1 gap-1">
                      <button
                        type="button"
                        onClick={() => setPickerTab("icon")}
                        className={cn(
                          "flex-1 text-[11.5px] font-semibold py-1.5 rounded-sm transition-colors",
                          pickerTab === "icon"
                            ? "bg-bg-card text-accent shadow-xs"
                            : "text-text-muted hover:text-text",
                        )}
                      >
                        Icons
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickerTab("emoji")}
                        className={cn(
                          "flex-1 text-[11.5px] font-semibold py-1.5 rounded-sm transition-colors",
                          pickerTab === "emoji"
                            ? "bg-bg-card text-accent shadow-xs"
                            : "text-text-muted hover:text-text",
                        )}
                      >
                        Emoji
                      </button>
                    </div>
                    <div className="p-2 max-h-[260px] overflow-y-auto">
                      {pickerTab === "icon" ? (
                        <div className="grid grid-cols-8 gap-1">
                          {LUCIDE_ICONS.map(({ name, icon: Icon }) => {
                            const val = lucideValue(name)
                            const active = draft.emoji === val
                            return (
                              <button
                                key={name}
                                type="button"
                                title={name}
                                onClick={() => {
                                  updateDraft({ emoji: val })
                                  setEmojiOpen(false)
                                }}
                                className={cn(
                                  "w-7 h-7 rounded-sm flex items-center justify-center hover:bg-bg-hover transition-colors text-text-sub",
                                  active && "bg-bg-hover text-accent",
                                )}
                              >
                                <Icon className="w-4 h-4" />
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-8 gap-1">
                          {EMOJIS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => {
                                updateDraft({ emoji: em })
                                setEmojiOpen(false)
                              }}
                              className={cn(
                                "w-7 h-7 rounded-sm text-[18px] flex items-center justify-center hover:bg-bg-hover transition-colors",
                                em === draft.emoji && "bg-bg-hover",
                              )}
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <input
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                placeholder="Untitled"
                className={cn(
                  "flex-1 bg-transparent outline-none",
                  headerCompact
                    ? "text-[14px] font-semibold text-text placeholder:text-text-muted"
                    : "text-[28px] font-extrabold tracking-[-.02em] placeholder:text-[color:color-mix(in_srgb,var(--text-muted)_70%,transparent)]",
                )}
              />
            </div>

            <div className={cn("flex flex-wrap items-center gap-1.5 mb-4", headerCompact ? "pl-8" : "pl-[64px]")}>
              {draft.tags.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent"
                >
                  #{t}
                  <button
                    type="button"
                    onClick={() => removeTag(i)}
                    className="w-3.5 h-3.5 rounded-full hover:bg-[color:color-mix(in_srgb,var(--a)_22%,transparent)] flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault()
                    addTag()
                  } else if (
                    e.key === "Backspace" &&
                    !tagInput &&
                    draft.tags.length
                  ) {
                    removeTag(draft.tags.length - 1)
                  }
                }}
                placeholder={draft.tags.length ? "Add tag…" : "# Add tag…"}
                className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-[12px] text-text-muted placeholder:text-text-muted"
              />
            </div>
            </fieldset>

            {/* Collaborative content (ADR 0009). Guard: never mount before the
                note query resolves — initialHTML must be present at mount or a
                legacy note seeds empty (§3.4). */}
            {activeNote && activeNote._id === activeId && me ? (
              <NoteEditorPane
                key={activeNote._id}
                note={activeNote}
                me={me}
                readOnlyNotice={readOnlyNotice}
                onUi={patchCollabUi}
                onWords={setWords}
                onEditor={setEditor}
                retryRef={retryRef}
              />
            ) : (
              <ConnectingPane />
            )}

            <div className="flex items-center justify-between mt-8 pt-3 border-t border-border text-[11px] text-text-muted">
              <span>
                {words} word{words === 1 ? "" : "s"} · {readTime(words)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn("w-1.5 h-1.5 rounded-full", footer.dot)}
                />
                {footer.text}
                {dirty && !readOnly && " · Saving details…"}
              </span>
            </div>
          </div>
        )}
          </div>{/* editor */}
        </div>{/* content area */}
      </main>

      <TextPrompt
        open={!!folderPrompt}
        title="New folder"
        label="Folder name"
        placeholder="e.g. Meeting notes"
        confirmLabel="Create"
        onConfirm={(name) =>
          folderPrompt &&
          m.createFolder.mutate(
            { name, parentId: folderPrompt.parentId },
            {
              onSuccess: () => toast("Folder created", "success"),
              onError: () => toast("Failed to create folder", "error"),
            },
          )
        }
        onClose={() => setFolderPrompt(null)}
      />

      <Confirm
        open={confirmDelete}
        title="Delete note"
        body={
          <>
            This will permanently delete{" "}
            <strong>{draft.title || "Untitled"}</strong>.
          </>
        }
        danger
        onConfirm={deleteCurrent}
        onClose={() => setConfirmDelete(false)}
      />

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        size="sm"
        title="Move note"
      >
        <button
          type="button"
          onClick={() => moveTo(null)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-sm text-left text-[13px] hover:bg-bg-hover",
            draft.folderId === null && "bg-bg-hover",
          )}
        >
          <FolderIcon className="w-3.5 h-3.5 text-text-muted" />
          <span className="flex-1">Root (no folder)</span>
          {draft.folderId === null && (
            <Check className="w-3.5 h-3.5 text-accent" />
          )}
        </button>
        {folders.map((f) => {
          const path = folderPath(f._id).join(" / ")
          const active = draft.folderId === f._id
          return (
            <button
              key={f._id}
              type="button"
              onClick={() => moveTo(f._id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-sm text-left text-[13px] hover:bg-bg-hover",
                active && "bg-bg-hover",
              )}
            >
              <FolderIcon className="w-3.5 h-3.5 text-text-muted" />
              <span className="flex-1 min-w-0 truncate">{path}</span>
              {active && <Check className="w-3.5 h-3.5 text-accent" />}
            </button>
          )
        })}
      </Modal>
    </div>
  )
}

/* ------------------------- Collaborative editor pane ------------------------ */

/**
 * The Yjs-backed content area for one note. Keyed by note id by the caller so
 * the collab token, provider, and seed guard all reset cleanly on note switch.
 * Presence/status/save state are lifted into the host's action bar and footer
 * via `onUi` (§1.2).
 */
function NoteEditorPane({
  note,
  me,
  readOnlyNotice,
  onUi,
  onWords,
  onEditor,
  retryRef,
}: {
  note: Note
  me: AuthUser
  readOnlyNotice: React.ReactNode
  onUi: (patch: Partial<CollabUi>) => void
  onWords: (n: number) => void
  /** Publishes the Tiptap instance to the host's action-bar toolbar. */
  onEditor: (editor: Editor | null) => void
  retryRef: React.MutableRefObject<() => void>
}) {
  const collab = useNoteCollab(note._id)

  // Hold the last good token so a failed *renewal* doesn't unmount the editor —
  // Yjs keeps buffering offline (§3.2); only a never-minted token is terminal.
  const [heldToken, setHeldToken] = useState<string | null>(null)
  useEffect(() => {
    if (collab.token) setHeldToken(collab.token)
  }, [collab.token])
  const token = collab.token ?? heldToken

  // The editor's own socket-level reconnect, published by renderChrome below.
  const socketReconnectRef = useRef<() => void>(() => {})

  // One Retry button, two possible faults: re-mint the token AND re-open the
  // socket, since the user can't tell which layer failed.
  useEffect(() => {
    const refresh = collab.refresh
    retryRef.current = () => {
      refresh()
      socketReconnectRef.current()
    }
  }, [collab.refresh, retryRef])

  // Lift token-derived state into the host chrome.
  useEffect(() => {
    onUi({
      canWrite: collab.token || heldToken ? collab.canWrite : null,
      tokenFailed: !!collab.error && !token,
      connecting: !token && !collab.error,
    })
  }, [collab.token, collab.canWrite, collab.error, heldToken, token, onUi])

  // Hand the editor to the host on ready, and take it back on unmount so the
  // toolbar can never act on a destroyed instance after a note switch.
  const onEditorRef = useRef(onEditor)
  onEditorRef.current = onEditor
  useEffect(
    () => () => {
      onEditorRef.current(null)
    },
    [],
  )

  // Word count / read time from the live doc, throttled ~500ms (§4).
  const wordsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleReady = useCallback(
    (editor: Editor) => {
      onEditorRef.current(editor)
      const compute = () => {
        if (editor.isDestroyed) return
        const doc = editor.state.doc
        const text = doc.textBetween(0, doc.content.size, " ", " ")
        onWords((text.match(/\S+/g) || []).length)
      }
      compute()
      editor.on("update", () => {
        if (wordsTimer.current) return
        wordsTimer.current = setTimeout(() => {
          wordsTimer.current = null
          compute()
        }, 500)
      })
    },
    [onWords],
  )
  useEffect(
    () => () => {
      if (wordsTimer.current) clearTimeout(wordsTimer.current)
    },
    [],
  )

  // Token mint failed before we ever connected → red empty-state (§3.2).
  if (!token && collab.error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted border border-border rounded-lg">
        <CloudOff className="w-8 h-8 opacity-60" />
        <p className="text-[13px]">
          Connection to the collaboration server was lost.
        </p>
        <Button size="sm" variant="outline" onClick={collab.refresh}>
          Retry
        </Button>
      </div>
    )
  }

  // Token still minting → connecting skeleton (§3.1).
  if (!token) return <ConnectingPane />

  const canWrite = collab.canWrite

  return (
    <div className="border border-border rounded-lg bg-bg-card">
      <CollaborativeEditor
        documentName={`notes:${note._id}`}
        wsUrl={LIVE_URL}
        token={token}
        currentUser={{
          id: me.id,
          name: me.name,
          color: userColor(me.id),
          avatar: me.avatar ?? null,
        }}
        initialHTML={note.contentHTML}
        editable={canWrite}
        placeholder={EDITOR_PLACEHOLDER}
        autofocus={canWrite}
        onPresenceChange={(presence) => onUi({ presence })}
        onStatusChange={(status) => onUi({ status })}
        onSaveStateChange={(saveState) => onUi({ saveState })}
        onReady={handleReady}
        className="prism-collab-inline"
        renderChrome={({ unreachable, rejected, reconnect }) => (
          <>
            <CollabChromeSync
              unreachable={unreachable}
              rejected={rejected}
              reconnect={reconnect}
              onUi={onUi}
              reconnectRef={socketReconnectRef}
            />
            {(unreachable || rejected) && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg border-b border-border bg-[color:color-mix(in_srgb,var(--red)_8%,transparent)] text-[12px] text-text-sub">
                <CloudOff className="w-3.5 h-3.5 flex-shrink-0 text-red" />
                <span className="flex-1">
                  {rejected ? (
                    <>
                      The collaboration server refused this session — your access
                      may have changed, or the editing token expired. Your edits
                      are kept locally.
                    </>
                  ) : (
                    <>
                      Can&apos;t reach the collaboration server — your edits are
                      kept locally and will sync once it&apos;s back.
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={reconnect}
                  className="underline underline-offset-2 font-semibold text-red"
                >
                  Retry
                </button>
              </div>
            )}
            {!canWrite && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg border-b border-border bg-bg-subtle text-[12px] text-text-sub">
                <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{readOnlyNotice}</span>
              </div>
            )}
          </>
        )}
      />
    </div>
  )
}

/**
 * Effect-only bridge: `renderChrome` runs during the editor's render, so the
 * socket-level state it hands us has to be lifted from a child component rather
 * than set inline. Renders nothing.
 */
function CollabChromeSync({
  unreachable,
  rejected,
  reconnect,
  onUi,
  reconnectRef,
}: {
  unreachable: boolean
  rejected: boolean
  reconnect: () => void
  onUi: (patch: Partial<CollabUi>) => void
  reconnectRef: React.MutableRefObject<() => void>
}) {
  useEffect(() => {
    onUi({ unreachable, rejected })
  }, [unreachable, rejected, onUi])

  useEffect(() => {
    reconnectRef.current = reconnect
  }, [reconnect, reconnectRef])

  return null
}

/**
 * Connecting state (§3.1). The toolbar lives in the action bar now, where it
 * renders its own disabled skeleton while `editor` is null — so this pane only
 * has to stand in for the text.
 */
function ConnectingPane() {
  return (
    <div
      aria-busy="true"
      className="border border-border rounded-lg bg-bg-card"
    >
      <div className="px-4 py-4">
        <SkeletonText lines={6} />
      </div>
    </div>
  )
}

/* ------------------------------ Presence stack ----------------------------- */

/** Remote peers (§1.3): xs avatars, caret-colored rings, max 4 + overflow. */
function PresenceStack({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null
  const shown = users.slice(0, 4)
  const rest = users.length - shown.length
  return (
    <span
      className="inline-flex items-center mr-1.5"
      role="img"
      aria-label={`${users.length} other ${users.length === 1 ? "person" : "people"} editing`}
    >
      {shown.map((u) => (
        <span
          key={u.id}
          title={u.name}
          className="inline-flex rounded-full ring-2 -ml-1 first:ml-0"
          style={{ "--tw-ring-color": u.color } as React.CSSProperties}
        >
          <Avatar name={u.name} src={u.avatar} size="xs" />
        </span>
      ))}
      {rest > 0 && (
        <span className="-ml-1 inline-flex items-center justify-center rounded-full bg-bg-subtle text-text-muted text-[10px] font-semibold ring-1 ring-bg-card px-1 h-4 min-w-4">
          +{rest}
        </span>
      )}
    </span>
  )
}

/* -------------------------------- Sync pill -------------------------------- */

/**
 * Connection pill (§1.4). Hidden when connected — quiet when healthy; the
 * footer dot carries the "Synced/Syncing" detail.
 */
function SyncPill({
  connecting,
  status,
  tokenFailed,
  unreachable,
  rejected,
  onRetry,
}: {
  connecting: boolean
  status: ConnectionStatus
  tokenFailed: boolean
  unreachable: boolean
  rejected: boolean
  onRetry: () => void
}) {
  let pill: React.ReactNode = null
  if (tokenFailed) {
    pill = (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[color:color-mix(in_srgb,var(--red)_12%,transparent)] text-red">
        Can&apos;t connect
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 font-semibold"
        >
          Retry
        </button>
      </span>
    )
  } else if (rejected) {
    pill = (
      <span
        title="The live server answered but refused this session — the collab token expired or your access to the note changed. Retry re-mints it."
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[color:color-mix(in_srgb,var(--red)_12%,transparent)] text-red"
      >
        <Lock className="w-3 h-3" />
        Access refused
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 font-semibold"
        >
          Retry
        </button>
      </span>
    )
  } else if (unreachable) {
    pill = (
      <span
        title="The live collaboration server (apps/live, :3100) is not responding. Start it with `pnpm dev:live`."
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[color:color-mix(in_srgb,var(--red)_12%,transparent)] text-red"
      >
        <CloudOff className="w-3 h-3" />
        Server unreachable
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 font-semibold"
        >
          Retry
        </button>
      </span>
    )
  } else if (connecting || status === "connecting") {
    pill = (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-bg-subtle text-text-muted">
        <Loader2 className="w-3 h-3 animate-spin" />
        Connecting…
      </span>
    )
  } else if (status === "disconnected") {
    pill = (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[color:color-mix(in_srgb,var(--amber)_14%,transparent)] text-amber">
        <CloudOff className="w-3 h-3" />
        Offline — reconnecting
      </span>
    )
  }
  return (
    <span aria-live="polite" className="inline-flex items-center mr-1">
      {pill}
    </span>
  )
}

function ActionButton({
  children,
  title,
  onClick,
  disabled,
  active,
  danger,
  primary,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
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
          ? "text-amber bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"
          : primary
            ? "text-accent hover:bg-accent-50"
            : danger
              ? "text-text-muted hover:bg-bg-hover hover:text-red"
              : "text-text-muted hover:bg-bg-hover hover:text-text",
      )}
    >
      {children}
    </button>
  )
}
