'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Link popover shared by RichTextEditor and CollabToolbar.
 *
 * Rendered when open (the caller owns the show/hide state + anchor button);
 * initial text/URL are read from the current selection on mount, exactly like
 * the pre-extraction inline version.
 *
 * `markdown` — how an empty-selection insert is serialized:
 * - `true` (RichTextEditor): insert `[label](url)` and let tiptap-markdown's
 *   input rules turn it into a link.
 * - `false` (collab schema, no markdown extension): insert a text node carrying
 *   the `link` mark directly — a literal `[label](url)` would stay plain text.
 */
export function LinkPopover({
  editor,
  markdown = false,
  onClose,
}: {
  editor: Editor;
  markdown?: boolean;
  onClose: () => void;
}) {
  const [linkText, setLinkText] = React.useState(() => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ');
  });
  const [linkUrl, setLinkUrl] = React.useState(() => {
    const existing = editor.getAttributes('link').href as string | undefined;
    return existing || 'https://';
  });

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url || url === 'https://') {
      onClose();
      editor.chain().focus().run();
      return;
    }
    const { empty } = editor.state.selection;
    if (empty) {
      const label = (linkText || url).trim();
      if (markdown) {
        editor.chain().focus().insertContent(`[${label}](${url})`).run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: label,
            marks: [{ type: 'link', attrs: { href: url } }],
          })
          .run();
      }
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    onClose();
  };

  return (
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
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="is-primary" onClick={applyLink}>
          Apply
        </button>
      </div>
    </div>
  );
}
