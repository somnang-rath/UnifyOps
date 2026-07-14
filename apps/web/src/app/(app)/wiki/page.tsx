"use client"
import { useEffect, useRef, useState } from "react"
import { AxiosError } from "axios"
import {
  Copy,
  CloudOff,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { Select } from "@/components/ui/select"
import { SkeletonText } from "@/components/ui/skeleton"
import { MarkdownView } from "@/components/feature/issue/markdown-view"
import { useDebounce } from "@/hooks/use-debounce"
import { useProjects } from "@/hooks/use-projects"
import { useWikiList, useWikiMutations, useWikiPage } from "@/hooks/use-wiki"
import { useWikiPublish } from "@/hooks/use-wiki-publish"
import { useAssistantContext } from "@/hooks/use-assistant-context"
import { useAuthStore } from "@/stores/auth-store"
import { toast } from "@/stores/toast-store"
import { cn } from "@/lib/utils"
import type { WikiPage, WikiPageMeta } from "@/schemas/wiki"

type Draft = { active: boolean; title: string; content: string }
type Mode = "edit" | "preview"

const emptyDraft = (): Draft => ({ active: false, title: "", content: "" })

// Public Space origin — used to build the shareable link (ADR 0002 §6).
const SPACE_URL = process.env.NEXT_PUBLIC_SPACE_URL ?? ""

const PLACEHOLDER = "Start writing… Markdown is supported (headings, tables, code, links)."

export default function WikiPageRoute() {
  const me = useAuthStore((s) => s.user)
  const { data: projects = [] } = useProjects()
  const [projectId, setProjectId] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [mode, setMode] = useState<Mode>("preview")
  const [deleting, setDeleting] = useState(false)
  const [q, setQ] = useState("")
  const debouncedQ = useDebounce(q, 220)
  const [treeOpen, setTreeOpen] = useState(false)
  const treeBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!treeOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (treeBtnRef.current && !treeBtnRef.current.contains(t))
        setTreeOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [treeOpen])

  // Restore the last project + open page on mount so switching to another page
  // and coming back keeps your place. (localStorage is unavailable during SSR,
  // so read it in an effect rather than a lazy initializer.)
  useEffect(() => {
    try {
      const p = localStorage.getItem("wiki-project")
      const a = localStorage.getItem("wiki-active")
      if (p) setProjectId(p)
      if (a) setActiveId(a)
    } catch {}
    setHydrated(true)
  }, [])

  // Auto-select the first project only once restore has run and nothing is set.
  useEffect(() => {
    if (!hydrated) return
    if (!projectId && projects.length) setProjectId(projects[0]._id)
  }, [projects, projectId, hydrated])

  // Persist project + open page so they re-open when returning to this page.
  useEffect(() => {
    if (!hydrated) return
    try {
      if (projectId) localStorage.setItem("wiki-project", projectId)
      else localStorage.removeItem("wiki-project")
      if (activeId) localStorage.setItem("wiki-active", activeId)
      else localStorage.removeItem("wiki-active")
    } catch {}
  }, [projectId, activeId, hydrated])

  const { data: pages = [] } = useWikiList(projectId, debouncedQ)
  const { data: activePage, error: activePageError } = useWikiPage(activeId)
  const m = useWikiMutations(projectId)
  const pub = useWikiPublish(projectId)

  // Ground the assistant on the page currently open (ADR: AI assistant §12).
  useAssistantContext(
    activePage
      ? {
          type: "wiki",
          id: activePage._id,
          title: activePage.title,
          text: activePage.content?.slice(0, 20000),
        }
      : null,
  )

  useEffect(() => {
    if (!activePage) return
    setDraft({
      active: true,
      title: activePage.title,
      content: activePage.content,
    })
  }, [activePage])

  // If the restored page no longer exists (deleted), drop back to the empty state.
  useEffect(() => {
    if (
      activePageError instanceof AxiosError &&
      activePageError.response?.status === 404
    ) {
      setActiveId(null)
      setDraft(emptyDraft())
    }
  }, [activePageError])

  // Switching project clears the current selection. Done in the handler (not a
  // [projectId] effect) so restoring a saved project doesn't wipe the saved page.
  const changeProject = (id: string) => {
    setProjectId(id)
    setActiveId(null)
    setDraft(emptyDraft())
    setQ("")
  }

  const projectOptions = [
    { value: "", label: "Select project…" },
    ...projects.map((p) => ({ value: p._id, label: p.name })),
  ]

  const selectPage = (id: string) => {
    setActiveId(id)
    setMode("preview")
  }

  const newPage = () => {
    if (!projectId) {
      toast("Select a project first", "error")
      return
    }
    setActiveId(null)
    setDraft({ active: true, title: "", content: "" })
    setMode("edit")
  }

  // Create a brand-new page (REST). Once it returns an id, it becomes the active
  // page and content is persisted with subsequent saves.
  const createPage = () => {
    if (!projectId) return
    const title = draft.title.trim()
    if (!title) {
      toast("Title required", "error")
      return
    }
    m.create.mutate(
      { projectId, title, content: draft.content },
      {
        onSuccess: (p) => {
          setActiveId(p._id)
          setMode("preview")
        },
      },
    )
  }

  // Persist title + content of the open page (REST).
  const savePage = () => {
    if (!activeId || !activePage) return
    const title = draft.title.trim() || activePage.title
    m.update.mutate(
      { id: activeId, body: { title, content: draft.content } },
      { onSuccess: () => setMode("preview") },
    )
  }

  const remove = () => {
    if (!activeId) return
    m.remove.mutate(activeId, {
      onSuccess: () => {
        setActiveId(null)
        setDraft(emptyDraft())
      },
    })
  }

  const dirty =
    !!activePage &&
    (draft.title.trim() !== activePage.title ||
      draft.content !== activePage.content)

  const saving = m.create.isPending || m.update.isPending

  const canDelete = !!(
    activeId &&
    activePage &&
    (me?.id === activePage.authorId || me?.role === "admin")
  )

  // Publishing to Space is a write op: the API requires project owner/member
  // (wiki.service accessFor → canWrite). `internal`/`public` projects are
  // readable by non-members, so gate the control to avoid offering an action
  // that would 403 — mirrors `canDelete`.
  const activeProject = projects.find((p) => p._id === projectId)
  const canPublish = !!(
    me &&
    activeProject &&
    (me.id === activeProject.ownerId ||
      activeProject.members.includes(me.id))
  )

  const browser = (
    <PageBrowser
      ref={treeBtnRef}
      open={treeOpen}
      setOpen={setTreeOpen}
      projectId={projectId}
      pages={pages}
      activeId={activeId}
      q={q}
      setQ={setQ}
      debouncedQ={debouncedQ}
      onSelect={selectPage}
      onNew={newPage}
    />
  )

  const modeTabs =
    draft.active ? <ModeTabs mode={mode} setMode={setMode} /> : null

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            Wiki
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            Team knowledge base
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            inline
            value={projectId}
            onValueChange={changeProject}
            options={projectOptions}
            placeholder="Select project…"
          />
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-lg overflow-hidden min-h-[600px] flex flex-col">
        {activeId && !activePage ? (
          // Saved page selected but content still loading.
          <main className="flex-1 flex flex-col overflow-hidden">
            <WikiHeader
              browser={browser}
              title={draft.title}
              onTitleChange={(v) => setDraft((d) => ({ ...d, title: v }))}
              titleDisabled
            />
            <div className="flex-1 overflow-y-auto px-7 py-6">
              <SkeletonText lines={6} className="max-w-[680px]" />
            </div>
          </main>
        ) : (
          <main className="flex-1 flex flex-col overflow-hidden">
            <WikiHeader
              browser={browser}
              title={draft.title}
              onTitleChange={(v) => setDraft((d) => ({ ...d, title: v }))}
              titleDisabled={!draft.active}
              right={
                draft.active ? (
                  <>
                    {modeTabs}
                    {!activeId ? (
                      <Button
                        size="sm"
                        variant="grad"
                        onClick={createPage}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        Save
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="grad"
                        onClick={savePage}
                        disabled={saving || !dirty}
                      >
                        {saving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        {dirty ? "Save" : "Saved"}
                      </Button>
                    )}
                    {activeId && activePage && canPublish && (
                      <PublishControl
                        page={activePage}
                        spaceUrl={SPACE_URL}
                        pending={
                          pub.publish.isPending || pub.unpublish.isPending
                        }
                        onPublish={() => pub.publish.mutate(activeId)}
                        onUnpublish={() => pub.unpublish.mutate(activeId)}
                      />
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleting(true)}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </Button>
                    )}
                  </>
                ) : null
              }
            />
            <div className="flex-1 flex overflow-hidden">
              {!draft.active ? (
                <div className="flex-1 flex items-center justify-center text-text-muted text-[13px] px-6 text-center">
                  {projectId
                    ? "Select a page or click + to start a new one."
                    : "Select a project to begin."}
                </div>
              ) : mode === "edit" ? (
                <textarea
                  value={draft.content}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, content: e.target.value }))
                  }
                  spellCheck={false}
                  placeholder={PLACEHOLDER}
                  className="flex-1 border-0 outline-none resize-none bg-bg-card font-mono text-[13px] leading-[1.7] px-7 py-6 placeholder:text-text-muted/60"
                />
              ) : (
                <div className="flex-1 overflow-y-auto px-7 py-6">
                  {draft.content.trim() ? (
                    <MarkdownView
                      body={draft.content}
                      className="max-w-[820px] text-[14px] leading-[1.7]"
                    />
                  ) : (
                    <p className="text-text-muted text-[13px]">
                      Nothing to preview yet — switch to Edit and start writing.
                    </p>
                  )}
                </div>
              )}
            </div>
          </main>
        )}
      </div>

      <Confirm
        open={deleting}
        title="Delete page"
        body={
          <>
            This will permanently delete{" "}
            <strong>{draft.title || "this page"}</strong>.
          </>
        }
        danger
        onConfirm={remove}
        onClose={() => setDeleting(false)}
      />
    </>
  )
}

/* ------------------------------ Header row ------------------------------ */

function WikiHeader({
  browser,
  title,
  onTitleChange,
  titleDisabled,
  right,
}: {
  browser: React.ReactNode
  title: string
  onTitleChange: (v: string) => void
  titleDisabled: boolean
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-wrap">
      {browser}
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled page"
        disabled={titleDisabled}
        className="flex-1 min-w-[200px] text-[20px] font-bold tracking-[-.02em] py-1 bg-transparent border-0 outline-none placeholder:text-text-muted/70 disabled:cursor-not-allowed"
      />
      {right && (
        <div className="flex items-center gap-2 flex-wrap">{right}</div>
      )}
    </div>
  )
}

/* ------------------------------ Edit / Preview ------------------------------ */

function ModeTabs({
  mode,
  setMode,
}: {
  mode: Mode
  setMode: (m: Mode) => void
}) {
  const tab = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-sm transition-colors",
        mode === m
          ? "bg-accent-50 text-accent shadow-xs"
          : "text-text-muted hover:bg-bg-hover hover:text-text",
      )}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-bg-subtle border border-border">
      {tab("edit", <Pencil className="w-3.5 h-3.5" />, "Edit")}
      {tab("preview", <Eye className="w-3.5 h-3.5" />, "Preview")}
    </div>
  )
}

/* --------------------------- Page browser tree --------------------------- */

const PageBrowser = ({
  ref,
  open,
  setOpen,
  projectId,
  pages,
  activeId,
  q,
  setQ,
  debouncedQ,
  onSelect,
  onNew,
}: {
  ref: React.Ref<HTMLDivElement>
  open: boolean
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void
  projectId: string
  pages: WikiPageMeta[]
  activeId: string | null
  q: string
  setQ: (v: string) => void
  debouncedQ: string
  onSelect: (id: string) => void
  onNew: () => void
}) => {
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Browse pages"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-8 h-8 rounded-sm flex items-center justify-center transition-all duration-[var(--dur)]",
          open
            ? "bg-accent-50 text-accent shadow-xs"
            : "text-text-muted hover:bg-bg-hover hover:text-text",
        )}
      >
        <ListTree className="w-3.5 h-3.5" />
      </button>
      <div
        className={cn(
          "absolute left-0 top-full mt-2 w-[340px] h-[520px] z-30 origin-top-left flex flex-col",
          "bg-[color:color-mix(in_srgb,var(--bg-card)_94%,transparent)] backdrop-blur-2xl",
          "border border-border rounded-lg shadow-xl overflow-hidden",
          open ? "animate-popover-in" : "hidden",
        )}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-text-muted">
            Pages
          </span>
          <Button
            size="sm"
            variant="grad"
            onClick={() => {
              onNew()
              setOpen(false)
            }}
            disabled={!projectId}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="px-3 py-2 border-b border-border">
          <label className="flex items-center gap-2 px-3 bg-bg-card border-[1.5px] border-border rounded-sm transition-colors duration-[var(--dur)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.12)]">
            <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pages…"
              disabled={!projectId}
              className="flex-1 min-w-0 bg-transparent border-0 outline-none py-2 text-[12.5px] placeholder:text-text-muted disabled:cursor-not-allowed"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5">
          {!projectId ? (
            <p className="px-4 py-6 text-[12.5px] text-text-muted text-center">
              Select a project
            </p>
          ) : pages.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-text-muted text-center">
              {debouncedQ ? "No matches" : "No pages yet"}
            </p>
          ) : (
            pages.map((p) => (
              <button
                key={p._id}
                onClick={() => {
                  onSelect(p._id)
                  setOpen(false)
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3.5 py-2 text-[13px] text-left transition-colors",
                  activeId === p._id
                    ? "bg-[color:color-mix(in_srgb,var(--a)_10%,transparent)] text-accent font-medium"
                    : "hover:bg-bg-hover",
                )}
              >
                <FileText
                  className={cn(
                    "w-3.5 h-3.5 flex-shrink-0",
                    activeId === p._id ? "text-accent" : "text-text-muted",
                  )}
                />
                <span className="truncate">{p.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------- Publish to Space ---------------------------- */

function PublishControl({
  page,
  spaceUrl,
  pending,
  onPublish,
  onUnpublish,
}: {
  page: WikiPage
  spaceUrl: string
  pending: boolean
  onPublish: () => void
  onUnpublish: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const isPublic = !!page.isPublic && !!page.anchor
  // Space serves published pages under its /spaces base path (ADR 0002 §5).
  const url =
    isPublic && spaceUrl ? `${spaceUrl}/spaces/${page.anchor}` : ""

  const copy = () => {
    if (!url) return
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast("Link copied", "success"))
      .catch(() => toast("Could not copy link", "error"))
  }

  if (!isPublic) {
    return (
      <Button size="sm" variant="outline" onClick={onPublish} disabled={pending}>
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Globe className="w-3.5 h-3.5" />
        )}
        Publish
      </Button>
    )
  }

  return (
    <div ref={ref} className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="text-green"
      >
        <Globe className="w-3.5 h-3.5" /> Public
      </Button>
      <div
        className={cn(
          "absolute right-0 top-full mt-2 w-[320px] z-30 origin-top-right",
          "bg-[color:color-mix(in_srgb,var(--bg-card)_94%,transparent)] backdrop-blur-2xl",
          "border border-border rounded-lg shadow-xl p-3",
          open ? "animate-popover-in" : "hidden",
        )}
      >
        <p className="text-[11px] font-bold uppercase tracking-[.08em] text-text-muted mb-2">
          Public link
        </p>
        {spaceUrl ? (
          <div className="flex items-center gap-1.5 mb-2.5">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-bg-subtle border border-border rounded-sm px-2 py-1.5 text-[12px] text-text-sub outline-none"
            />
            <Button size="sm" variant="outline" onClick={copy} title="Copy link">
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Open in Space"
              className="inline-flex items-center justify-center w-8 h-8 rounded-sm border border-border text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <p className="text-[12px] text-text-muted mb-2.5">
            Set <code>NEXT_PUBLIC_SPACE_URL</code> to show the shareable link.
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onUnpublish()
            setOpen(false)
          }}
          disabled={pending}
          className="w-full justify-center text-red"
        >
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CloudOff className="w-3.5 h-3.5" />
          )}
          Unpublish
        </Button>
      </div>
    </div>
  )
}
