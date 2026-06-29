"use client"
import { useState } from "react"
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

const FILL_PALETTE = [
  "",
  "#ffffff",
  "#f1f3f4",
  "#fbe9e9",
  "#fef7e0",
  "#e6f4ea",
  "#e8f0fe",
  "#f3e8fd",
  "#ffe0ec",
  "#fce8b2",
  "#b7e1cd",
  "#a4c2f4",
  "#d9d2e9",
  "#f4cccc",
  "#cccccc",
  "#666666",
]
const TEXT_PALETTE = [
  "",
  "#000000",
  "#5f6368",
  "#d93025",
  "#e8710a",
  "#188038",
  "#1967d2",
  "#7627bb",
  "#c5221f",
  "#0b8043",
]

interface Props {
  activeStyle: CellStyle | undefined
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onToggle: (key: "b" | "i" | "u" | "s" | "wrap") => void
  onFontSize: (delta: number) => void
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
  const fontLabel =
    FONT_OPTIONS.find((f) => f.value === (activeStyle?.ff ?? ""))?.label ??
    "Custom"
  const s = activeStyle ?? {}
  const fs = s.fs ?? 10

  return (
    <div className="relative flex items-center gap-0.5 mx-3 my-2 px-2 py-1 bg-[#edf2fa] rounded-full text-text-sub overflow-visible">
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

      <button
        type="button"
        className="h-7 px-2 inline-flex items-center gap-1 text-[13px] rounded hover:bg-black/10 min-w-[110px]"
        onClick={() => {
          setFontOpen((v) => !v)
          setFillOpen(false)
          setTextOpen(false)
        }}
        style={{ fontFamily: activeStyle?.ff || undefined }}
      >
        <span className="truncate">{fontLabel}</span>
        <ChevronDown className="w-3 h-3 ml-auto" />
      </button>

      <TbSep />

      <TbBtn title="Decrease font size" onClick={() => onFontSize(-1)}>
        <Minus className="w-[14px] h-[14px]" />
      </TbBtn>
      <div className="h-7 min-w-[28px] px-1 inline-flex items-center justify-center text-[12px] border border-transparent rounded">
        {fs}
      </div>
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
      <TbBtn
        title="Text color"
        onClick={() => {
          setTextOpen((v) => !v)
          setFillOpen(false)
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

      <TbSep />

      <TbBtn
        title="Fill color"
        onClick={() => {
          setFillOpen((v) => !v)
          setTextOpen(false)
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

      <div className="flex-1" />

      <TbBtn title="Hide the menus">
        <ChevronDown className="w-4 h-4" />
      </TbBtn>

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
      {textOpen && (
        <ColorPalette
          title="Text color"
          palette={TEXT_PALETTE}
          position="left-[660px]"
          onPick={(c) => {
            onColor("fg", c)
            setTextOpen(false)
          }}
          onClose={() => setTextOpen(false)}
        />
      )}
      {fillOpen && (
        <ColorPalette
          title="Fill color"
          palette={FILL_PALETTE}
          position="left-[700px]"
          onPick={(c) => {
            onColor("bg", c)
            setFillOpen(false)
          }}
          onClose={() => setFillOpen(false)}
        />
      )}
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
        active && "bg-[#cfe8ff] hover:bg-[#cfe8ff]",
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
      <div className="absolute top-full mt-1 right-0 bg-white border border-border rounded-md shadow-lg py-1 z-30 min-w-[180px]">
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
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div className="absolute top-full mt-2 left-[300px] bg-white border border-border rounded-md shadow-lg py-1.5 z-30 min-w-[200px]">
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
            className="w-full text-[12px] px-2 py-1 border border-border rounded outline-none focus:border-accent"
          />
        </div>
      </div>
    </>
  )
}

function ColorPalette({
  palette,
  position,
  onPick,
  onClose,
  title,
}: {
  palette: readonly string[]
  position: string
  onPick: (color: string | null) => void
  onClose: () => void
  title: string
}) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div
        className={cn(
          "absolute top-full mt-2 bg-white border border-border rounded-md shadow-lg p-3 z-30",
          position,
        )}
      >
        <div className="text-[11px] text-text-muted mb-2 select-none">
          {title}
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {palette.map((c, i) =>
            c === "" ? (
              <button
                key={i}
                onClick={() => onPick(null)}
                className="w-5 h-5 rounded border border-border bg-white relative flex items-center justify-center"
                title="No color"
              >
                <span className="block w-full h-px bg-red rotate-45" />
              </button>
            ) : (
              <button
                key={i}
                onClick={() => onPick(c)}
                style={{ background: c }}
                className="w-5 h-5 rounded border border-border"
                title={c}
              />
            ),
          )}
        </div>
      </div>
    </>
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
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div className="absolute top-full mt-2 left-[640px] z-30 bg-white border border-border rounded-md shadow-lg p-2 w-[240px]">
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
            className="text-[12px] py-0.5 px-1 border border-border rounded bg-white"
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
        </div>
      </div>
    </>
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
