'use client';

import * as React from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  Bold,
  ChevronDown,
  Code,
  Code2,
  Heading,
  Info,
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
  Trash2,
  X,
} from 'lucide-react';
import { createMention, type MentionUser } from './rich-mention';
import { EMOJI_CATEGORIES } from './rich-emojis';
import './rich-editor.css';

export type { MentionUser } from './rich-mention';

export interface UploadedAttachment {
  url: string;
  name: string;
  isImage: boolean;
}

export interface RichTextEditorProps {
  /** Markdown value (controlled). */
  value: string;
  /** Fires with the serialized markdown on every edit. */
  onChange: (markdown: string) => void;
  /** Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  placeholder?: string;
  /** Users offered by the `@` mention popup. */
  users?: MentionUser[];
  /**
   * Upload one file and return where it now lives. The editor inserts an image
   * (`![]()`) or a link (`[]()`) depending on `isImage`. Return `null` to skip.
   */
  onUpload?: (file: File) => Promise<UploadedAttachment | null>;
  autofocus?: boolean;
  className?: string;
  minHeight?: number;
  /**
   * `compact` (default) — the lean toolbar used by comment composers.
   * `full` — adds block tools for long-form docs (wiki): code block, divider,
   * and callout/box inserts. See {@link CALLOUTS}.
   */
  toolbar?: 'compact' | 'full';
}

const HEADINGS = [
  { label: 'Normal text', level: 0 as const },
  { label: 'Heading 1', level: 1 as const },
  { label: 'Heading 2', level: 2 as const },
  { label: 'Heading 3', level: 3 as const },
  { label: 'Heading 4', level: 4 as const },
];

/**
 * Callout ("box") types. Serialized as GitHub-style admonition blockquotes
 * (`> [!NOTE] …`) so they round-trip through markdown; the preview renderer
 * (`MarkdownView`) turns the marker into a colored box. `IMPORTANT` is the
 * "pin" 📌 highlight.
 */
const CALLOUTS = [
  { type: 'NOTE', label: 'Note', emoji: 'ℹ️' },
  { type: 'TIP', label: 'Tip', emoji: '💡' },
  { type: 'IMPORTANT', label: 'Important · pin', emoji: '📌' },
  { type: 'WARNING', label: 'Warning', emoji: '⚠️' },
  { type: 'CAUTION', label: 'Caution', emoji: '🛑' },
] as const;

export function RichTextEditor({
  value,
  onChange,
  onSubmit,
  placeholder = 'Write something…',
  users = [],
  onUpload,
  autofocus = false,
  className,
  minHeight = 120,
  toolbar = 'compact',
}: RichTextEditorProps): React.ReactElement {
  const full = toolbar === 'full';
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showHeadings, setShowHeadings] = React.useState(false);
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [showLink, setShowLink] = React.useState(false);
  const [showCallout, setShowCallout] = React.useState(false);
  const [linkText, setLinkText] = React.useState('');
  const [linkUrl, setLinkUrl] = React.useState('https://');
  const [dragOver, setDragOver] = React.useState(false);

  // Keep callbacks/roster fresh without re-creating the editor.
  const usersRef = React.useRef(users);
  usersRef.current = users;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = React.useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onUploadRef = React.useRef(onUpload);
  onUploadRef.current = onUpload;

  // Last markdown we emitted — lets us distinguish our own edits from external
  // value changes (e.g. the parent clearing after submit).
  const lastEmitted = React.useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: 'prism-code-block' } },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      createMention(() => usersRef.current),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editorProps: {
      attributes: { class: 'prism-rich-content' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0 || !onUploadRef.current) return false;
        event.preventDefault();
        void uploadAll(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
      lastEmitted.current = md;
      onChangeRef.current(md);
    },
  });

  // External value sync: only reset the doc when the incoming value diverges
  // from what we last emitted (prevents cursor-jumping feedback loops).
  React.useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, false);
  }, [editor, value]);

  const uploadAll = React.useCallback(
    async (files: File[]) => {
      if (!editor || !onUploadRef.current) return;
      for (const file of files) {
        const res = await onUploadRef.current(file);
        if (!res) continue;
        const snippet = res.isImage
          ? `![${res.name}](${res.url})`
          : `[${res.name}](${res.url})`;
        editor.chain().focus().insertContent(snippet).run();
      }
    },
    [editor],
  );

  // Close popovers on outside click / Escape.
  React.useEffect(() => {
    if (!showHeadings && !showEmoji && !showLink && !showCallout) return;
    const closeAll = () => {
      setShowHeadings(false);
      setShowEmoji(false);
      setShowLink(false);
      setShowCallout(false);
    };
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
  }, [showHeadings, showEmoji, showLink, showCallout]);

  if (!editor) {
    return (
      <div
        className={cx('prism-rich', className)}
        style={{ '--rte-min': `${minHeight}px` } as React.CSSProperties}
      >
        <div className="prism-rich-toolbar" aria-hidden />
        <div className="prism-rich-body" style={{ minHeight }} />
      </div>
    );
  }

  const activeHeading =
    HEADINGS.find((h) => h.level > 0 && editor.isActive('heading', { level: h.level }))
      ?.label ?? 'Normal text';

  const setHeading = (level: number) => {
    setShowHeadings(false);
    if (level === 0) editor.chain().focus().setParagraph().run();
    else
      editor
        .chain()
        .focus()
        .toggleHeading({ level: level as 1 | 2 | 3 | 4 })
        .run();
  };

  const openLink = () => {
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, ' ');
    setLinkText(selected);
    const existing = editor.getAttributes('link').href as string | undefined;
    setLinkUrl(existing || 'https://');
    setShowEmoji(false);
    setShowHeadings(false);
    setShowLink((v) => !v);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url || url === 'https://') {
      setShowLink(false);
      editor.chain().focus().run();
      return;
    }
    const { empty } = editor.state.selection;
    if (empty) {
      const label = (linkText || url).trim();
      editor.chain().focus().insertContent(`[${label}](${url})`).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setShowLink(false);
  };

  const insertTable = () =>
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
      .run();

  // Callouts ("box"/"pin") are GitHub-style admonition blockquotes so they stay
  // plain markdown; the caret lands after the marker so the user types the body.
  const insertCallout = (type: string) => {
    setShowCallout(false);
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `[!${type}] ` }],
          },
        ],
      })
      .run();
  };

  return (
    <div
      className={cx('prism-rich', dragOver && 'is-dragover', className)}
      style={{ '--rte-min': `${minHeight}px` } as React.CSSProperties}
      onDragOver={(e) => {
        if (!onUpload || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        if (!onUpload || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void uploadAll(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="prism-rich-toolbar">
        {/* Heading / size switch */}
        <div className="prism-rich-rel">
          <button
            type="button"
            data-rte-anchor
            className="prism-rich-text-btn"
            onClick={() => {
              setShowHeadings((v) => !v);
              setShowEmoji(false);
              setShowLink(false);
            }}
          >
            {activeHeading}
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
        <Btn
          title="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </Btn>
        <Btn
          title="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </Btn>
        <Btn
          title="Strikethrough"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </Btn>
        <Btn
          title="Inline code"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code />
        </Btn>

        <Sep />
        <Btn
          title="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </Btn>
        <Btn
          title="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </Btn>
        <Btn
          title="Task list"
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks />
        </Btn>
        <Btn
          title="Quote"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </Btn>
        {full && (
          <Btn
            title="Code block"
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 />
          </Btn>
        )}

        <Sep />
        <div className="prism-rich-rel">
          <Btn title="Link" anchor active={editor.isActive('link')} onClick={openLink}>
            <LinkIcon />
          </Btn>
          {showLink && (
            <div
              data-rte-pop
              className="prism-rich-linkpop"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                type="text"
                placeholder="Text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
              />
              <input
                type="url"
                placeholder="https://"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLink();
                  }
                }}
              />
              <div className="prism-rich-linkpop-actions">
                <button type="button" onClick={() => setShowLink(false)}>
                  Cancel
                </button>
                <button type="button" className="is-primary" onClick={applyLink}>
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
        <Btn title="Table" onClick={insertTable}>
          <TableIcon />
        </Btn>
        {full && (
          <>
            <Btn
              title="Divider"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            >
              <Minus />
            </Btn>
            <div className="prism-rich-rel">
              <Btn
                title="Callout / box"
                anchor
                active={showCallout}
                onClick={() => {
                  setShowCallout((v) => !v);
                  setShowHeadings(false);
                  setShowEmoji(false);
                  setShowLink(false);
                }}
              >
                <Info />
              </Btn>
              {showCallout && (
                <div data-rte-pop className="prism-rich-menu">
                  {CALLOUTS.map((c) => (
                    <button
                      key={c.type}
                      type="button"
                      className="prism-rich-menu-item prism-rich-callout-item"
                      onClick={() => insertCallout(c.type)}
                    >
                      <span aria-hidden>{c.emoji}</span>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

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
              setShowEmoji((v) => !v);
              setShowHeadings(false);
              setShowLink(false);
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

      {/* Contextual table controls — shown only while the caret is in a table. */}
      {editor.isActive('table') && (
        <div className="prism-rich-tablebar">
          <span className="prism-rich-tablebar-label">Table</span>
          <TCtl
            title="Insert column left"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
          >
            <ArrowLeftToLine />
            Col
          </TCtl>
          <TCtl
            title="Insert column right"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <ArrowRightToLine />
            Col
          </TCtl>
          <TCtl
            title="Delete column"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <X />
            Col
          </TCtl>
          <span className="prism-rich-sep" />
          <TCtl
            title="Insert row above"
            onClick={() => editor.chain().focus().addRowBefore().run()}
          >
            <ArrowUpToLine />
            Row
          </TCtl>
          <TCtl
            title="Insert row below"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <ArrowDownToLine />
            Row
          </TCtl>
          <TCtl
            title="Delete row"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <X />
            Row
          </TCtl>
          <span className="prism-rich-sep" />
          <TCtl
            title="Toggle header row"
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            <Heading />
            Header
          </TCtl>
          <TCtl
            title="Delete table"
            danger
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 />
            Delete
          </TCtl>
        </div>
      )}

      <div className="prism-rich-body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/* ---------- toolbar primitives ---------- */
function Btn({
  title,
  active,
  anchor,
  onClick,
  children,
}: React.PropsWithChildren<{
  title: string;
  active?: boolean;
  anchor?: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      title={title}
      data-rte-anchor={anchor ? '' : undefined}
      onClick={onClick}
      className={cx('prism-rich-btn', active && 'is-active')}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="prism-rich-sep" />;
}

function TCtl({
  title,
  onClick,
  danger,
  children,
}: React.PropsWithChildren<{
  title: string;
  onClick: () => void;
  danger?: boolean;
}>) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx('prism-rich-tctl', danger && 'is-danger')}
    >
      {children}
    </button>
  );
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type { Editor };
