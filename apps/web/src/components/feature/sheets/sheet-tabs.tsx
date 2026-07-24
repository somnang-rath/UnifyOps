'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, List, Menu, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Sheet, Workbook } from '@/schemas/workbook';

interface Props {
  wb: Workbook;
  onSelect: (sheetId: string) => void;
  onAdd: () => void;
  onRename: (sheetId: string, name: string) => void;
  onDelete: (sheetId: string) => void;
  onReorder: (sheetId: string, toIndex: number) => void;
  onSetColor: (sheetId: string, color: string | null) => void;
  onDuplicate: (sheetId: string) => void;
  onHide: (sheetId: string) => void;
  onUnhide: (sheetId: string) => void;
}

const TAB_COLORS: Array<{ label: string; value: string }> = [
  { label: 'Red', value: '#ea4335' },
  { label: 'Orange', value: '#fbbc04' },
  { label: 'Yellow', value: '#fbe06d' },
  { label: 'Green', value: '#34a853' },
  { label: 'Teal', value: '#1ec1bb' },
  { label: 'Blue', value: '#1a73e8' },
  { label: 'Purple', value: '#a142f4' },
  { label: 'Pink', value: '#f06292' },
  { label: 'Grey', value: '#9aa0a6' },
];

export function SheetTabs({
  wb,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  onSetColor,
  onDuplicate,
  onHide,
  onUnhide,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    side: 'before' | 'after';
  } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  // Render in `index` order so drag-reorder reflects immediately.
  const ordered = useMemo(
    () =>
      [...wb.sheets].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
    [wb.sheets],
  );

  const computeDropIndex = () => {
    if (!dragId || !dropTarget) return -1;
    const without = ordered.filter((s) => s.id !== dragId);
    const targetIdx = without.findIndex((s) => s.id === dropTarget.id);
    if (targetIdx < 0) return -1;
    return dropTarget.side === 'before' ? targetIdx : targetIdx + 1;
  };

  const onDrop = () => {
    if (!dragId) return;
    const toIdx = computeDropIndex();
    setDragId(null);
    setDropTarget(null);
    if (toIdx >= 0) onReorder(dragId, toIdx);
  };

  return (
    <div className="flex items-center gap-0 px-2 h-8 border-t border-border bg-[var(--sh-header-bg)]">
      <button
        onClick={onAdd}
        className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-bg-hover text-text-sub"
        title="Add sheet"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-bg-hover text-text-sub"
        title="All sheets"
      >
        <Menu className="w-4 h-4" />
      </button>

      <div className="flex items-end h-full overflow-x-auto">
        {ordered.map((s) => {
          const active = s.id === wb.activeSheetId;
          const isRenaming = renamingId === s.id;
          const isDragging = dragId === s.id;
          const dropOnHere = dropTarget?.id === s.id;
          return (
            <div
              key={s.id}
              draggable={!isRenaming}
              onDragStart={(e) => {
                setDragId(s.id);
                e.dataTransfer.effectAllowed = 'move';
                // Required for FF to start the drag.
                e.dataTransfer.setData('text/plain', s.id);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === s.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const side =
                  e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
                setDropTarget({ id: s.id, side });
              }}
              onDragLeave={(e) => {
                // Only clear when leaving outside this element's bounds.
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (
                  e.clientX < rect.left ||
                  e.clientX > rect.right ||
                  e.clientY < rect.top ||
                  e.clientY > rect.bottom
                ) {
                  setDropTarget((cur) => (cur?.id === s.id ? null : cur));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop();
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: s.id, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                'group relative h-full pl-3.5 pr-1 text-[13px] inline-flex items-center select-none border-l border-r',
                active
                  ? 'bg-bg-card border-border font-medium text-text -mb-px border-b border-b-[var(--bg-card)]'
                  : 'border-transparent text-text-sub hover:bg-bg-hover',
                isDragging && 'opacity-50',
                s.hidden && 'italic opacity-50',
              )}
              style={{
                borderTopLeftRadius: active ? 6 : 0,
                borderTopRightRadius: active ? 6 : 0,
              }}
            >
              {/* Tab color stripe */}
              {s.color && (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 bottom-0 h-[3px]"
                  style={{ backgroundColor: s.color }}
                />
              )}

              {/* Drop indicator */}
              {dropOnHere && (
                <span
                  aria-hidden
                  className="absolute top-1 bottom-1 w-[2px] bg-[var(--sh-accent)]"
                  style={{
                    left: dropTarget?.side === 'before' ? -1 : 'auto',
                    right: dropTarget?.side === 'after' ? -1 : 'auto',
                  }}
                />
              )}

              {isRenaming ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    const v = draft.trim();
                    if (v && v !== s.name) {
                      const isDuplicate = ordered.some(
                        (other) => other.id !== s.id && other.name === v,
                      );
                      if (isDuplicate) {
                        setDraft(s.name);
                      } else {
                        onRename(s.id, v);
                      }
                    }
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  className="bg-bg-input border border-accent rounded px-1 text-[13px] outline-none max-w-[140px]"
                />
              ) : (
                <button
                  onClick={() => onSelect(s.id)}
                  onDoubleClick={() => {
                    setRenamingId(s.id);
                    setDraft(s.name);
                  }}
                  className="pr-2"
                >
                  {s.name}
                </button>
              )}
              {active && wb.sheets.length > 1 && !isRenaming && (
                <button
                  onClick={() => onDelete(s.id)}
                  title="Delete sheet"
                  className="w-5 h-5 ml-1 mr-1 inline-flex items-center justify-center rounded text-text-muted opacity-0 group-hover:opacity-100 hover:bg-black/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1" />

      <button
        className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-bg-hover text-text-sub"
        title="Tab list"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-bg-hover text-text-sub"
        title="Open sheets list"
      >
        <List className="w-4 h-4" />
      </button>

      {menu && (
        <TabContextMenu
          sheet={wb.sheets.find((s) => s.id === menu.id)!}
          canDelete={wb.sheets.length > 1}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            const s = wb.sheets.find((x) => x.id === menu.id);
            if (!s) return;
            setRenamingId(s.id);
            setDraft(s.name);
            setMenu(null);
          }}
          onDelete={() => {
            onDelete(menu.id);
            setMenu(null);
          }}
          onDuplicate={() => {
            onDuplicate(menu.id);
            setMenu(null);
          }}
          onHide={() => {
            onHide(menu.id);
            setMenu(null);
          }}
          onUnhide={() => {
            onUnhide(menu.id);
            setMenu(null);
          }}
          onSetColor={(c) => {
            onSetColor(menu.id, c);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

interface TabMenuProps {
  sheet: Sheet;
  canDelete: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onSetColor: (color: string | null) => void;
}

function TabContextMenu({
  sheet,
  canDelete,
  x,
  y,
  onClose,
  onRename,
  onDelete,
  onDuplicate,
  onHide,
  onUnhide,
  onSetColor,
}: TabMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
    };
  }, [onClose]);

  // Anchor menu to viewport — clamp to keep it on-screen.
  const W = 200;
  const H = 220;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - H - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-card border border-border rounded-md shadow-lg py-1 text-[13px]"
      style={{ left, top, width: W }}
    >
      <button
        onClick={onRename}
        className="w-full text-left px-3 py-1.5 hover:bg-bg-hover"
      >
        Rename
      </button>
      <button
        onClick={onDuplicate}
        className="w-full text-left px-3 py-1.5 hover:bg-bg-hover"
      >
        Duplicate
      </button>
      <button
        onClick={onDelete}
        disabled={!canDelete}
        className="w-full text-left px-3 py-1.5 hover:bg-bg-hover disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
      >
        Delete
      </button>
      <div className="border-t border-border my-1" />
      {sheet.hidden ? (
        <button
          onClick={onUnhide}
          className="w-full text-left px-3 py-1.5 hover:bg-bg-hover"
        >
          Show sheet
        </button>
      ) : (
        <button
          onClick={onHide}
          className="w-full text-left px-3 py-1.5 hover:bg-bg-hover"
        >
          Hide sheet
        </button>
      )}
      <div className="border-t border-border my-1" />
      <div className="relative">
        <button
          onClick={() => setSubmenu((v) => !v)}
          className="w-full text-left px-3 py-1.5 hover:bg-bg-hover flex items-center justify-between"
        >
          <span>Change color</span>
          <span className="text-text-muted">›</span>
        </button>
        {submenu && (
          <div
            className="absolute top-0 bg-bg-card border border-border rounded-md shadow-lg p-2 grid grid-cols-5 gap-1"
            style={{ left: '100%' }}
          >
            <button
              onClick={() => onSetColor(null)}
              title="None"
              className="w-5 h-5 rounded-full border border-border bg-bg-card text-text-muted text-[10px] flex items-center justify-center hover:border-accent"
              aria-label="No color"
            >
              ×
            </button>
            {TAB_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => onSetColor(c.value)}
                title={c.label}
                aria-label={c.label}
                className={cn(
                  'w-5 h-5 rounded-full border hover:scale-110 transition-transform',
                  sheet.color === c.value
                    ? 'border-text ring-2 ring-offset-1 ring-accent'
                    : 'border-border',
                )}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
