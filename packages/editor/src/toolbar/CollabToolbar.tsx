'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Code2,
  Highlighter,
  ImagePlus,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Outdent,
  Paperclip,
  Quote,
  Redo2,
  RemoveFormatting,
  Smile,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import type { UploadedAttachment } from '../RichTextEditor';
import { EMOJI_CATEGORIES } from '../rich-emojis';
import { Btn, Sep, cx } from './primitives';
import { LinkPopover } from './LinkPopover';
import { ImageUrlPopover } from './ImageUrlPopover';
import { ColorPopover } from './ColorPopover';
import { TableBar } from './TableBar';
// The toolbar reuses the `prism-rich-*` styles so it renders identically to the
// RichTextEditor toolbar even on pages that never mount an RTE.
import '../rich-editor.css';

/**
 * Formatting toolbar for the collaborative editor (spec §2.3). Presentational:
 * operates only on the passed Tiptap `Editor` — no fetching, no Yjs awareness.
 * Used by notes now; wiki inherits it when it moves to collab.
 *
 * **Always exactly one row.** The controls are declared as ordered groups
 * (`buildGroups`, most-used first); whatever does not fit the measured width
 * collapses into a trailing "More" popover instead of wrapping. Notes renders
 * this inline in a header that can be a few hundred pixels wide, where the old
 * wrapping layout grew to four stacked rows and pushed the document down.
 *
 * Every control here must have a matching entry in the canonical
 * `editorExtensions` — and therefore in apps/live's mirrored copy, or the
 * formatting is dropped from the server's HTML snapshot.
 *
 * Deliberately excluded: Callout/box. Callouts are a markdown-rendering
 * convention (`> [!NOTE]` + MarkdownView); the collab schema renders raw HTML
 * with no admonition pass, so the button would produce literal `[!NOTE]` text.
 */
export interface CollabToolbarProps {
  /** From `renderChrome` ctx; `null` renders a fixed-height disabled skeleton. */
  editor: Editor | null;
  /**
   * Optional upload handler (same contract as RichTextEditor's `onUpload`).
   * Shows the 📎 button; an image result inserts `setImage`, anything else a
   * link-marked text node.
   */
  onUpload?: (file: File) => Promise<UploadedAttachment | null>;
  /**
   * `panel` (default) — a bordered strip above the editable surface.
   * `bar` — inlined into a host's own header row: no border/background of its
   * own, never sticky, and it inherits the header's padding.
   */
  variant?: 'panel' | 'bar';
  /**
   * Stick to the top of the editor scroll container. Defaults to true for
   * `panel` and false for `bar` (the host header is already pinned).
   */
  sticky?: boolean;
  className?: string;
}

/**
 * StarterKit ships heading levels 1–6, so all six are offered. (This used to
 * stop at H3; the deeper levels were always in the schema, just unreachable
 * from the toolbar.)
 */
const HEADINGS = [
  { label: 'Normal text', level: 0 as const },
  { label: 'Heading 1', level: 1 as const },
  { label: 'Heading 2', level: 2 as const },
  { label: 'Heading 3', level: 3 as const },
  { label: 'Heading 4', level: 4 as const },
  { label: 'Heading 5', level: 5 as const },
  { label: 'Heading 6', level: 6 as const },
];

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const ALIGNMENTS = [
  { label: 'Left', value: 'left', Icon: AlignLeft },
  { label: 'Center', value: 'center', Icon: AlignCenter },
  { label: 'Right', value: 'right', Icon: AlignRight },
  { label: 'Justify', value: 'justify', Icon: AlignJustify },
] as const;

/** Width of the trailing "More" button (28px) plus its separator and gaps. */
const MORE_WIDTH = 40;

/** One measurable slice of the toolbar. Order is priority order. */
interface ToolbarGroup {
  id: string;
  node: React.ReactNode;
}

export function CollabToolbar({
  editor,
  onUpload,
  variant = 'panel',
  sticky,
  className,
}: CollabToolbarProps): React.ReactElement {
  const isBar = variant === 'bar';
  const isSticky = sticky ?? !isBar;
  const wrapClass = cx(
    'prism-collab-toolbar-wrap',
    isBar && 'is-bar',
    isSticky && 'is-sticky',
    className,
  );
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showHeadings, setShowHeadings] = React.useState(false);
  const [showLink, setShowLink] = React.useState(false);
  const [showImage, setShowImage] = React.useState(false);
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [showColor, setShowColor] = React.useState(false);
  const [showHighlight, setShowHighlight] = React.useState(false);
  const [showAlign, setShowAlign] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);

  const onUploadRef = React.useRef(onUpload);
  onUploadRef.current = onUpload;

  // Re-render on every transaction so isActive() reflects the caret position
  // even if the host component doesn't re-render (defensive — CollabSurface
  // usually re-renders anyway).
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!editor) return;
    editor.on('transaction', force);
    return () => {
      editor.off('transaction', force);
    };
  }, [editor]);

  /**
   * Close the content popovers but leave the overflow menu alone. Controls that
   * live in the overflow render *inside* that menu, so closing it here would
   * unmount the very popover the click is opening.
   */
  const closePopovers = React.useCallback(() => {
    setShowHeadings(false);
    setShowLink(false);
    setShowImage(false);
    setShowEmoji(false);
    setShowColor(false);
    setShowHighlight(false);
    setShowAlign(false);
  }, []);

  /** Everything, including the overflow menu — outside click / Escape. */
  const closeAll = React.useCallback(() => {
    closePopovers();
    setShowMore(false);
  }, [closePopovers]);

  // Outside click / Escape closes any open popover (same wiring as the RTE).
  const anyOpen =
    showHeadings ||
    showLink ||
    showImage ||
    showEmoji ||
    showColor ||
    showHighlight ||
    showAlign ||
    showMore;
  React.useEffect(() => {
    if (!anyOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-rte-pop]') || t.closest('[data-rte-anchor]')) return;
      closeAll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anyOpen, closeAll]);

  const uploadAll = React.useCallback(
    async (files: File[]) => {
      if (!editor || !onUploadRef.current) return;
      for (const file of files) {
        const res = await onUploadRef.current(file);
        if (!res) continue;
        if (res.isImage) {
          editor.chain().focus().setImage({ src: res.url, alt: res.name }).run();
        } else {
          // No markdown extension in the collab schema — insert a real link mark.
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text: res.name,
              marks: [{ type: 'link', attrs: { href: res.url } }],
            })
            .run();
        }
      }
    },
    [editor],
  );

  // --- Overflow measurement -------------------------------------------------
  // Group widths are constant (fixed-size buttons), so they're measured once
  // while every group is mounted and then reused. `visibleCount` is the only
  // thing resize recomputes, which keeps the observer allocation-free and stops
  // the measure→hide→remeasure feedback loop a re-measuring layout would cause.
  const rowRef = React.useRef<HTMLDivElement>(null);
  const widthsRef = React.useRef<number[] | null>(null);
  const [visibleCount, setVisibleCount] = React.useState<number | null>(null);

  const groups = editor ? buildGroups() : [];

  const measure = React.useCallback(() => {
    const row = rowRef.current;
    if (!row) return;

    if (!widthsRef.current) {
      const els = Array.from(
        row.querySelectorAll<HTMLElement>('[data-tb-group]'),
      );
      // Only trust a pass where every group is mounted, else the cache would
      // bake in the already-collapsed layout.
      if (els.length < groups.length) return;
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap || '0') || 0;
      widthsRef.current = els.map((el) => el.getBoundingClientRect().width + gap);
    }

    const widths = widthsRef.current;
    const style = getComputedStyle(row);
    const inner =
      row.clientWidth -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0);

    const total = widths.reduce((a, b) => a + b, 0);
    if (total <= inner) {
      setVisibleCount(widths.length);
      return;
    }

    // Something must collapse, so the "More" button is now part of the budget.
    const budget = inner - MORE_WIDTH;
    let used = 0;
    let n = 0;
    while (n < widths.length && used + widths[n] <= budget) {
      used += widths[n];
      n += 1;
    }
    // Never collapse everything — one group always beats a lone "More" button.
    setVisibleCount(Math.max(1, n));
  }, [groups.length]);

  React.useLayoutEffect(() => {
    if (!editor) return;
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(row);
    return () => ro.disconnect();
  }, [editor, measure]);

  // Disabled skeleton (editor not ready) — fixed height so layout never jumps.
  if (!editor) {
    return (
      <div className={wrapClass}>
        <div className="prism-rich-toolbar prism-collab-toolbar" aria-hidden />
      </div>
    );
  }

  // Before the first measurement every group renders, which is exactly what the
  // width cache needs; afterwards the tail moves into the "More" popover.
  const shown = visibleCount ?? groups.length;
  const overflow = groups.slice(shown);

  return (
    <div className={wrapClass}>
      <div
        ref={rowRef}
        role="toolbar"
        aria-label="Formatting"
        className="prism-rich-toolbar prism-collab-toolbar"
      >
        {groups.slice(0, shown).map((g) => (
          <div key={g.id} data-tb-group className="prism-collab-group">
            {g.node}
          </div>
        ))}

        {overflow.length > 0 && (
          <div className="prism-rich-rel prism-collab-more">
            <Sep />
            <Btn
              title="More formatting"
              anchor
              active={showMore}
              onClick={() => {
                const next = !showMore;
                closeAll();
                setShowMore(next);
              }}
            >
              <MoreHorizontal />
            </Btn>
            {showMore && (
              <div data-rte-pop className="prism-collab-morepop">
                {overflow.map((g) => (
                  <div key={g.id} className="prism-collab-group">
                    {g.node}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contextual table controls (same strip as the RTE). */}
      <TableBar editor={editor} />
    </div>
  );

  /**
   * The controls, in priority order: whatever falls off the end goes into the
   * "More" popover, so the most-reached-for tools stay on the row longest.
   * Declared as a closure to keep the (many) handlers next to their buttons.
   */
  function buildGroups(): ToolbarGroup[] {
    if (!editor) return [];

    const activeHeading =
      HEADINGS.find(
        (h) => h.level > 0 && editor.isActive('heading', { level: h.level }),
      )?.label ?? 'Normal text';

    const setHeading = (level: number) => {
      setShowHeadings(false);
      if (level === 0) editor.chain().focus().setParagraph().run();
      else
        editor
          .chain()
          .focus()
          .toggleHeading({ level: level as HeadingLevel })
          .run();
    };

    const activeAlign =
      ALIGNMENTS.find((a) => editor.isActive({ textAlign: a.value })) ??
      ALIGNMENTS[0];
    const AlignIcon = activeAlign.Icon;

    // Yjs owns history (StarterKit's is disabled), so undo/redo come from the
    // Collaboration extension's UndoManager. `can()` keeps them correctly greyed.
    const canUndo = editor.can().undo();
    const canRedo = editor.can().redo();

    // List indent/outdent only apply inside a list item.
    const inListItem = editor.isActive('listItem') || editor.isActive('taskItem');

    return [
      {
        id: 'history',
        node: (
          <>
            <Btn
              title="Undo (Ctrl+Z)"
              disabled={!canUndo}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 />
            </Btn>
            <Btn
              title="Redo (Ctrl+Shift+Z)"
              disabled={!canRedo}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 />
            </Btn>
          </>
        ),
      },
      {
        id: 'heading',
        node: (
          <div className="prism-rich-rel">
            <button
              type="button"
              data-rte-anchor
              className="prism-rich-text-btn"
              onClick={() => {
                const next = !showHeadings;
                closePopovers();
                setShowHeadings(next);
              }}
            >
              <span className="prism-collab-hlabel">{activeHeading}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showHeadings && (
              <div data-rte-pop className="prism-rich-menu">
                {HEADINGS.map((h) => (
                  <button
                    key={h.level}
                    type="button"
                    className={cx(
                      'prism-rich-menu-item',
                      `is-h${h.level}`,
                      (h.level === 0
                        ? editor.isActive('paragraph') &&
                          !editor.isActive('heading')
                        : editor.isActive('heading', { level: h.level })) &&
                        'is-active',
                    )}
                    onClick={() => setHeading(h.level)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'marks',
        node: (
          <>
            <Btn
              title="Bold"
              active={editor.isActive('bold')}
              pressed={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold />
            </Btn>
            <Btn
              title="Italic"
              active={editor.isActive('italic')}
              pressed={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic />
            </Btn>
            <Btn
              title="Underline (Ctrl+U)"
              active={editor.isActive('underline')}
              pressed={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon />
            </Btn>
            <Btn
              title="Strikethrough"
              active={editor.isActive('strike')}
              pressed={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough />
            </Btn>
          </>
        ),
      },
      {
        id: 'lists',
        node: (
          <>
            <Btn
              title="Bullet list"
              active={editor.isActive('bulletList')}
              pressed={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List />
            </Btn>
            <Btn
              title="Numbered list"
              active={editor.isActive('orderedList')}
              pressed={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered />
            </Btn>
            <Btn
              title="Task list"
              active={editor.isActive('taskList')}
              pressed={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListChecks />
            </Btn>
          </>
        ),
      },
      {
        id: 'link',
        node: (
          <>
            <div className="prism-rich-rel">
              <Btn
                title="Link"
                anchor
                active={editor.isActive('link')}
                onClick={() => {
                  const next = !showLink;
                  closePopovers();
                  setShowLink(next);
                }}
              >
                <LinkIcon />
              </Btn>
              {showLink && (
                <LinkPopover editor={editor} onClose={() => setShowLink(false)} />
              )}
            </div>
            <Btn
              title="Inline code"
              active={editor.isActive('code')}
              pressed={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code />
            </Btn>
          </>
        ),
      },
      {
        id: 'color',
        node: (
          <>
            <div className="prism-rich-rel">
              <Btn
                title="Text color"
                anchor
                active={showColor || editor.isActive('textStyle')}
                onClick={() => {
                  const next = !showColor;
                  closePopovers();
                  setShowColor(next);
                }}
              >
                <Baseline />
              </Btn>
              {showColor && (
                <ColorPopover
                  editor={editor}
                  mode="text"
                  onClose={() => setShowColor(false)}
                />
              )}
            </div>
            <div className="prism-rich-rel">
              <Btn
                title="Highlight"
                anchor
                active={showHighlight || editor.isActive('highlight')}
                onClick={() => {
                  const next = !showHighlight;
                  closePopovers();
                  setShowHighlight(next);
                }}
              >
                <Highlighter />
              </Btn>
              {showHighlight && (
                <ColorPopover
                  editor={editor}
                  mode="highlight"
                  onClose={() => setShowHighlight(false)}
                />
              )}
            </div>
          </>
        ),
      },
      {
        id: 'blocks',
        node: (
          <>
            <Btn
              title="Quote"
              active={editor.isActive('blockquote')}
              pressed={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote />
            </Btn>
            <Btn
              title="Code block"
              active={editor.isActive('codeBlock')}
              pressed={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <Code2 />
            </Btn>
          </>
        ),
      },
      {
        id: 'insert',
        node: (
          <>
            <Btn
              title="Table"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
                  .run()
              }
            >
              <TableIcon />
            </Btn>
            <div className="prism-rich-rel">
              <Btn
                title="Image by URL"
                anchor
                active={showImage}
                onClick={() => {
                  const next = !showImage;
                  closePopovers();
                  setShowImage(next);
                }}
              >
                <ImagePlus />
              </Btn>
              {showImage && (
                <ImageUrlPopover
                  editor={editor}
                  onClose={() => setShowImage(false)}
                />
              )}
            </div>
            <Btn
              title="Divider"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            >
              <Minus />
            </Btn>
          </>
        ),
      },
      {
        id: 'align',
        node: (
          <div className="prism-rich-rel">
            <Btn
              title={`Align: ${activeAlign.label}`}
              anchor
              active={showAlign}
              onClick={() => {
                const next = !showAlign;
                closePopovers();
                setShowAlign(next);
              }}
            >
              <AlignIcon />
            </Btn>
            {showAlign && (
              <div data-rte-pop className="prism-rich-menu prism-rich-alignmenu">
                {ALIGNMENTS.map(({ label, value, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    className={cx(
                      'prism-rich-menu-item',
                      'prism-rich-callout-item',
                      editor.isActive({ textAlign: value }) && 'is-active',
                    )}
                    onClick={() => {
                      setShowAlign(false);
                      editor.chain().focus().setTextAlign(value).run();
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'indent',
        node: (
          <>
            <Btn
              title="Indent list item (Tab)"
              disabled={!inListItem}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .sinkListItem(
                    editor.isActive('taskItem') ? 'taskItem' : 'listItem',
                  )
                  .run()
              }
            >
              <Indent />
            </Btn>
            <Btn
              title="Outdent list item (Shift+Tab)"
              disabled={!inListItem}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .liftListItem(
                    editor.isActive('taskItem') ? 'taskItem' : 'listItem',
                  )
                  .run()
              }
            >
              <Outdent />
            </Btn>
          </>
        ),
      },
      {
        id: 'script',
        node: (
          <>
            <Btn
              title="Subscript"
              active={editor.isActive('subscript')}
              pressed={editor.isActive('subscript')}
              onClick={() => editor.chain().focus().toggleSubscript().run()}
            >
              <SubscriptIcon />
            </Btn>
            <Btn
              title="Superscript"
              active={editor.isActive('superscript')}
              pressed={editor.isActive('superscript')}
              onClick={() => editor.chain().focus().toggleSuperscript().run()}
            >
              <SuperscriptIcon />
            </Btn>
            <Btn
              title="Clear formatting"
              onClick={() =>
                // Marks and block type both — "make this plain again" is what the
                // user means, and unsetAllMarks alone leaves a heading a heading.
                editor.chain().focus().unsetAllMarks().clearNodes().run()
              }
            >
              <RemoveFormatting />
            </Btn>
          </>
        ),
      },
      {
        id: 'attach',
        node: (
          <>
            {onUpload && (
              <>
                <Btn
                  title="Attach file"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip />
                </Btn>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files)
                      void uploadAll(Array.from(e.target.files));
                    e.target.value = '';
                  }}
                />
              </>
            )}
            <div className="prism-rich-rel">
              <Btn
                title="Emoji"
                anchor
                onClick={() => {
                  const next = !showEmoji;
                  closePopovers();
                  setShowEmoji(next);
                }}
              >
                <Smile />
              </Btn>
              {showEmoji && (
                <div data-rte-pop className="prism-rich-emojipop">
                  {EMOJI_CATEGORIES.map((cat) => (
                    <div key={cat.name} className="prism-rich-emoji-cat">
                      <div className="prism-rich-emoji-cat-label">
                        {cat.name}
                      </div>
                      <div className="prism-rich-emoji-grid">
                        {cat.emojis.map((emo, i) => (
                          <button
                            key={cat.name + i}
                            type="button"
                            className="prism-rich-emoji"
                            onClick={() => {
                              editor.chain().focus().insertContent(emo).run();
                            }}
                          >
                            {emo}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ),
      },
    ];
  }
}
