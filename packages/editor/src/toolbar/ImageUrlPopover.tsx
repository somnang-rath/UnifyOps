'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';

const URL_RE = /^https?:\/\/\S+/i;

/**
 * "Image by URL" popover — the no-upload path for hotlinked images
 * (spec §2.1). Single URL input + optional alt text; Apply is disabled until
 * the URL looks like `http(s)://…`.
 */
export function ImageUrlPopover({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [url, setUrl] = React.useState('https://');
  const [alt, setAlt] = React.useState('');

  const trimmed = url.trim();
  const valid = trimmed !== 'https://' && URL_RE.test(trimmed);

  const apply = () => {
    if (!valid) return;
    editor
      .chain()
      .focus()
      .setImage({ src: trimmed, alt: alt.trim() || undefined })
      .run();
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
        type="url"
        placeholder="https://…/image.png"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
      />
      <input
        type="text"
        placeholder="Alt text (optional)"
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
      />
      <div className="prism-rich-linkpop-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!valid}
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
