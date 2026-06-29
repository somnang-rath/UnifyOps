"use client"
import { useEffect, useRef, useState } from "react"
import { AxiosError } from "axios"
import {
  Eye,
  FileText,
  ListTree,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { Select } from "@/components/ui/select"
import { useDebounce } from "@/hooks/use-debounce"
import { useProjects } from "@/hooks/use-projects"
import { useWikiList, useWikiMutations, useWikiPage } from "@/hooks/use-wiki"
import { useAuthStore } from "@/stores/auth-store"
import { toast } from "@/stores/toast-store"
import { cn } from "@/lib/utils"

type Mode = "edit" | "preview"
type Draft = { active: boolean; title: string; content: string }

const emptyDraft = (): Draft => ({
  active: false,
  title: "",
  content: "",
})

const PLACEHOLDER = `# Start writing

Your page supports **Markdown**.

## Heading

- Bulleted lists
- \`Code\` snippets
- [Links](https://example.com)`

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

  useEffect(() => {
    if (!activePage) return
    setDraft({
      active: true,
      title: activePage.title,
      content: activePage.content,
    })
    setMode("preview")
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

  const newPage = () => {
    if (!projectId) {
      toast("Select a project first", "error")
      return
    }
    setActiveId(null)
    setDraft({ active: true, title: "", content: "" })
    setMode("edit")
  }

  const save = () => {
    if (!projectId) return
    const title = draft.title.trim()
    if (!title) {
      toast("Title required", "error")
      return
    }
    if (activeId) {
      m.update.mutate({
        id: activeId,
        body: { title, content: draft.content },
      })
    } else {
      m.create.mutate(
        { projectId, title, content: draft.content },
        { onSuccess: (p) => setActiveId(p._id) },
      )
    }
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

  const canDelete = !!(
    activeId &&
    activePage &&
    (me?.id === activePage.authorId || me?.role === 'admin')
  )

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
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-wrap">
            <div ref={treeBtnRef} className="relative">
              <button
                type="button"
                title="Browse pages"
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
              <div
                className={cn(
                  "absolute left-0 top-full mt-2 w-[340px] h-[520px] z-30 origin-top-left flex flex-col",
                  "bg-[color:color-mix(in_srgb,var(--bg-card)_94%,transparent)] backdrop-blur-2xl",
                  "border border-border rounded-lg shadow-xl overflow-hidden",
                  treeOpen ? "animate-popover-in" : "hidden",
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
                      newPage()
                      setTreeOpen(false)
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
                          setActiveId(p._id)
                          setTreeOpen(false)
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
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Untitled page"
              disabled={!draft.active}
              className="flex-1 min-w-[200px] text-[20px] font-bold tracking-[-.02em] py-1 bg-transparent border-0 outline-none placeholder:text-text-muted/70 disabled:cursor-not-allowed"
            />
            {draft.active && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex p-1 bg-bg-subtle border border-border rounded-sm">
                  <ModeBtn
                    active={mode === "edit"}
                    onClick={() => setMode("edit")}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </ModeBtn>
                  <ModeBtn
                    active={mode === "preview"}
                    onClick={() => setMode("preview")}
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </ModeBtn>
                </div>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </Button>
                )}
                <Button size="sm" variant="grad" onClick={save}>
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
              </div>
            )}
          </div>

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
                  setDraft({ ...draft, content: e.target.value })
                }
                spellCheck={false}
                placeholder={PLACEHOLDER}
                className="flex-1 border-0 outline-none resize-none bg-bg-card text-[14px] leading-[1.7] px-7 py-6 placeholder:text-text-muted/60"
              />
            ) : (
              <div className="flex-1 overflow-y-auto px-7 py-6">
                <WikiMarkdown body={draft.content} />
              </div>
            )}
          </div>
        </main>
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

function ModeBtn({
  active,
  children,
  onClick,
}: React.PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[12px] text-text-muted transition-all duration-[var(--dur)]",
        "hover:text-text",
        active && "bg-bg-card text-text shadow-sm",
      )}
    >
      {children}
    </button>
  )
}

function WikiMarkdown({ body }: { body: string }) {
  if (!body.trim()) {
    return (
      <p className="text-[13px] text-text-muted italic">
        Nothing to preview yet.
      </p>
    )
  }
  return (
    <div className="text-[14px] leading-[1.7] text-text max-w-[720px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => (
            <a
              {...p}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
            />
          ),
          h1: ({ node: _n, ...p }) => (
            <h1
              {...p}
              className="text-[28px] font-bold mb-4 tracking-[-.02em] pb-2.5 border-b border-border"
            />
          ),
          h2: ({ node: _n, ...p }) => (
            <h2
              {...p}
              className="text-[22px] font-bold mt-7 mb-3 tracking-[-.015em]"
            />
          ),
          h3: ({ node: _n, ...p }) => (
            <h3 {...p} className="text-[18px] font-semibold mt-5 mb-2" />
          ),
          h4: ({ node: _n, ...p }) => (
            <h4 {...p} className="text-[15px] font-semibold mt-4 mb-2" />
          ),
          p: ({ node: _n, ...p }) => <p {...p} className="mb-3.5" />,
          strong: ({ node: _n, ...p }) => (
            <strong {...p} className="font-semibold" />
          ),
          em: ({ node: _n, ...p }) => <em {...p} className="italic" />,
          ul: ({ node: _n, ...p }) => (
            <ul {...p} className="list-disc pl-6 my-2 mb-3.5" />
          ),
          ol: ({ node: _n, ...p }) => (
            <ol {...p} className="list-decimal pl-6 my-2 mb-3.5" />
          ),
          li: ({ node: _n, ...p }) => <li {...p} className="mb-1" />,
          blockquote: ({ node: _n, ...p }) => (
            <blockquote
              {...p}
              className="border-l-[3px] border-accent bg-accent-50 pl-3.5 py-1 my-3.5 text-text-sub italic rounded-r-sm"
            />
          ),
          code: ({ node: _n, className, children, ...p }) => {
            const inline = !/language-/.test(className ?? "")
            if (inline) {
              return (
                <code
                  {...p}
                  className="font-mono text-[12.5px] bg-bg-subtle text-accent-600 px-1.5 py-0.5 rounded"
                >
                  {children}
                </code>
              )
            }
            return (
              <code
                {...p}
                className={cn("block font-mono text-[12.5px]", className)}
              >
                {children}
              </code>
            )
          },
          pre: ({ node: _n, ...p }) => (
            <pre
              {...p}
              className="bg-bg-subtle border border-border rounded p-3.5 my-3.5 overflow-x-auto"
            />
          ),
          hr: ({ node: _n, ...p }) => (
            <hr {...p} className="border-t border-border my-6" />
          ),
          table: ({ node: _n, ...p }) => (
            <div className="overflow-x-auto my-3.5">
              <table {...p} className="w-full border-collapse" />
            </div>
          ),
          th: ({ node: _n, ...p }) => (
            <th
              {...p}
              className="border border-border px-3.5 py-2 bg-bg-subtle text-left font-semibold"
            />
          ),
          td: ({ node: _n, ...p }) => (
            <td {...p} className="border border-border px-3.5 py-2" />
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
