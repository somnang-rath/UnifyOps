"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { AxiosError } from "axios"
import {
  BookOpen,
  Check,
  Download,
  FilePlus,
  Folder as FolderIcon,
  FolderPlus,
  ListTree,
  Lock,
  Maximize2,
  Mic,
  Minimize2,
  NotebookPen,
  Save,
  Sparkles,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import {
  notesApi,
  useNote,
  useNoteFolders,
  useNoteMutations,
} from "@/hooks/use-notes"
import { toast } from "@/stores/toast-store"
import { Confirm } from "@/components/ui/confirm"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { relTime } from "@/lib/format"
import type { Note, NoteBlock } from "@/schemas/note"
import { BlockEditor } from "./_components/block-editor"
import { NoteTree } from "./_components/note-tree"
import { TextPrompt } from "./_components/text-prompt"
import {
  AUTOSAVE_MS,
  EMOJIS,
  TEMPLATES,
  readTime,
  wordCount,
} from "./_components/constants"
import { LUCIDE_ICONS, NoteIcon, lucideValue } from "./_components/note-icon"

interface Draft {
  title: string
  emoji: string
  blocks: NoteBlock[]
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

const emptyDraft = (folderId: string | null = null): Draft => ({
  title: "",
  emoji: "📄",
  blocks: [{ type: "text", value: "" }],
  tags: [],
  pinned: false,
  folderId,
})

export default function NotesPage() {
  const { data: folders = [] } = useNoteFolders()
  const m = useNoteMutations()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [dirty, setDirty] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [tagInput, setTagInput] = useState("")
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<"icon" | "emoji">("icon")
  const [tplOpen, setTplOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [headerCompact, setHeaderCompact] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [folderPrompt, setFolderPrompt] = useState<{
    parentId: string | null
  } | null>(null)
  const skipNextLoadRef = useRef(false)
  const emojiBtnRef = useRef<HTMLDivElement>(null)
  const tplBtnRef = useRef<HTMLDivElement>(null)

  const { data: activeNote } = useNote(activeId)

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
      blocks:
        activeNote.blocks && activeNote.blocks.length
          ? activeNote.blocks.map((b) => ({ ...b }))
          : [{ type: "text", value: "" }],
      tags: activeNote.tags || [],
      pinned: !!activeNote.pinned,
      folderId: activeNote.folderId ?? null,
    })
    setDirty(false)
    setReadOnly(false)
  }, [activeNote])

  // Auto-save (debounced). Skipped entirely once we've learned the note is read-only.
  useEffect(() => {
    if (!dirty || !activeId || readOnly) return
    const t = setTimeout(() => {
      skipNextLoadRef.current = true
      m.update.mutate(
        { id: activeId, body: draft, config: { _skipErrorToast: true } },
        {
          onSuccess: () => {
            setDirty(false)
            setSavedAt(new Date())
          },
          onError: (err) => {
            skipNextLoadRef.current = false
            if (
              err instanceof AxiosError &&
              err.response?.status === 403
            ) {
              setReadOnly(true)
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
    if (!emojiOpen && !tplOpen) return
    const onDoc = (e: MouseEvent) => {
      if (document.querySelector(".animate-modal-in")) return
      const t = e.target as HTMLElement
      if (emojiOpen && emojiBtnRef.current && !emojiBtnRef.current.contains(t))
        setEmojiOpen(false)
      if (tplOpen && tplBtnRef.current && !tplBtnRef.current.contains(t))
        setTplOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [emojiOpen, tplOpen])

  // Keyboard shortcuts: Ctrl+S, Ctrl+Shift+N, Esc (exit fullscreen)
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

  // Load header-compact preference from localStorage after mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("notes-header-compact")
      if (saved !== null) setHeaderCompact(saved === "true")
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

  const setBlocks = (
    next: NoteBlock[] | ((prev: NoteBlock[]) => NoteBlock[]),
  ) => {
    setDraft((d) => ({
      ...d,
      blocks: typeof next === "function" ? next(d.blocks) : next,
    }))
  }

  const createNote = (folderId: string | null, fromTpl?: string) => {
    const tpl = fromTpl ? TEMPLATES.find((t) => t.key === fromTpl) : null
    const body: Draft = tpl
      ? {
          title: tpl.title,
          emoji: tpl.emoji,
          tags: [...tpl.tags],
          blocks: tpl.blocks.map((b) => ({ ...b })),
          pinned: false,
          folderId,
        }
      : emptyDraft(folderId)
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
          setSavedAt(new Date())
          toast("Note saved", "success")
        },
        onError: (err) => {
          skipNextLoadRef.current = false
          if (
            err instanceof AxiosError &&
            err.response?.status === 403
          ) {
            setReadOnly(true)
            return
          }
          toast("Save failed", "error")
        },
      },
    )
  }

  const exportPdf = async () => {
    if (!activeId) return
    try {
      if (dirty && !readOnly) {
        skipNextLoadRef.current = true
        await m.update.mutateAsync({ id: activeId, body: draft })
        setDirty(false)
        setSavedAt(new Date())
      }
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

  const wordsTotal = wordCount(draft.blocks)
  const status = !activeId
    ? "New — not yet saved"
    : readOnly
      ? "Read-only"
      : dirty
        ? "Saving…"
        : savedAt
          ? `Saved · ${savedAt.toLocaleTimeString()}`
          : activeNote
            ? `Last edited ${relTime(activeNote.updatedAt)}`
            : ""

  return (
    <div
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-50 bg-bg p-4"
          : "h-[calc(100vh-60px)] -my-5",
      )}
    >
      <main className="h-full bg-bg-card border border-border rounded-lg flex flex-col overflow-hidden relative">
        {/* Action bar */}
        <div className="flex-shrink-0 flex items-center gap-1 px-4 py-2.5 border-b border-border bg-[color:color-mix(in_srgb,var(--bg-card)_92%,transparent)] backdrop-blur relative z-10">
          {/* Browse notes */}
          <button
            type="button"
            title="Browse notes"
            onClick={() => setTreeOpen((v) => !v)}
            className={cn(
              "w-8 h-8 rounded-sm flex items-center justify-center transition-all duration-[var(--dur)]",
              treeOpen
                ? "bg-accent-50 text-accent shadow-xs"
                : "text-text-muted hover:bg-bg-hover hover:text-text",
            )}
          >
            <ListTree className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1" />
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
            title={readOnly ? "Read-only" : "Save"}
            onClick={manualSave}
            disabled={!activeId || !dirty || readOnly}
            primary
          >
            <Save className="w-3.5 h-3.5" />
          </ActionButton>
        </div>

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
          <div className="max-w-[760px] mx-auto py-6 px-6">
            {readOnly && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-subtle text-[12px] text-text-sub">
                <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  Read-only — you don't have permission to edit this note.
                </span>
              </div>
            )}
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

            <BlockEditor
              blocks={draft.blocks}
              setBlocks={setBlocks}
              onDirty={() => setDirty(true)}
            />
            </fieldset>

            <div className="flex items-center justify-between mt-8 pt-3 border-t border-border text-[11px] text-text-muted">
              <span>
                {wordsTotal} word{wordsTotal === 1 ? "" : "s"} ·{" "}
                {readTime(wordsTotal)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    readOnly
                      ? "bg-text-muted"
                      : dirty
                        ? "bg-amber"
                        : "bg-green",
                  )}
                />
                {status}
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
