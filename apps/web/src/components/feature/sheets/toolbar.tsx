"use client"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  Bold,
  ChevronDown,
  DollarSign,
  Filter,
  Image as ImageIcon,
  Italic,
  Link2,
  MessageSquarePlus,
  Minus,
  PaintBucket,
  Percent,
  Plus,
  Printer,
  Redo2,
  Search,
  Sigma,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  WrapText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CellStyle } from "@/schemas/workbook"

const FONT_OPTIONS = [
  { label: "Default (Kantumruy Pro)", value: "" },
  {
    label: "Kantumruy Pro",
    value: 'var(--font-khmer), "Kantumruy Pro", sans-serif',
  },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
  { label: "Times New Roman", value: '"Times New Roman", serif' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: '"Courier New", monospace' },
  { label: "Comic Sans MS", value: '"Comic Sans MS", cursive' },
  { label: "Impact", value: "Impact, sans-serif" },
]

// Full Google-Sheets-style palette: grayscale ramp, saturated base row, then
// four tint rows and three shade rows. 10 columns wide.
const STANDARD_PALETTE: string[][] = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
]

const RECENT_COLORS_KEY = "unifyops.sheets.recentColors"
const RECENT_LIMIT = 10

function loadRecentColors(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(RECENT_COLORS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((c) => typeof c === "string") : []
  } catch {
    return []
  }
}

function isHexColor(v: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
}

interface Props {
  activeStyle: CellStyle | undefined
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onToggle: (key: "b" | "i" | "u" | "s" | "wrap") => void
  onFontSize: (delta: number) => void
  onFontSizeExact?: (px: number) => void
  onFont: (ff: string | null) => void
  onAlignH: () => void
  onAlignV: () => void
  onColor: (which: "fg" | "bg", color: string | null) => void
  onNumberFormat: (nf: "currency" | "percent" | null) => void
  onDecimalPlaces: (delta: number) => void
  onClearFormat: () => void
  onInsertImage: () => void
  onBorder: (border: BorderApply) => void
  paintActive: boolean
  onPaintFormat: () => void
  onMerge: () => void
  onMergeAndCenter: () => void
  onUnmerge: () => void
  canMerge: boolean
  hasMerge: boolean
  onInsertLink: () => void
  hasLink: boolean
  onInsertComment: () => void
  onInsertChart: () => void
  onPrint: () => void
}

export interface BorderApply {
  side: "top" | "right" | "bottom" | "left" | "all" | "outer" | "inner" | "none"
  style: "thin" | "medium" | "thick" | "dashed" | "dotted"
  color: string
}

export function Toolbar({
  activeStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onToggle,
  onFontSize,
  onFontSizeExact,
  onFont,
  onAlignH,
  onAlignV,
  onColor,
  onNumberFormat,
  onDecimalPlaces,
  onClearFormat,
  onInsertImage,
  onBorder,
  paintActive,
  onPaintFormat,
  onMerge,
  onMergeAndCenter,
  onUnmerge,
  canMerge,
  hasMerge,
  onInsertLink,
  hasLink,
  onInsertComment,
  onInsertChart,
  onPrint,
}: Props) {
  const [fillOpen, setFillOpen] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const [fontOpen, setFontOpen] = useState(false)
  const [bordersOpen, setBordersOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentColors)

  const recordColor = (c: string | null) => {
    if (!c) return
    setRecentColors((prev) => {
      const next = [c, ...prev.filter((x) => x !== c)].slice(0, RECENT_LIMIT)
      try {
        window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next))
      } catch {
        /* storage best-effort */
      }
      return next
    })
  }

  const fontLabel =
    FONT_OPTIONS.find((f) => f.value === (activeStyle?.ff ?? ""))?.label ??
    "Custom"
  const s = activeStyle ?? {}
  const fs = s.fs ?? 10

  return (
    <div className="relative flex flex-wrap items-center gap-y-1 gap-x-0.5 mx-3 my-2 px-2 py-1 bg-[var(--sh-header-bg)] rounded-2xl text-text-sub overflow-visible">
      <TbBtn title="Menus" disabled>
        <Search className="w-[16px] h-[16px]" />
      </TbBtn>

      <TbSep />

      <TbBtn title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <Undo2 className="w-[16px] h-[16px]" />
      </TbBtn>
      <TbBtn title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
        <Redo2 className="w-[16px] h-[16px]" />
      </TbBtn>
      <TbBtn title="Print (Ctrl+P)" onClick={onPrint}>
        <Printer className="w-[16px] h-[16px]" />
      </TbBtn>
      <TbBtn
        title={
          paintActive ? "Paint format (active — click a cell)" : "Paint format"
        }
        active={paintActive}
        onClick={onPaintFormat}
      >
        <PaintBucket className="w-[16px] h-[16px]" />
      </TbBtn>

      <TbSep />

      <button
        type="button"
        className="h-7 px-2 inline-flex items-center gap-1 text-[13px] rounded hover:bg-black/10 cursor-not-allowed opacity-60"
        disabled
      >
        100%
        <ChevronDown className="w-3 h-3" />
      </button>

      <TbSep />

      <TbBtn
        title="Format as currency"
        active={s.nf === "currency"}
        onClick={() => onNumberFormat(s.nf === "currency" ? null : "currency")}
      >
        <DollarSign className="w-[16px] h-[16px]" />
      </TbBtn>
      <TbBtn
        title="Format as percent"
        active={s.nf === "percent"}
        onClick={() => onNumberFormat(s.nf === "percent" ? null : "percent")}
      >
        <Percent className="w-[16px] h-[16px]" />
      </TbBtn>
      <TbBtn
        title="Decrease decimal places"
        onClick={() => onDecimalPlaces(-1)}
      >
        <DecDec />
      </TbBtn>
      <TbBtn title="Increase decimal places" onClick={() => onDecimalPlaces(1)}>
        <DecInc />
      </TbBtn>
      <button
        type="button"
        className="h-7 px-2 inline-flex items-center gap-1 text-[13px] rounded hover:bg-black/10 cursor-not-allowed opacity-60"
        disabled
      >
        123
        <ChevronDown className="w-3 h-3" />
      </button>

      <TbSep />

      <div className="relative inline-flex items-center">
        <button
          type="button"
          className="h-7 px-2 inline-flex items-center gap-1 text-[13px] rounded hover:bg-black/10 min-w-[110px] max-w-[150px]"
          onClick={() => {
            setFontOpen((v) => !v)
            setFillOpen(false)
            setTextOpen(false)
          }}
          style={{ fontFamily: activeStyle?.ff || undefined }}
        >
          <span className="truncate">{fontLabel}</span>
          <ChevronDown className="w-3 h-3 ml-auto shrink-0" />
        </button>
        {fontOpen && (
          <FontPicker
            current={activeStyle?.ff ?? ""}
            onPick={(ff) => {
              onFont(ff)
              setFontOpen(false)
            }}
            onClose={() => setFontOpen(false)}
          />
        )}
      </div>

      <TbSep />

      <TbBtn title="Decrease font size" onClick={() => onFontSize(-1)}>
        <Minus className="w-[14px] h-[14px]" />
      </TbBtn>
      <FontSizeControl
        fs={fs}
        onDelta={onFontSize}
        onExact={onFontSizeExact}
      />
      <TbBtn title="Increase font size" onClick={() => onFontSize(1)}>
        <Plus className="w-[14px] h-[14px]" />
      </TbBtn>

      <TbSep />

      <TbBtn title="Bold (Ctrl+B)" active={!!s.b} onClick={() => onToggle("b")}>
        <Bold className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn
        title="Italic (Ctrl+I)"
        active={!!s.i}
        onClick={() => onToggle("i")}
      >
        <Italic className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Strikethrough" active={!!s.s} onClick={() => onToggle("s")}>
        <Strikethrough className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Underline (Ctrl+U)" active={!!s.u} onClick={() => onToggle("u")}>
        <Underline className="w-[15px] h-[15px]" />
      </TbBtn>
      <div className="relative inline-flex items-center">
        <TbBtn
          title="Text color"
          onClick={() => {
            setTextOpen((v) => !v)
            setFillOpen(false)
            setBordersOpen(false)
          }}
        >
          <div className="flex flex-col items-center justify-center">
            <Type className="w-[13px] h-[13px]" />
            <span
              className="w-3 h-[3px] mt-px rounded-sm"
              style={{ background: s.fg || "#d93025" }}
            />
          </div>
        </TbBtn>
        {textOpen && (
          <ColorPalette
            title="Text color"
            current={s.fg ?? ""}
            recent={recentColors}
            onPick={(c) => {
              recordColor(c)
              onColor("fg", c)
              setTextOpen(false)
            }}
            onClose={() => setTextOpen(false)}
          />
        )}
      </div>

      <TbSep />

      <div className="relative inline-flex items-center">
        <TbBtn
          title="Fill color"
          onClick={() => {
            setFillOpen((v) => !v)
            setTextOpen(false)
            setBordersOpen(false)
          }}
        >
          <div className="flex flex-col items-center justify-center">
            <PaintBucket className="w-[13px] h-[13px]" />
            <span
              className="w-3 h-[3px] mt-px rounded-sm"
              style={{ background: s.bg || "#f1c232" }}
            />
          </div>
        </TbBtn>
        {fillOpen && (
          <ColorPalette
            title="Fill color"
            current={s.bg ?? ""}
            recent={recentColors}
            onPick={(c) => {
              recordColor(c)
              onColor("bg", c)
              setFillOpen(false)
            }}
            onClose={() => setFillOpen(false)}
          />
        )}
      </div>
      <div className="relative inline-flex items-center">
        <TbBtn
          title="Borders"
          onClick={() => {
            setBordersOpen((v) => !v)
            setFillOpen(false)
            setTextOpen(false)
          }}
        >
          <BordersIcon />
        </TbBtn>
        {bordersOpen && (
          <BordersPicker
            onApply={(b) => {
              onBorder(b)
              setBordersOpen(false)
            }}
            onClose={() => setBordersOpen(false)}
          />
        )}
      </div>
      <div className="relative inline-flex items-center">
        <TbBtn
          title={hasMerge ? "Unmerge cells" : "Merge cells"}
          active={hasMerge}
          disabled={!canMerge && !hasMerge}
          onClick={onMerge}
        >
          <MergeIcon />
        </TbBtn>
        <button
          type="button"
          title="Merge options"
          disabled={!canMerge && !hasMerge}
          onClick={() => setMergeOpen((v) => !v)}
          className={cn(
            "h-7 w-3.5 inline-flex items-center justify-center rounded hover:bg-black/10",
            !canMerge &&
              !hasMerge &&
              "opacity-60 cursor-not-allowed hover:bg-transparent",
          )}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        {mergeOpen && (
          <MergeMenu
            hasMerge={hasMerge}
            canMerge={canMerge}
            onMergeAll={() => {
              if (hasMerge) onUnmerge()
              else onMerge()
              setMergeOpen(false)
            }}
            onMergeAndCenter={() => {
              onMergeAndCenter()
              setMergeOpen(false)
            }}
            onUnmerge={() => {
              onUnmerge()
              setMergeOpen(false)
            }}
            onClose={() => setMergeOpen(false)}
          />
        )}
      </div>

      <TbSep />

      <TbBtn title={`Horizontal align (${s.ha ?? "auto"})`} onClick={onAlignH}>
        {s.ha === "center" ? (
          <AlignCenter className="w-[15px] h-[15px]" />
        ) : s.ha === "right" ? (
          <AlignRight className="w-[15px] h-[15px]" />
        ) : (
          <AlignLeft className="w-[15px] h-[15px]" />
        )}
      </TbBtn>
      <TbBtn title={`Vertical align (${s.va ?? "middle"})`} onClick={onAlignV}>
        <VAlignIcon va={s.va ?? "middle"} />
      </TbBtn>
      <TbBtn
        title="Wrap text"
        active={!!s.wrap}
        onClick={() => onToggle("wrap")}
      >
        <WrapText className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Clear formatting" onClick={onClearFormat}>
        <Eraser />
      </TbBtn>

      <TbSep />

      <TbBtn
        title={hasLink ? "Edit link" : "Insert link"}
        active={hasLink}
        onClick={onInsertLink}
      >
        <Link2 className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Insert image in cell" onClick={onInsertImage}>
        <ImageIcon className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Insert comment" onClick={onInsertComment}>
        <MessageSquarePlus className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Insert chart" onClick={onInsertChart}>
        <BarChart3 className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Create a filter" disabled>
        <Filter className="w-[15px] h-[15px]" />
      </TbBtn>
      <TbBtn title="Functions" disabled>
        <Sigma className="w-[15px] h-[15px]" />
      </TbBtn>
    </div>
  )
}

function TbBtn({
  children,
  title,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  title?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-7 h-7 inline-flex items-center justify-center rounded hover:bg-black/10",
        active && "bg-[var(--sh-header-bg-sel)] hover:bg-[var(--sh-header-bg-sel)]",
        disabled && "opacity-60 cursor-not-allowed hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

function TbSep() {
  return <span className="inline-block w-px h-4 bg-black/10 mx-1.5" />
}

function MergeMenu({
  hasMerge,
  canMerge,
  onMergeAll,
  onMergeAndCenter,
  onUnmerge,
  onClose,
}: {
  hasMerge: boolean
  canMerge: boolean
  onMergeAll: () => void
  onMergeAndCenter: () => void
  onUnmerge: () => void
  onClose: () => void
}) {
  const items: { label: string; onClick: () => void; disabled?: boolean }[] = [
    { label: "Merge all", onClick: onMergeAll, disabled: !canMerge },
    {
      label: "Merge & center",
      onClick: onMergeAndCenter,
      disabled: !canMerge,
    },
    { label: "Unmerge", onClick: onUnmerge, disabled: !hasMerge },
  ]
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div className="absolute top-full mt-1 right-0 bg-bg-card border border-border rounded-md shadow-lg py-1 z-30 min-w-[180px]">
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            disabled={it.disabled}
            onClick={it.onClick}
            className={cn(
              "w-full text-left px-3 py-1.5 text-[13px] hover:bg-bg-hover",
              it.disabled &&
                "opacity-50 cursor-not-allowed hover:bg-transparent",
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  )
}

/**
 * Popover panel anchored to its (relatively-positioned) trigger wrapper.
 * After mount it clamps itself horizontally so it never spills past the
 * viewport edge — this is what keeps the pickers usable when the sheet is
 * squeezed into a narrow split panel.
 */
function Popover({
  onClose,
  children,
  className,
  width,
}: {
  onClose: () => void
  children: React.ReactNode
  className?: string
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const margin = 8
    el.style.left = "0px"
    el.style.right = "auto"
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - margin) {
      const overflow = rect.right - (window.innerWidth - margin)
      el.style.left = `${-overflow}px`
    }
    const rect2 = el.getBoundingClientRect()
    if (rect2.left < margin) {
      el.style.left = `${el.offsetLeft + (margin - rect2.left)}px`
    }
  }, [])

  // Escape closes — the click-catching overlay alone would otherwise trap the
  // user until they click away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className={cn(
          "absolute top-full mt-2 z-30 bg-bg-card border border-border rounded-md shadow-lg",
          className,
        )}
        style={width ? { width } : undefined}
      >
        {children}
      </div>
    </>
  )
}

function FontSizeControl({
  fs,
  onDelta,
  onExact,
}: {
  fs: number
  onDelta: (delta: number) => void
  onExact?: (px: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editable = !!onExact
  const commit = () => {
    if (draft == null) return
    const n = Number(draft)
    if (Number.isFinite(n) && n > 0) onExact?.(n)
    setDraft(null)
  }
  if (!editable) {
    return (
      <div className="h-7 min-w-[28px] px-1 inline-flex items-center justify-center text-[12px] border border-transparent rounded">
        {fs}
      </div>
    )
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      title="Font size (type a value)"
      value={draft ?? String(fs)}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
      onFocus={(e) => {
        setDraft(String(fs))
        e.currentTarget.select()
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
          e.currentTarget.blur()
        } else if (e.key === "Escape") {
          setDraft(null)
          e.currentTarget.blur()
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          onDelta(1)
        } else if (e.key === "ArrowDown") {
          e.preventDefault()
          onDelta(-1)
        }
      }}
      className="h-7 w-9 px-1 text-center text-[12px] border border-border/60 rounded bg-transparent outline-none focus:border-accent"
    />
  )
}

function FontPicker({
  current,
  onPick,
  onClose,
}: {
  current: string
  onPick: (ff: string | null) => void
  onClose: () => void
}) {
  const [custom, setCustom] = useState("")
  return (
    <Popover onClose={onClose} className="py-1.5 min-w-[200px]">
        {FONT_OPTIONS.map((f) => (
          <button
            key={f.value}
            onClick={() => onPick(f.value || null)}
            className={cn(
              "w-full text-left px-3 py-1.5 text-[13px] hover:bg-bg-hover flex items-center justify-between",
              current === f.value && "bg-bg-subtle",
            )}
            style={{ fontFamily: f.value || undefined }}
          >
            <span>{f.label}</span>
            {current === f.value && <span className="text-accent">✓</span>}
          </button>
        ))}
        <div className="h-px bg-border my-1 mx-2" aria-hidden />
        <div className="px-3 py-1.5">
          <label className="text-[11px] text-text-muted block mb-1">
            Custom font family
          </label>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                if (custom.trim()) onPick(custom.trim())
              }
            }}
            placeholder="e.g. Roboto, Inter"
            className="w-full text-[12px] px-2 py-1 border border-border rounded bg-bg-input text-text outline-none focus:border-accent"
          />
        </div>
    </Popover>
  )
}

function Swatch({
  color,
  active,
  onPick,
}: {
  color: string
  active: boolean
  onPick: (c: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(color)}
      style={{ background: color }}
      className={cn(
        "w-[18px] h-[18px] rounded-sm border border-black/15 hover:scale-110 transition-transform",
        active && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--bg-card,transparent)]",
      )}
      title={color}
      aria-label={color}
    />
  )
}

function ColorPalette({
  current,
  recent,
  onPick,
  onClose,
  title,
}: {
  current: string
  recent: string[]
  onPick: (color: string | null) => void
  onClose: () => void
  title: string
}) {
  const [hex, setHex] = useState(isHexColor(current) ? current : "#000000")
  const currentLc = current.toLowerCase()

  return (
    <Popover onClose={onClose} className="p-3" width={232}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-text-muted select-none">{title}</span>
        <button
          type="button"
          onClick={() => onPick(null)}
          className="text-[11px] text-text-muted hover:text-text inline-flex items-center gap-1"
          title="Reset to default"
        >
          <span className="w-3.5 h-3.5 rounded-sm border border-border bg-[var(--sh-cell-bg)] relative inline-flex items-center justify-center">
            <span className="block w-full h-px bg-red rotate-45" />
          </span>
          None
        </button>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {STANDARD_PALETTE.flat().map((c) => (
          <Swatch
            key={c}
            color={c}
            active={c.toLowerCase() === currentLc}
            onPick={onPick}
          />
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <div className="text-[11px] text-text-muted mt-3 mb-1.5 select-none">
            Recent
          </div>
          <div className="grid grid-cols-10 gap-1">
            {recent.map((c) => (
              <Swatch
                key={c}
                color={c}
                active={c.toLowerCase() === currentLc}
                onPick={onPick}
              />
            ))}
          </div>
        </>
      )}

      <div className="text-[11px] text-text-muted mt-3 mb-1.5 select-none">
        Custom
      </div>
      <div className="flex items-center gap-1.5">
        <label
          className="w-7 h-7 rounded border border-border overflow-hidden shrink-0 cursor-pointer relative"
          style={{ background: isHexColor(hex) ? hex : "#000000" }}
          title="Pick a custom color"
        >
          <input
            type="color"
            value={isHexColor(hex) ? hex : "#000000"}
            onChange={(e) => setHex(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <input
          type="text"
          value={hex}
          onChange={(e) => {
            const v = e.target.value
            setHex(v.startsWith("#") || v === "" ? v : `#${v}`)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isHexColor(hex)) onPick(hex)
          }}
          placeholder="#RRGGBB"
          className="flex-1 min-w-0 text-[12px] px-2 py-1 border border-border rounded bg-bg-input text-text outline-none focus:border-accent font-mono"
        />
        <button
          type="button"
          disabled={!isHexColor(hex)}
          onClick={() => onPick(hex)}
          className={cn(
            "text-[12px] px-2.5 py-1 rounded bg-accent text-white",
            !isHexColor(hex) && "opacity-50 cursor-not-allowed",
          )}
        >
          OK
        </button>
      </div>
    </Popover>
  )
}

function DecDec() {
  return (
    <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" fill="currentColor">
      <text x="2" y="16" fontSize="9" fontWeight="700">
        .0
      </text>
      <path
        d="M14 13l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
function DecInc() {
  return (
    <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" fill="currentColor">
      <text x="2" y="16" fontSize="9" fontWeight="700">
        .0
      </text>
      <path
        d="M14 10l3-3 3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
const BORDER_COLORS = [
  "#000000",
  "#5f6368",
  "#9aa0a6",
  "#d93025",
  "#e8710a",
  "#fbbc04",
  "#188038",
  "#1967d2",
  "#7627bb",
]

function BordersPicker({
  onApply,
  onClose,
}: {
  onApply: (b: BorderApply) => void
  onClose: () => void
}) {
  const [color, setColor] = useState(BORDER_COLORS[0])
  const [style, setStyle] = useState<BorderApply["style"]>("thin")

  const sides: Array<{
    side: BorderApply["side"]
    label: string
    icon: React.ReactNode
  }> = [
    { side: "all", label: "All", icon: <BorderAll /> },
    { side: "outer", label: "Outer", icon: <BorderOuter /> },
    { side: "inner", label: "Inner", icon: <BorderInner /> },
    { side: "top", label: "Top", icon: <BorderTop /> },
    { side: "right", label: "Right", icon: <BorderRight /> },
    { side: "bottom", label: "Bottom", icon: <BorderBottom /> },
    { side: "left", label: "Left", icon: <BorderLeft /> },
    { side: "none", label: "None", icon: <BorderNone /> },
  ]

  return (
    <Popover onClose={onClose} className="p-2" width={240}>
        <div className="grid grid-cols-4 gap-1 mb-2">
          {sides.map((s) => (
            <button
              key={s.side}
              title={s.label}
              onClick={() => onApply({ side: s.side, style, color })}
              className="w-12 h-9 inline-flex items-center justify-center rounded hover:bg-bg-hover text-text-sub"
            >
              {s.icon}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-1 pt-1.5 border-t border-border">
          <div className="text-[11px] text-text-muted">Style</div>
          <select
            data-no-csel
            value={style}
            onChange={(e) => setStyle(e.target.value as BorderApply["style"])}
            className="text-[12px] py-0.5 px-1 border border-border rounded bg-bg-input"
          >
            <option value="thin">Thin</option>
            <option value="medium">Medium</option>
            <option value="thick">Thick</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5 px-1 pt-2">
          <div className="text-[11px] text-text-muted mr-1">Color</div>
          {BORDER_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                "w-4 h-4 rounded-full border",
                color === c
                  ? "border-text ring-2 ring-offset-1 ring-accent"
                  : "border-border",
              )}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
          <label
            className={cn(
              "w-4 h-4 rounded-full border relative cursor-pointer overflow-hidden",
              BORDER_COLORS.includes(color)
                ? "border-border"
                : "border-text ring-2 ring-offset-1 ring-accent",
            )}
            title="Custom border color"
            style={{
              background: BORDER_COLORS.includes(color)
                ? "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)"
                : color,
            }}
          >
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
    </Popover>
  )
}

function BorderAll() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="3" width="18" height="18" />
      <path d="M3 12h18M12 3v18" />
    </svg>
  )
}
function BorderOuter() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="18" height="18" />
    </svg>
  )
}
function BorderInner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeDasharray="2 2"
    >
      <path d="M3 12h18M12 3v18" />
    </svg>
  )
}
function BorderTop() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 5h18" />
      <path strokeDasharray="2 2" d="M3 12h18M3 19h18" />
    </svg>
  )
}
function BorderRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M19 3v18" />
      <path strokeDasharray="2 2" d="M12 3v18M5 3v18" />
    </svg>
  )
}
function BorderBottom() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 19h18" />
      <path strokeDasharray="2 2" d="M3 5h18M3 12h18" />
    </svg>
  )
}
function BorderLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 3v18" />
      <path strokeDasharray="2 2" d="M12 3v18M19 3v18" />
    </svg>
  )
}
function BorderNone() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
    >
      <rect x="3" y="3" width="18" height="18" />
      <path d="M3 12h18M12 3v18" />
    </svg>
  )
}

function BordersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[15px] h-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="3" width="18" height="18" />
      <path d="M12 3v18M3 12h18" />
    </svg>
  )
}
function MergeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[15px] h-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M8 12h8" />
      <path d="M11 9l-3 3 3 3" />
      <path d="M13 9l3 3-3 3" />
    </svg>
  )
}
function VAlignIcon({ va }: { va: "top" | "middle" | "bottom" }) {
  const y = va === "top" ? 4 : va === "middle" ? 12 : 21
  const rectY = va === "top" ? 6 : va === "middle" ? 6 : 4
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[15px] h-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <line x1="4" y1={y} x2="20" y2={y} />
      <rect x="9" y={rectY} width="6" height="13" />
    </svg>
  )
}
function Eraser() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[15px] h-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 3l5 5-9 9H7l-4-4z" />
      <path d="M21 21H9" />
    </svg>
  )
}
