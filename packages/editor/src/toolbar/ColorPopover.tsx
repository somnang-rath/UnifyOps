'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Swatch grid used by both the text-color and highlight buttons.
 *
 * `mode` picks which mark it drives:
 * - `text`      → TextStyle + Color (`setColor` / `unsetColor`)
 * - `highlight` → Highlight in multicolor mode (`toggleHighlight({ color })`)
 *
 * Colors are literal hex, not CSS variables: the value is serialized into the
 * document HTML and read back by the space app and the live server's snapshot
 * renderer, neither of which has the web app's theme variables in scope.
 */
export type ColorMode = 'text' | 'highlight';

/** Readable on both light and dark editor backgrounds. */
const TEXT_COLORS: Array<{ name: string; value: string }> = [
  { name: 'Default', value: '' },
  { name: 'Grey', value: '#6b7280' },
  { name: 'Brown', value: '#92400e' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Yellow', value: '#ca8a04' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Pink', value: '#db2777' },
];

/** Pale fills so dark text stays legible on top of them. */
const HIGHLIGHT_COLORS: Array<{ name: string; value: string }> = [
  { name: 'None', value: '' },
  { name: 'Grey', value: '#e5e7eb' },
  { name: 'Brown', value: '#e7d7c9' },
  { name: 'Red', value: '#fecaca' },
  { name: 'Orange', value: '#fed7aa' },
  { name: 'Yellow', value: '#fef08a' },
  { name: 'Green', value: '#bbf7d0' },
  { name: 'Blue', value: '#bfdbfe' },
  { name: 'Purple', value: '#ddd6fe' },
  { name: 'Pink', value: '#fbcfe8' },
];

export interface ColorPopoverProps {
  editor: Editor;
  mode: ColorMode;
  onClose: () => void;
}

export function ColorPopover({
  editor,
  mode,
  onClose,
}: ColorPopoverProps): React.ReactElement {
  const colors = mode === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS;

  const apply = (value: string) => {
    const chain = editor.chain().focus();
    if (mode === 'text') {
      if (value) chain.setColor(value).run();
      else chain.unsetColor().run();
    } else {
      if (value) chain.setHighlight({ color: value }).run();
      else chain.unsetHighlight().run();
    }
    onClose();
  };

  const isActive = (value: string): boolean => {
    if (!value) return false;
    return mode === 'text'
      ? editor.isActive('textStyle', { color: value })
      : editor.isActive('highlight', { color: value });
  };

  return (
    <div data-rte-pop className="prism-rich-colorpop">
      <div className="prism-rich-color-label">
        {mode === 'text' ? 'Text color' : 'Highlight'}
      </div>
      <div className="prism-rich-color-grid">
        {colors.map((c) => (
          <button
            key={c.name}
            type="button"
            title={c.name}
            aria-label={c.name}
            aria-pressed={isActive(c.value)}
            onClick={() => apply(c.value)}
            className={
              'prism-rich-swatch' + (isActive(c.value) ? ' is-active' : '')
            }
          >
            {c.value ? (
              <span
                className="prism-rich-swatch-dot"
                style={
                  mode === 'text'
                    ? { color: c.value, background: 'transparent' }
                    : { background: c.value }
                }
              >
                A
              </span>
            ) : (
              // The "remove formatting" cell — a slashed empty chip.
              <span className="prism-rich-swatch-dot is-none" aria-hidden>
                A
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
