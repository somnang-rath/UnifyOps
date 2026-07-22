'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  ChevronDown,
  Code,
  Code2,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Smile,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';
import type { UploadedAttachment } from '../RichTextEditor';
import { EMOJI_CATEGORIES } from '../rich-emojis';
import { Btn, Sep, cx } from './primitives';
import { LinkPopover } from './LinkPopover';
import { ImageUrlPopover } from './ImageUrlPopover';
import { TableBar } from './TableBar';
// The toolbar reuses the `prism-rich-*` styles so it renders identically to the
// RichTextEditor toolbar even on pages that never mount an RTE.
import '../rich-editor.css';

/**
 * Formatting toolbar for the collaborative editor (spec §2.3). Presentational:
 * operates only on the passed Tiptap `Editor` — no fetching, no Yjs awareness.
 * Used by notes now; wiki inherits it when it moves to collab.
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
  /** Stick to the top of the editor scroll container (default true). */
  sticky?: boolean;
  className?: string;
}

/** Collab schema headings capped at H3 (note migration scale, spec §2.3). */
const HEADINGS = [
  { label: 'Normal text', level: 0 as const },
  { label: 'Heading 1', level: 1 as const },
  { label: 'Heading 2', level: 2 as const },
  { label: 'Heading 3', level: 3 as const },
];

export function CollabToolbar({
  editor,
  onUpload,
  sticky = true,
  className,
}: CollabToolbarProps): React.ReactElement {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showHeadings, setShowHeadings] = React.useState(false);
  const [showLink, setShowLink] = React.useState(false);
  const [showImage, setShowImage] = React.useState(false);
  const [showEmoji, setShowEmoji] = React.useState(false);

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

  const closeAll = React.useCallback(() => {
    setShowHeadings(false);
    setShowLink(false);
    setShowImage(false);
    setShowEmoji(false);
  }, []);

  // Outside click / Escape closes any open popover (same wiring as the RTE).
  const anyOpen = showHeadings || showLink || showImage || showEmoji;
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

  // Disabled skeleton (editor not ready) — fixed height so layout never jumps.
  if (!editor) {
    return (
      <div
        className={cx(
          'prism-collab-toolbar-wrap',
          sticky && 'is-sticky',
          className,
        )}
      >
        <div
          className="prism-rich-toolbar prism-collab-toolbar"
          aria-hidden
        />
      </div>
    );
  }

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
        .toggleHeading({ level: level as 1 | 2 | 3 })
        .run();
  };

  return (
    <div
      className={cx(
        'prism-collab-toolbar-wrap',
        sticky && 'is-sticky',
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        className="prism-rich-toolbar prism-collab-toolbar"
      >
        {/* 1 — heading dropdown */}
        <div className="prism-rich-rel">
          <button
            type="button"
            data-rte-anchor
            className="prism-rich-text-btn"
            onClick={() => {
              const next = !showHeadings;
              closeAll();
              setShowHeadings(next);
            }}
          >
            <span className="prism-collab-hlabel">{activeHeading}</span>
            <span className="prism-collab-hlabel-sm" aria-hidden>
              Aa
            </span>
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

        <Sep />
        {/* 2 — marks */}
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
          title="Strikethrough"
          active={editor.isActive('strike')}
          pressed={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </Btn>
        <Btn
          title="Inline code"
          active={editor.isActive('code')}
          pressed={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code />
        </Btn>

        <Sep />
        {/* 3 — blocks */}
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

        <Sep />
        {/* 4 — insert */}
        <div className="prism-rich-rel">
          <Btn
            title="Link"
            anchor
            active={editor.isActive('link')}
            onClick={() => {
              const next = !showLink;
              closeAll();
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
              closeAll();
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

        {/* 5 — attach + emoji */}
        {onUpload && (
          <>
            <Sep />
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
                if (e.target.files) void uploadAll(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
          </>
        )}
        <div className="prism-rich-rel prism-rich-emoji-anchor">
          <Btn
            title="Emoji"
            anchor
            onClick={() => {
              const next = !showEmoji;
              closeAll();
              setShowEmoji(next);
            }}
          >
            <Smile />
          </Btn>
          {showEmoji && (
            <div data-rte-pop className="prism-rich-emojipop">
              {EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.name} className="prism-rich-emoji-cat">
                  <div className="prism-rich-emoji-cat-label">{cat.name}</div>
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
      </div>

      {/* Contextual table controls (same strip as the RTE). */}
      <TableBar editor={editor} />
    </div>
  );
}
