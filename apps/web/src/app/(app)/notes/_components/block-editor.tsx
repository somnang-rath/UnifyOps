'use client';
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import { Download, FileText, GripVertical, Palette, Paperclip, Plus, Trash2, Upload, X } from 'lucide-react';
import type { NoteBlock, NoteBlockType, TableData } from '@/schemas/note';
import { cn } from '@/lib/utils';
import { filesService } from '@/hooks/use-files';
import { SLASH_OPTIONS, videoEmbedURL, type SlashOption } from './constants';

const COLOR_SWATCHES: { name: string; value: string | null }[] = [
  { name: 'Default', value: null },
  { name: 'Gray', value: '#6b7280' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Green', value: '#10b981' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Rose', value: '#f43f5e' },
];

interface SlashState {
  blockIdx: number;
  filter: string;
  selected: number;
}

interface DropTarget {
  idx: number;
  before: boolean;
}

interface InsertMenuState {
  idx: number;
  top: number;
  left: number;
}

interface Props {
  blocks: NoteBlock[];
  setBlocks: Dispatch<SetStateAction<NoteBlock[]>>;
  onDirty: () => void;
}

export function BlockEditor({ blocks, setBlocks, onDirty }: Props) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashAnchorRect, setSlashAnchorRect] = useState<DOMRect | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [insert, setInsert] = useState<InsertMenuState | null>(null);
  const [colorPicker, setColorPicker] = useState<InsertMenuState | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const focusAfterRender = useRef<number | null>(null);

  // Refocus block on demand (after structural changes)
  useEffect(() => {
    if (focusAfterRender.current === null) return;
    const idx = focusAfterRender.current;
    focusAfterRender.current = null;
    queueMicrotask(() => {
      const el = inputRefs.current[idx];
      el?.focus();
      if (el && 'value' in el) {
        const v = el.value;
        el.setSelectionRange(v.length, v.length);
      }
    });
  });

  // Outside click closes slash + insert + color menu
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (slash && !t.closest('[data-slash-root]') && !t.closest('[data-block-input]')) {
        setSlash(null);
      }
      if (insert && !t.closest('[data-insert-root]')) setInsert(null);
      if (colorPicker && !t.closest('[data-color-root]')) setColorPicker(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [slash, insert, colorPicker]);

  const filteredSlash = (filter: string) => {
    const f = filter.toLowerCase();
    if (!f) return SLASH_OPTIONS;
    return SLASH_OPTIONS.filter(
      (o) => o.name.toLowerCase().includes(f) || o.keywords.includes(f),
    );
  };

  const updateBlock = (idx: number, patch: Partial<NoteBlock>) => {
    setBlocks((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
    onDirty();
  };

  const freshBlock = (type: NoteBlockType): NoteBlock => {
    const b: NoteBlock = { type, value: '' };
    if (type === 'check') b.checked = false;
    if (type === 'table')
      b.table = {
        cols: 3,
        rows: [
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ],
        headerRow: true,
      };
    return b;
  };

  const replaceBlock = (idx: number, type: NoteBlockType) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[idx] = freshBlock(type);
      return next;
    });
    focusAfterRender.current = idx;
    onDirty();
  };

  const insertAfter = (idx: number, type: NoteBlockType) => {
    setBlocks((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, freshBlock(type));
      return next;
    });
    focusAfterRender.current = idx + 1;
    onDirty();
  };

  const removeBlock = (idx: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
    focusAfterRender.current = Math.max(idx - 1, 0);
    onDirty();
  };

  const onInputChange = (
    idx: number,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const v = e.target.value;
    updateBlock(idx, { value: v });
    const b = blocks[idx];
    if (!b || (b.type !== 'text' && b.type !== 'heading')) return;
    if (v.startsWith('/')) {
      const filter = v.slice(1);
      setSlash({ blockIdx: idx, filter, selected: 0 });
      setSlashAnchorRect(e.target.getBoundingClientRect());
    } else if (slash?.blockIdx === idx) {
      setSlash(null);
    }
  };

  const onKeyDown = (
    idx: number,
    ev: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const b = blocks[idx];
    if (!b) return;

    if (slash && slash.blockIdx === idx) {
      const opts = filteredSlash(slash.filter);
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setSlash({
          ...slash,
          selected: Math.min(slash.selected + 1, Math.max(opts.length - 1, 0)),
        });
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setSlash({ ...slash, selected: Math.max(slash.selected - 1, 0) });
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        const opt = opts[slash.selected];
        if (opt) {
          ev.preventDefault();
          replaceBlock(idx, opt.type);
          setSlash(null);
        }
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        setSlash(null);
        return;
      }
    }

    if (ev.key === 'Enter' && !ev.shiftKey) {
      // code preserves Enter as newline
      if (b.type === 'code') return;
      // continue list-like types, otherwise default to text
      const nextType: NoteBlockType =
        b.type === 'check' ? 'check' : 'text';
      ev.preventDefault();
      const fresh: NoteBlock = { type: nextType, value: '' };
      if (nextType === 'check') fresh.checked = false;
      setBlocks((prev) => {
        const next = [...prev];
        next.splice(idx + 1, 0, fresh);
        return next;
      });
      focusAfterRender.current = idx + 1;
      onDirty();
      return;
    }

    if (ev.key === 'Backspace' && !b.value && blocks.length > 1) {
      ev.preventDefault();
      removeBlock(idx);
      return;
    }
  };

  // Drag-to-reorder
  const onDragStart = (idx: number, ev: React.DragEvent) => {
    setDrag(idx);
    ev.dataTransfer.effectAllowed = 'move';
    const block = (ev.currentTarget as HTMLElement).closest('[data-block]');
    if (block) {
      try {
        ev.dataTransfer.setDragImage(block as HTMLElement, 12, 12);
      } catch {}
    }
    setSlash(null);
  };

  const onDragOver = (idx: number, ev: React.DragEvent) => {
    if (drag === null || idx === drag) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const before = ev.clientY < r.top + r.height / 2;
    setDrop({ idx, before });
  };

  const onDrop = (idx: number, ev: React.DragEvent) => {
    if (drag === null) return;
    ev.preventDefault();
    if (idx === drag) {
      setDrag(null);
      setDrop(null);
      return;
    }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const before = ev.clientY < r.top + r.height / 2;
    let insertAt = before ? idx : idx + 1;
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(drag, 1);
      if (drag < insertAt) insertAt--;
      next.splice(insertAt, 0, moved);
      return next;
    });
    onDirty();
    setDrag(null);
    setDrop(null);
  };

  const onDragEnd = () => {
    setDrag(null);
    setDrop(null);
  };

  const slashOpts = slash ? filteredSlash(slash.filter) : [];
  // Position slash menu under the active block's input
  const slashTop =
    slashAnchorRect && editorRef.current
      ? slashAnchorRect.bottom -
        editorRef.current.getBoundingClientRect().top +
        6
      : 0;
  const slashLeft =
    slashAnchorRect && editorRef.current
      ? slashAnchorRect.left -
        editorRef.current.getBoundingClientRect().left
      : 0;

  return (
    <div ref={editorRef} className="relative">
      {blocks.length === 0 ? (
        <div className="px-3 py-12 text-center text-[13px] text-text-muted">
          Press{' '}
          <kbd className="font-mono text-[11px] bg-bg-hover border border-border rounded px-1.5 py-px">
            /
          </kbd>{' '}
          for commands, or just start typing…
        </div>
      ) : (
        blocks.map((b, i) => (
          <BlockRow
            key={i}
            idx={i}
            block={b}
            registerRef={(el) => (inputRefs.current[i] = el)}
            onInputChange={onInputChange}
            onKeyDown={onKeyDown}
            onCheckedChange={(checked) => updateBlock(i, { checked })}
            onRemove={() => removeBlock(i)}
            onDragStart={(ev) => onDragStart(i, ev)}
            onDragOver={(ev) => onDragOver(i, ev)}
            onDrop={(ev) => onDrop(i, ev)}
            onDragEnd={onDragEnd}
            isDragging={drag === i}
            dropBefore={drop?.idx === i && drop.before}
            dropAfter={drop?.idx === i && !drop.before}
            onAddBelow={(rect) =>
              setInsert({
                idx: i,
                top:
                  rect.bottom -
                  (editorRef.current?.getBoundingClientRect().top ?? 0) +
                  4,
                left:
                  rect.left -
                  (editorRef.current?.getBoundingClientRect().left ?? 0),
              })
            }
            onTableChange={(table) => updateBlock(i, { table })}
            onColorClick={(rect) =>
              setColorPicker({
                idx: i,
                top:
                  rect.bottom -
                  (editorRef.current?.getBoundingClientRect().top ?? 0) +
                  4,
                left:
                  rect.left -
                  (editorRef.current?.getBoundingClientRect().left ?? 0),
              })
            }
            onFileSelect={(fileId, fileName) =>
              updateBlock(i, { fileId, value: fileName })
            }
            onViewSizeChange={(size) => updateBlock(i, { fileViewSize: size })}
          />
        ))
      )}

      {slash && slashOpts.length > 0 && (
        <SlashMenu
          options={slashOpts}
          selected={slash.selected}
          top={slashTop}
          left={slashLeft}
          onPick={(t) => {
            replaceBlock(slash.blockIdx, t);
            setSlash(null);
          }}
          onHover={(i) => setSlash((s) => (s ? { ...s, selected: i } : s))}
        />
      )}
      {slash && slashOpts.length === 0 && (
        <div
          data-slash-root
          className="absolute z-30 bg-bg-card border border-border rounded-md shadow-lg px-3 py-2 text-[12.5px] text-text-muted"
          style={{ top: slashTop, left: slashLeft }}
        >
          No matching block
        </div>
      )}

      {insert && (
        <InsertMenu
          top={insert.top}
          left={insert.left}
          onClose={() => setInsert(null)}
          onPick={(t) => {
            insertAfter(insert.idx, t);
            setInsert(null);
          }}
        />
      )}

      {colorPicker && (
        <ColorMenu
          top={colorPicker.top}
          left={colorPicker.left}
          current={blocks[colorPicker.idx]?.color}
          onPick={(c) => {
            updateBlock(colorPicker.idx, { color: c ?? undefined });
            setColorPicker(null);
          }}
        />
      )}
    </div>
  );
}

interface BlockRowProps {
  idx: number;
  block: NoteBlock;
  registerRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onInputChange: (
    i: number,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onKeyDown: (
    i: number,
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onCheckedChange: (checked: boolean) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onAddBelow: (rect: DOMRect) => void;
  onTableChange: (table: TableData) => void;
  onColorClick: (rect: DOMRect) => void;
  onFileSelect: (fileId: string, fileName: string) => void;
  onViewSizeChange: (size: 'sm' | 'md' | 'lg') => void;
}

function BlockRow({
  idx,
  block,
  registerRef,
  onInputChange,
  onKeyDown,
  onCheckedChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  dropBefore,
  dropAfter,
  onAddBelow,
  onTableChange,
  onColorClick,
  onFileSelect,
  onViewSizeChange,
}: BlockRowProps) {
  return (
    <div
      data-block
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'group relative flex gap-1 py-0.5 transition-opacity',
        isDragging && 'opacity-40',
        dropBefore &&
          'before:absolute before:top-0 before:left-12 before:right-0 before:h-px before:bg-accent',
        dropAfter &&
          'after:absolute after:bottom-0 after:left-12 after:right-0 after:h-px after:bg-accent',
      )}
    >
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
        <button
          type="button"
          title="Add block below"
          onClick={(e) =>
            onAddBelow((e.currentTarget as HTMLElement).getBoundingClientRect())
          }
          className="w-6 h-6 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Text color"
          onClick={(e) =>
            onColorClick(
              (e.currentTarget as HTMLElement).getBoundingClientRect(),
            )
          }
          className="w-6 h-6 rounded-sm flex items-center justify-center hover:bg-bg-hover relative"
          style={{ color: block.color || 'var(--text-muted)' }}
        >
          <Palette className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Drag to reorder"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="w-6 h-6 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <BlockBody
          idx={idx}
          block={block}
          registerRef={registerRef}
          onInputChange={onInputChange}
          onKeyDown={onKeyDown}
          onCheckedChange={onCheckedChange}
          onTableChange={onTableChange}
          onFileSelect={onFileSelect}
          onViewSizeChange={onViewSizeChange}
        />
      </div>

      <button
        type="button"
        title="Remove block"
        onClick={onRemove}
        className="w-6 h-6 rounded-sm flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-red transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface BlockBodyProps {
  idx: number;
  block: NoteBlock;
  registerRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onInputChange: (
    i: number,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onKeyDown: (
    i: number,
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onCheckedChange: (checked: boolean) => void;
  onTableChange: (table: TableData) => void;
  onFileSelect: (fileId: string, fileName: string) => void;
  onViewSizeChange: (size: 'sm' | 'md' | 'lg') => void;
}

function BlockBody({
  idx,
  block,
  registerRef,
  onInputChange,
  onKeyDown,
  onCheckedChange,
  onTableChange,
  onFileSelect,
  onViewSizeChange,
}: BlockBodyProps) {
  const colorStyle = block.color ? { color: block.color } : undefined;
  switch (block.type) {
    case 'heading':
      return (
        <input
          ref={registerRef as any}
          data-block-input
          value={block.value}
          onChange={(e) => onInputChange(idx, e)}
          onKeyDown={(e) => onKeyDown(idx, e)}
          placeholder="Heading"
          style={colorStyle}
          className="w-full bg-transparent border-0 outline-none text-[22px] font-bold leading-[1.3] py-1 placeholder:text-[color:color-mix(in_srgb,var(--text-muted)_70%,transparent)]"
        />
      );
    case 'check':
      return (
        <div className="flex items-start gap-2 py-1">
          <input
            type="checkbox"
            checked={!!block.checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
            className="mt-1 w-3.5 h-3.5 rounded-xs accent-accent"
          />
          <input
            ref={registerRef as any}
            data-block-input
            value={block.value}
            onChange={(e) => onInputChange(idx, e)}
            onKeyDown={(e) => onKeyDown(idx, e)}
            placeholder="To-do"
            style={colorStyle}
            className={cn(
              'flex-1 bg-transparent border-0 outline-none text-[14px] leading-[1.6] placeholder:text-text-muted',
              block.checked && 'line-through text-text-muted',
            )}
          />
        </div>
      );
    case 'code':
      return (
        <AutoTextarea
          ref={registerRef as any}
          data-block-input
          value={block.value}
          onChange={(e) => onInputChange(idx, e)}
          onKeyDown={(e) => onKeyDown(idx, e)}
          placeholder="// code"
          spellCheck={false}
          style={colorStyle}
          className="w-full bg-bg-code border border-border rounded-md font-mono text-[12.5px] leading-[1.6] p-3 outline-none resize-none focus:border-accent placeholder:text-text-muted"
        />
      );
    case 'image':
      return (
        <div className="flex flex-col gap-2 py-1">
          {block.value && (
            <img
              src={block.value}
              alt=""
              className="max-w-full rounded-md border border-border"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          )}
          <input
            ref={registerRef as any}
            data-block-input
            value={block.value}
            onChange={(e) => onInputChange(idx, e)}
            onKeyDown={(e) => onKeyDown(idx, e)}
            placeholder="Paste image URL…"
            className="w-full bg-bg-subtle border border-border rounded-sm px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
          />
        </div>
      );
    case 'video':
      return (
        <div className="flex flex-col gap-2 py-1">
          {block.value && (
            <div className="aspect-video w-full rounded-md overflow-hidden border border-border bg-black">
              <iframe
                src={videoEmbedURL(block.value)}
                allowFullScreen
                loading="lazy"
                className="w-full h-full"
              />
            </div>
          )}
          <input
            ref={registerRef as any}
            data-block-input
            value={block.value}
            onChange={(e) => onInputChange(idx, e)}
            onKeyDown={(e) => onKeyDown(idx, e)}
            placeholder="Paste YouTube, Vimeo, or direct video URL…"
            className="w-full bg-bg-subtle border border-border rounded-sm px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
          />
        </div>
      );
    case 'divider':
      return <hr className="my-3 border-0 border-t border-border" />;
    case 'table':
      return (
        <TableBlock
          table={
            block.table ?? {
              cols: 3,
              rows: [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
              ],
              headerRow: true,
            }
          }
          color={block.color}
          onChange={onTableChange}
        />
      );
    case 'file':
      return <FileBlock block={block} onFileSelect={onFileSelect} onViewSizeChange={onViewSizeChange} />;
    case 'text':
    default:
      return (
        <AutoTextarea
          ref={registerRef as any}
          data-block-input
          value={block.value}
          onChange={(e) => onInputChange(idx, e)}
          onKeyDown={(e) => onKeyDown(idx, e)}
          placeholder="Type / for commands…"
          rows={1}
          style={colorStyle}
          className="w-full bg-transparent border-0 outline-none text-[14px] leading-[1.7] resize-none py-1 placeholder:text-text-muted"
        />
      );
  }
}

type FileViewSize = 'sm' | 'md' | 'lg';

function FileBlock({
  block,
  onFileSelect,
  onViewSizeChange,
}: {
  block: NoteBlock;
  onFileSelect: (fileId: string, fileName: string) => void;
  onViewSizeChange: (size: FileViewSize) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const viewSize: FileViewSize = (block.fileViewSize as FileViewSize) ?? 'md';

  const isPdf = (block.value ?? '').toLowerCase().endsWith('.pdf');
  const downloadUrl = block.fileId ? filesService.downloadUrl(block.fileId) : null;

  const handleFile = async (file: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const item = await filesService.upload(file, null, (pct) => setProgress(pct));
      onFileSelect(item._id, item.name);
    } catch {
      // api interceptor already shows a toast
    } finally {
      setUploading(false);
    }
  };

  if (!block.fileId) {
    return (
      <div
        className={cn(
          'my-1 border-2 border-dashed rounded-md px-4 py-6 flex flex-col items-center gap-2 cursor-pointer transition-colors select-none',
          dragOver
            ? 'border-accent bg-[color:color-mix(in_srgb,var(--a)_8%,transparent)]'
            : 'border-border hover:border-accent/50 hover:bg-bg-subtle',
        )}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        {uploading ? (
          <>
            <Upload className="w-5 h-5 text-accent animate-pulse" />
            <span className="text-[12.5px] text-text-sub">Uploading… {progress}%</span>
            <div className="w-40 h-1 rounded-full bg-bg-hover overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        ) : (
          <>
            <Paperclip className="w-5 h-5 text-text-muted" />
            <span className="text-[12.5px] text-text-sub">Click to upload or drop a file here</span>
            <span className="text-[11px] text-text-muted">PDF, images, docs — up to 25 MB</span>
          </>
        )}
      </div>
    );
  }

  const sizeOptions: { key: FileViewSize; label: string; title: string }[] = [
    { key: 'sm', label: 'S', title: 'Small — header only' },
    { key: 'md', label: 'M', title: 'Default' },
    { key: 'lg', label: 'FS', title: 'Full screen' },
  ];

  return (
    <>
      <div className="my-1 rounded-md border border-border bg-bg-subtle overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <FileText className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="flex-1 min-w-0 text-[13px] font-medium truncate">{block.value}</span>

          {isPdf && (
            <div className="flex items-center rounded-sm border border-border overflow-hidden text-[10.5px] font-semibold flex-shrink-0">
              {sizeOptions.map(({ key, label, title }, i) => (
                <button
                  key={key}
                  type="button"
                  title={title}
                  onClick={() => onViewSizeChange(key)}
                  className={cn(
                    'px-1.5 py-0.5 transition-colors',
                    i < sizeOptions.length - 1 && 'border-r border-border',
                    viewSize === key
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:bg-bg-hover hover:text-text',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <a
            href={downloadUrl!}
            download={block.value}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[11.5px] text-accent hover:underline flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
        </div>

        {isPdf && viewSize === 'md' && (
          <iframe
            src={downloadUrl!}
            title={block.value}
            className="w-full h-[360px] block border-t border-border"
          />
        )}
      </div>

      {isPdf && viewSize === 'lg' && (
        <div className="fixed inset-0 z-50 flex flex-col" onClick={() => onViewSizeChange('md')}>
          <div
            className="flex items-center gap-2 px-4 py-2.5 bg-bg-card border-b border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <FileText className="w-4 h-4 text-accent flex-shrink-0" />
            <span className="flex-1 min-w-0 text-[13px] font-semibold truncate">{block.value}</span>
            <div className="flex items-center rounded-sm border border-border overflow-hidden text-[10.5px] font-semibold mr-2">
              {sizeOptions.map(({ key, label, title }, i) => (
                <button
                  key={key}
                  type="button"
                  title={title}
                  onClick={(e) => { e.stopPropagation(); onViewSizeChange(key); }}
                  className={cn(
                    'px-1.5 py-0.5 transition-colors',
                    i < sizeOptions.length - 1 && 'border-r border-border',
                    viewSize === key
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:bg-bg-hover hover:text-text',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              title="Close full screen"
              onClick={() => onViewSizeChange('md')}
              className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <iframe
            src={downloadUrl!}
            title={block.value}
            className="flex-1 w-full block bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function TableBlock({
  table,
  color,
  onChange,
}: {
  table: TableData;
  color?: string;
  onChange: (t: TableData) => void;
}) {
  const cols = table.cols;
  const rows = table.rows;
  const headerRow = !!table.headerRow;

  const setCell = (r: number, c: number, v: string) => {
    const next = rows.map((row, ri) =>
      ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row,
    );
    onChange({ ...table, rows: next });
  };

  const addRow = () => {
    onChange({ ...table, rows: [...rows, Array(cols).fill('')] });
  };
  const addCol = () => {
    onChange({
      ...table,
      cols: cols + 1,
      rows: rows.map((row) => [...row, '']),
    });
  };
  const removeRow = (r: number) => {
    if (rows.length <= 1) return;
    onChange({ ...table, rows: rows.filter((_, i) => i !== r) });
  };
  const removeCol = (c: number) => {
    if (cols <= 1) return;
    onChange({
      ...table,
      cols: cols - 1,
      rows: rows.map((row) => row.filter((_, i) => i !== c)),
    });
  };
  const toggleHeader = () =>
    onChange({ ...table, headerRow: !headerRow });

  return (
    <div className="my-2 group/table">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {rows.map((row, ri) => {
              const isHeader = headerRow && ri === 0;
              return (
                <tr key={ri} className="group/row relative">
                  {row.map((cell, ci) => {
                    const Cell = isHeader ? 'th' : 'td';
                    return (
                      <Cell
                        key={ci}
                        className={cn(
                          'border border-border align-top p-0 relative',
                          isHeader && 'bg-bg-subtle',
                        )}
                      >
                        <input
                          value={cell}
                          onChange={(e) => setCell(ri, ci, e.target.value)}
                          placeholder={isHeader ? 'Header' : ''}
                          style={color ? { color } : undefined}
                          className={cn(
                            'w-full bg-transparent border-0 outline-none px-2.5 py-1.5 text-[13px] focus:bg-[color:color-mix(in_srgb,var(--a)_6%,transparent)]',
                            isHeader && 'font-semibold',
                          )}
                        />
                        {ri === 0 && (
                          <button
                            type="button"
                            title="Delete column"
                            onClick={() => removeCol(ci)}
                            className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/table:opacity-100 w-5 h-5 rounded-sm bg-bg-card border border-border flex items-center justify-center text-text-muted hover:text-red transition-opacity"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </Cell>
                    );
                  })}
                  <td className="w-0 p-0 border-0">
                    <button
                      type="button"
                      title="Delete row"
                      onClick={() => removeRow(ri)}
                      className="opacity-0 group-hover/row:opacity-100 absolute top-1/2 -translate-y-1/2 -right-6 w-5 h-5 rounded-sm bg-bg-card border border-border flex items-center justify-center text-text-muted hover:text-red transition-opacity"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover/table:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={addRow}
          className="text-[11px] px-2 py-0.5 rounded-sm bg-bg-subtle border border-border hover:bg-bg-hover text-text-sub"
        >
          + Row
        </button>
        <button
          type="button"
          onClick={addCol}
          className="text-[11px] px-2 py-0.5 rounded-sm bg-bg-subtle border border-border hover:bg-bg-hover text-text-sub"
        >
          + Column
        </button>
        <button
          type="button"
          onClick={toggleHeader}
          className={cn(
            'text-[11px] px-2 py-0.5 rounded-sm border border-border',
            headerRow
              ? 'bg-[color:color-mix(in_srgb,var(--a)_12%,transparent)] text-accent border-accent/40'
              : 'bg-bg-subtle hover:bg-bg-hover text-text-sub',
          )}
        >
          Header row
        </button>
      </div>
    </div>
  );
}

const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ value, onChange, ...rest }, ref) => {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  }, [value]);
  return (
    <textarea
      ref={setRefs}
      value={value}
      onChange={onChange}
      {...rest}
    />
  );
});
AutoTextarea.displayName = 'AutoTextarea';

function SlashMenu({
  options,
  selected,
  top,
  left,
  onPick,
  onHover,
}: {
  options: SlashOption[];
  selected: number;
  top: number;
  left: number;
  onPick: (t: NoteBlockType) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div
      data-slash-root
      role="listbox"
      className="absolute z-30 w-[280px] bg-bg-card border border-border rounded-md shadow-lg overflow-hidden animate-slide-up"
      style={{ top, left }}
    >
      <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[.06em] font-bold text-text-muted border-b border-border">
        Basic blocks
      </div>
      <div className="max-h-[280px] overflow-y-auto py-1">
        {options.map((o, i) => {
          const Icon = o.icon;
          return (
            <button
              key={o.type}
              type="button"
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(o.type);
              }}
              onMouseEnter={() => onHover(i)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                i === selected ? 'bg-bg-hover' : 'hover:bg-bg-hover',
              )}
            >
              <span
                className={cn(
                  'w-7 h-7 flex items-center justify-center rounded-sm border border-border bg-bg-subtle text-text-sub',
                  i === selected && 'text-accent border-accent/30',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0">
                <strong className="block text-[12.5px] truncate">
                  {o.name}
                </strong>
                <span className="block text-[11px] text-text-muted truncate">
                  {o.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InsertMenu({
  top,
  left,
  onPick,
  onClose,
}: {
  top: number;
  left: number;
  onPick: (t: NoteBlockType) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-insert-root
      className="absolute z-30 w-[260px] bg-bg-card border border-border rounded-md shadow-lg overflow-hidden animate-slide-up"
      style={{ top, left }}
    >
      <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-[.06em] font-bold text-text-muted border-b border-border">
        Add block below
      </div>
      <div className="max-h-[280px] overflow-y-auto py-1">
        {SLASH_OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.type}
              type="button"
              onClick={() => onPick(o.type)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-bg-hover"
            >
              <span className="w-7 h-7 flex items-center justify-center rounded-sm border border-border bg-bg-subtle text-text-sub">
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0">
                <strong className="block text-[12.5px] truncate">
                  {o.name}
                </strong>
                <span className="block text-[11px] text-text-muted truncate">
                  {o.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorMenu({
  top,
  left,
  current,
  onPick,
}: {
  top: number;
  left: number;
  current?: string;
  onPick: (color: string | null) => void;
}) {
  return (
    <div
      data-color-root
      className="absolute z-30 bg-bg-card border border-border rounded-md shadow-lg p-2 animate-slide-up"
      style={{ top, left }}
    >
      <div className="px-1 pb-1.5 text-[10.5px] uppercase tracking-[.06em] font-bold text-text-muted">
        Text color
      </div>
      <div className="grid grid-cols-6 gap-1 w-[168px]">
        {COLOR_SWATCHES.map((s) => {
          const isActive =
            (current ?? null) === (s.value ?? null) ||
            (!current && s.value === null);
          return (
            <button
              key={s.name}
              type="button"
              title={s.name}
              onClick={() => onPick(s.value)}
              className={cn(
                'w-6 h-6 rounded-sm border flex items-center justify-center text-[10px] font-bold transition-transform hover:scale-110',
                isActive
                  ? 'border-accent ring-2 ring-accent/30'
                  : 'border-border',
              )}
              style={{
                background: s.value ?? 'transparent',
                color: s.value ? '#fff' : 'var(--text-muted)',
              }}
            >
              {s.value === null ? 'A' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
