"use client"
import { ArrowLeft, Eye, Lock, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { MenuBar, type MenuDef } from "./menu-bar"

interface Props {
  name: string
  onNameChange: (v: string) => void
  menus: MenuDef[]
  canShare?: boolean
  readOnly?: boolean
  onShare?: () => void
  onBack?: () => void
  saveStatus?: 'saving' | 'saved' | null
}

export function TitleBar({
  name,
  onNameChange,
  menus,
  canShare,
  readOnly,
  onShare,
  onBack,
  saveStatus,
}: Props) {
  return (
    <div className="flex items-start gap-2 px-3 pt-2 pb-1 bg-white">
      {onBack && (
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-sm flex items-center justify-center mt-0.5 hover:bg-bg-hover text-text-muted hover:text-text"
          title="Back to spreadsheets"
          aria-label="Back to spreadsheets"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      <button
        className="w-9 h-9 rounded-sm flex items-center justify-center mt-0.5 hover:bg-bg-hover"
        title="Spreadsheet"
        aria-label="Spreadsheet home"
      >
        <SheetIcon />
      </button>

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <input
            value={name}
            data-wb-name
            onChange={(e) => onNameChange(e.target.value)}
            readOnly={readOnly}
            className={cn(
              "text-[18px] leading-tight font-medium bg-transparent border border-transparent rounded px-1.5 py-0.5 outline-none min-w-[40px] max-w-[460px]",
              !readOnly &&
                "hover:border-border focus:border-accent focus:bg-bg-input",
              readOnly && "cursor-default",
            )}
            spellCheck={false}
          />
          <button
            className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-amber"
            title="Star"
          >
            <Star className="w-4 h-4" />
          </button>
          {readOnly && (
            <span
              title="You have view-only access"
              className="inline-flex items-center gap-1 px-2 py-0.5 ml-1 text-[10.5px] font-bold uppercase tracking-wider text-text-muted bg-bg-subtle border border-border rounded-sm"
            >
              <Eye className="w-3 h-3" />
              View only
            </span>
          )}
        </div>

        <MenuBar menus={menus} />
      </div>

      <div className="flex items-center gap-2 mt-1">
        {saveStatus === 'saving' && (
          <span className="text-[11px] text-text-muted animate-pulse select-none">
            Saving…
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="text-[11px] text-text-muted select-none">
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={() => canShare && onShare?.()}
          disabled={!canShare}
          title={canShare ? "Share" : "Only the owner can share"}
          className={cn(
            "h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium",
            "bg-[#c2e7ff] text-[#001d35] hover:shadow-sm",
            "disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:shadow-none",
          )}
        >
          <Lock className="w-4 h-4" />
          Share
        </button>
      </div>
    </div>
  )
}

function SheetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0f9d58" />
      <rect x="6" y="7" width="12" height="1.6" fill="#fff" />
      <rect x="6" y="11" width="12" height="1.6" fill="#fff" />
      <rect x="6" y="15" width="12" height="1.6" fill="#fff" />
      <rect x="11" y="6" width="1.8" height="12" fill="#0f9d58" />
    </svg>
  )
}
