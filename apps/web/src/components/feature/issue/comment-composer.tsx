'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  ChevronDown,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Smile,
  Strikethrough,
  Table as TableIcon,
  ArrowDownUp,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';
const ATTACH_MAX_BYTES = 25 * 1024 * 1024; // matches API MAX_UPLOAD

export interface MentionUser {
  name: string;
  email: string;
}

interface Props {
  authorName: string;
  authorAvatar?: string | null;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  placeholder?: string;
  users?: MentionUser[];
}

interface MentionState {
  start: number;
  q: string;
}

function findMentionAtCaret(text: string, caret: number): MentionState | null {
  if (caret === 0) return null;
  let i = caret - 1;
  while (i >= 0) {
    const c = text[i];
    if (c === '@') {
      const before = i === 0 ? '' : text[i - 1];
      if (before === '' || /\W/.test(before)) {
        return { start: i, q: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (!/[a-zA-Z0-9._-]/.test(c)) return null;
    i--;
  }
  return null;
}

const HEADINGS: { label: string; token: string }[] = [
  { label: 'Normal text', token: '' },
  { label: 'Heading 1', token: '# ' },
  { label: 'Heading 2', token: '## ' },
  { label: 'Heading 3', token: '### ' },
];

const EMOJIS = [
  '😀', '😄', '😅', '😂', '🙂', '😉', '😍', '🤔',
  '👍', '👎', '🙌', '👏', '🔥', '🎉', '✅', '❌',
];

export function CommentComposer({
  authorName,
  authorAvatar,
  value,
  onChange,
  onSubmit,
  submitting,
  placeholder = 'Write a comment or drag your files here...',
  users = [],
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'rich' | 'plain'>('rich');
  const [headingLabel, setHeadingLabel] = useState('Normal text');
  const [showHeadings, setShowHeadings] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkText, setLinkText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [mentionSel, setMentionSel] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filteredMentions = (() => {
    if (!mention) return [] as MentionUser[];
    const q = mention.q.toLowerCase();
    const score = (u: MentionUser): number => {
      const name = u.name.toLowerCase();
      const local = u.email.split('@')[0].toLowerCase();
      if (q === '') return 1;
      if (local.startsWith(q)) return 4;
      if (name.startsWith(q)) return 3;
      if (local.includes(q) || name.includes(q)) return 2;
      return 0;
    };
    return users
      .map((u) => ({ u, s: score(u) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.u.name.localeCompare(b.u.name))
      .slice(0, 6)
      .map((x) => x.u);
  })();

  const updateMention = (text: string, caret: number) => {
    const m = findMentionAtCaret(text, caret);
    setMention(m);
    setMentionSel(0);
  };

  const insertMention = (u: MentionUser) => {
    if (!mention) return;
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const local = u.email.split('@')[0];
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const ins = `@${local} `;
    onChange(before + ins + after);
    const newCaret = mention.start + ins.length;
    setMention(null);
    setMentionSel(0);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  };

  // Outside-click closes popovers
  useEffect(() => {
    if (!showHeadings && !showEmoji && !showLink) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-cc-pop]') || t.closest('[data-cc-anchor]')) return;
      setShowHeadings(false);
      setShowEmoji(false);
      setShowLink(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowHeadings(false);
        setShowEmoji(false);
        setShowLink(false);
      }
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [showHeadings, showEmoji, showLink]);

  const focusTA = () => {
    requestAnimationFrame(() => taRef.current?.focus());
  };

  // ----- text mutation helpers (cursor-aware) -----
  const withSelection = (
    mutate: (sel: { s: number; e: number; text: string }) => {
      next: string;
      selStart: number;
      selEnd: number;
    },
  ) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const { next, selStart, selEnd } = mutate({ s, e, text: value });
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const wrap = (prefix: string, suffix = prefix, placeholderText = 'text') =>
    withSelection(({ s, e, text }) => {
      const inner = text.slice(s, e) || placeholderText;
      const next = text.slice(0, s) + prefix + inner + suffix + text.slice(e);
      return {
        next,
        selStart: s + prefix.length,
        selEnd: s + prefix.length + inner.length,
      };
    });

  const insertAtCursor = (snippet: string) =>
    withSelection(({ s, e, text }) => {
      const next = text.slice(0, s) + snippet + text.slice(e);
      const caret = s + snippet.length;
      return { next, selStart: caret, selEnd: caret };
    });

  const prefixLines = (token: string) =>
    withSelection(({ s, e, text }) => {
      const lineStart = text.lastIndexOf('\n', s - 1) + 1;
      const lineEnd = text.indexOf('\n', e);
      const endIdx = lineEnd === -1 ? text.length : lineEnd;
      const block = text.slice(lineStart, endIdx);
      const replaced = block
        .split('\n')
        .map((l) => (l.startsWith(token) ? l : token + l))
        .join('\n');
      const next = text.slice(0, lineStart) + replaced + text.slice(endIdx);
      const delta = replaced.length - block.length;
      return {
        next,
        selStart: s + token.length,
        selEnd: e + delta,
      };
    });

  const applyHeading = (h: (typeof HEADINGS)[number]) => {
    setHeadingLabel(h.label);
    setShowHeadings(false);
    if (h.token) prefixLines(h.token);
    else focusTA();
  };

  const openLinkPopover = () => {
    const ta = taRef.current;
    const sel = ta ? value.slice(ta.selectionStart, ta.selectionEnd) : '';
    setLinkText(sel);
    setLinkUrl('https://');
    setShowHeadings(false);
    setShowEmoji(false);
    setShowLink((v) => !v);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url || url === 'https://') {
      setShowLink(false);
      focusTA();
      return;
    }
    withSelection(({ s, e, text }) => {
      const label = (linkText || text.slice(s, e) || 'link').trim();
      const snippet = `[${label}](${url})`;
      const next = text.slice(0, s) + snippet + text.slice(e);
      const caret = s + snippet.length;
      return { next, selStart: caret, selEnd: caret };
    });
    setShowLink(false);
  };

  const insertTable = () => {
    const snippet =
      '\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n';
    insertAtCursor(snippet);
  };

  const insertCode = () => {
    const ta = taRef.current;
    if (!ta) return;
    const selected = value.slice(ta.selectionStart, ta.selectionEnd);
    if (selected.includes('\n')) wrap('\n```\n', '\n```\n', 'code');
    else wrap('`', '`', 'code');
  };

  // ----- attachments (uploaded to API as public files) -----
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      if (file.size > ATTACH_MAX_BYTES) {
        toast(
          `"${file.name}" is too large (max ${
            ATTACH_MAX_BYTES / 1024 / 1024
          }MB)`,
          'error',
        );
        continue;
      }
      try {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await api.post<{
          _id: string;
          name: string;
          mimeType: string;
        }>('/files/comment-upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const url = `${apiBase}/files/public/${data._id}`;
        const isImage = (data.mimeType ?? file.type).startsWith('image/');
        const snippet = isImage
          ? `\n![${data.name}](${url})\n`
          : `\n[${data.name}](${url})\n`;
        insertAtCursor(snippet);
      } catch {
        // api.ts already toasts on 4xx/5xx
      }
    }
  };

  const onAttachClick = () => fileInputRef.current?.click();

  const canSubmit = value.trim().length > 0 && !submitting;

  return (
    <div ref={wrapRef} className="flex gap-2.5 items-start">
      <Avatar name={authorName} src={authorAvatar} size="sm" />
      <div
        className={cn(
          'flex-1 min-w-0 border rounded-md bg-bg-card transition-colors',
          dragOver
            ? 'border-accent border-dashed bg-accent-50/30'
            : 'border-border focus-within:border-accent',
        )}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {mode === 'rich' && (
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-bg-subtle/40 flex-wrap">
            {/* Heading dropdown */}
            <div className="relative">
              <button
                type="button"
                data-cc-anchor
                className="cc-tb-btn cc-tb-text"
                onClick={() => {
                  setShowHeadings((v) => !v);
                  setShowEmoji(false);
                }}
              >
                {headingLabel}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showHeadings && (
                <div
                  data-cc-pop
                  className="absolute left-0 top-full mt-1 z-50 min-w-[140px] bg-bg-card border border-border rounded-md shadow-lg py-1"
                >
                  {HEADINGS.map((h) => (
                    <button
                      key={h.label}
                      type="button"
                      className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-bg-hover"
                      onClick={() => applyHeading(h)}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ToolSep />
            <ToolBtn title="Bold" onClick={() => wrap('**', '**', 'bold')}>
              <Bold />
            </ToolBtn>
            <ToolBtn title="Italic" onClick={() => wrap('*', '*', 'italic')}>
              <Italic />
            </ToolBtn>
            <ToolBtn
              title="Strikethrough"
              onClick={() => wrap('~~', '~~', 'strike')}
            >
              <Strikethrough />
            </ToolBtn>
            <ToolSep />
            <ToolBtn title="Bullet list" onClick={() => prefixLines('- ')}>
              <List />
            </ToolBtn>
            <ToolBtn
              title="Numbered list"
              onClick={() => prefixLines('1. ')}
            >
              <ListOrdered />
            </ToolBtn>
            <ToolBtn title="Code" onClick={insertCode}>
              <Code />
            </ToolBtn>
            <div className="relative">
              <ToolBtn title="Link" anchor onClick={openLinkPopover}>
                <LinkIcon />
              </ToolBtn>
              {showLink && (
                <div
                  data-cc-pop
                  className="absolute left-0 top-full mt-1 z-50 w-[260px] p-2 bg-bg-card border border-border rounded-md shadow-lg flex flex-col gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    type="text"
                    placeholder="Text"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    className="w-full px-2 py-1 text-[12.5px] bg-bg-input border border-border rounded outline-none focus:border-accent"
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
                    className="w-full px-2 py-1 text-[12.5px] bg-bg-input border border-border rounded outline-none focus:border-accent"
                  />
                  <div className="flex justify-end gap-1.5 mt-0.5">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowLink(false)}
                      type="button"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="xs"
                      onClick={applyLink}
                      type="button"
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <ToolBtn title="Quote" onClick={() => prefixLines('> ')}>
              <Quote />
            </ToolBtn>
            <ToolBtn title="Table" onClick={insertTable}>
              <TableIcon />
            </ToolBtn>
            <ToolSep />
            <ToolBtn title="Attach file" onClick={onAttachClick}>
              <Paperclip />
            </ToolBtn>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="relative">
              <ToolBtn
                title="Emoji"
                anchor
                onClick={() => {
                  setShowEmoji((v) => !v);
                  setShowHeadings(false);
                }}
              >
                <Smile />
              </ToolBtn>
              {showEmoji && (
                <div
                  data-cc-pop
                  className="absolute right-0 top-full mt-1 z-50 grid grid-cols-8 gap-0.5 p-1.5 bg-bg-card border border-border rounded-md shadow-lg"
                >
                  {EMOJIS.map((emo) => (
                    <button
                      key={emo}
                      type="button"
                      className="w-7 h-7 flex items-center justify-center text-[16px] rounded hover:bg-bg-hover"
                      onClick={() => {
                        insertAtCursor(emo);
                        setShowEmoji(false);
                      }}
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="relative">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              updateMention(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
            }}
            onSelect={(e) => {
              const ta = e.currentTarget;
              updateMention(ta.value, ta.selectionStart);
            }}
            onBlur={() => {
              setTimeout(() => setMention(null), 120);
            }}
            placeholder={placeholder}
            rows={4}
            className="w-full resize-y px-3.5 py-2.5 text-[13.5px] leading-[1.55] bg-transparent text-text placeholder:text-text-muted outline-none font-mono"
            onKeyDown={(e) => {
              if (mention && filteredMentions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionSel((s) =>
                    Math.min(s + 1, filteredMentions.length - 1),
                  );
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionSel((s) => Math.max(s - 1, 0));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  insertMention(filteredMentions[mentionSel]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (
                e.key === 'Enter' &&
                (e.metaKey || e.ctrlKey) &&
                canSubmit
              ) {
                e.preventDefault();
                onSubmit();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length === 0) return;
              e.preventDefault();
              handleFiles(files);
            }}
          />
          {mention && filteredMentions.length > 0 && (
            <div
              data-cc-pop
              className="absolute left-2 right-2 top-full mt-1 z-50 bg-bg-card border border-border rounded-md shadow-lg max-h-[240px] overflow-y-auto py-1"
            >
              {filteredMentions.map((u, idx) => {
                const local = u.email.split('@')[0];
                const selected = idx === mentionSel;
                return (
                  <button
                    key={u.email}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setMentionSel(idx)}
                    onClick={() => insertMention(u)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors',
                      selected
                        ? 'bg-accent-50 dark:bg-[rgba(99,102,241,.12)]'
                        : 'hover:bg-bg-hover',
                    )}
                  >
                    <Avatar name={u.name} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-text truncate">
                        {u.name}
                      </span>
                      <span className="block text-[11px] text-text-muted truncate">
                        @{local}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-bg-subtle/40">
          <button
            type="button"
            className="text-[12px] text-text-muted hover:text-text underline-offset-2 hover:underline"
            onClick={() => setMode(mode === 'rich' ? 'plain' : 'rich')}
          >
            {mode === 'rich'
              ? 'Switch to plain text editing'
              : 'Switch to rich text editing'}
          </button>
          {mode === 'rich' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted bg-bg-card border border-border rounded px-1.5 py-0.5">
              <ArrowDownUp className="w-3 h-3" />
              Markdown
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Render action row as a sibling so it sits flush-right under the composer.
// We expose a second component the parent can render right under it,
// keeping layout flexibility while still being self-contained.
export function CommentComposerActions({
  onCancel,
  onSubmit,
  submitting,
  disabled,
}: {
  onCancel?: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 mt-2.5">
      {onCancel && (
        <Button variant="outline" size="md" onClick={onCancel} type="button">
          Cancel
        </Button>
      )}
      <Button
        variant="grad"
        size="md"
        type="button"
        onClick={onSubmit}
        disabled={disabled || submitting}
      >
        Comment
      </Button>
    </div>
  );
}

/* ---------- toolbar primitives ---------- */
function ToolBtn({
  title,
  onClick,
  children,
  anchor,
}: React.PropsWithChildren<{
  title: string;
  onClick: () => void;
  anchor?: boolean;
}>) {
  return (
    <button
      type="button"
      title={title}
      data-cc-anchor={anchor ? '' : undefined}
      onClick={onClick}
      className={cn(
        'cc-tb-btn w-7 h-7 inline-flex items-center justify-center rounded',
        'text-text-sub hover:text-text hover:bg-bg-hover',
        '[&_svg]:w-[15px] [&_svg]:h-[15px]',
      )}
    >
      {children}
    </button>
  );
}

function ToolSep() {
  return <span className="w-px h-4 bg-border mx-1" />;
}
