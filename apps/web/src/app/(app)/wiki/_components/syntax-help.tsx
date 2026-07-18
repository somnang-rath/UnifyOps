"use client"
import { useState } from "react"
import { HelpCircle } from "lucide-react"
import { Modal } from "@/components/ui/modal"

/**
 * In-app "how to use the editor" reference for the wiki. The editor is WYSIWYG,
 * but pages are stored as Markdown — this shows what each toolbar action does and
 * the Markdown it saves, so power users can also type syntax directly.
 */

type Row = { label: string; syntax: string }
type Section = { title: string; rows: Row[] }

const SECTIONS: Section[] = [
  {
    title: "Text",
    rows: [
      { label: "Bold", syntax: "**bold**" },
      { label: "Italic", syntax: "*italic*" },
      { label: "Strikethrough", syntax: "~~struck~~" },
      { label: "Inline code", syntax: "`code`" },
      { label: "Link", syntax: "[label](https://…)" },
    ],
  },
  {
    title: "Title / headings",
    rows: [
      { label: "Heading 1", syntax: "# Heading 1" },
      { label: "Heading 2", syntax: "## Heading 2" },
      { label: "Heading 3", syntax: "### Heading 3" },
      { label: "Heading 4", syntax: "#### Heading 4" },
    ],
  },
  {
    title: "Lists",
    rows: [
      { label: "Bullet list", syntax: "- item" },
      { label: "Numbered list", syntax: "1. item" },
      { label: "Task list", syntax: "- [ ] to do\n- [x] done" },
    ],
  },
  {
    title: "Blocks",
    rows: [
      { label: "Quote", syntax: "> quoted text" },
      { label: "Code block", syntax: "```\ncode block\n```" },
      { label: "Divider", syntax: "---" },
      { label: "Image", syntax: "![alt](https://…)" },
      {
        label: "Table",
        syntax: "| Col A | Col B |\n| ----- | ----- |\n| a1    | b1    |",
      },
    ],
  },
  {
    title: "Callout boxes  ·  pin",
    rows: [
      { label: "ℹ️ Note", syntax: "> [!NOTE] Useful context." },
      { label: "💡 Tip", syntax: "> [!TIP] A helpful hint." },
      { label: "📌 Important (pin)", syntax: "> [!IMPORTANT] Must-read note." },
      { label: "⚠️ Warning", syntax: "> [!WARNING] Proceed with care." },
      { label: "🛑 Caution", syntax: "> [!CAUTION] Risky — read first." },
    ],
  },
]

export function SyntaxHelpButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="Formatting & syntax guide"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-sm text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5" />
        Syntax
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Formatting guide" size="lg">
        <p className="text-[13px] text-text-muted -mt-1">
          Use the toolbar to format text, or type the Markdown directly. Pages are
          stored as Markdown, so everything below round-trips cleanly.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SECTIONS.map((s) => (
            <section
              key={s.title}
              className="border border-border rounded-lg overflow-hidden"
            >
              <div className="px-3.5 py-2 bg-bg-subtle border-b border-border text-[11px] font-bold uppercase tracking-[.06em] text-text-muted">
                {s.title}
              </div>
              <div className="divide-y divide-border">
                {s.rows.map((r) => (
                  <div
                    key={r.label}
                    className="flex items-start gap-3 px-3.5 py-2"
                  >
                    <span className="w-[130px] flex-shrink-0 text-[12.5px] text-text-sub pt-0.5">
                      {r.label}
                    </span>
                    <pre className="flex-1 min-w-0 m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.5] text-accent">
                      {r.syntax}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="text-[12px] text-text-muted">
          Full reference:{" "}
          <code className="px-1 py-0.5 rounded bg-bg-subtle font-mono text-[11.5px]">
            docs/wiki-syntax.md
          </code>
        </p>
      </Modal>
    </>
  )
}
