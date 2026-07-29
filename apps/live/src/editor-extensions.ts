import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import type { Extensions } from '@tiptap/core';

/**
 * ADR 0001 §5: the canonical Tiptap extension list is OWNED by
 * `packages/editor/src/extensions.ts`. It cannot be imported here directly —
 * this is a CommonJS/tsx server and @prism/editor's ESM-only Tiptap deps force
 * `moduleResolution: node16` to consume its `/server` subpath, which breaks the
 * rest of the live server's CJS imports. So this is a DELIBERATE byte-for-byte
 * copy.
 *
 * INVARIANT: this array MUST stay identical to
 * `packages/editor/src/extensions.ts` (StarterKit minus history + Mention +
 * the ADR 0009 §3 set: TaskList/TaskItem, Table/TableRow/TableHeader/TableCell,
 * Image, Link + the rich formatting set: Underline, Highlight(multicolor),
 * TextStyle, Color, TextAlign(heading/paragraph), Subscript, Superscript).
 * Any node/mark added client-side WITHOUT mirroring it here will be silently
 * dropped from server snapshots (ADR "Consequences").
 *
 * Notes for HTML rendering:
 * - `history` is disabled to match the collaborative client (Collaboration
 *   provides its own undo/redo). It has no effect on serialized HTML.
 * - The Collaboration extension itself is intentionally excluded here: it adds
 *   no nodes/marks to the schema and is a client-only binding concern.
 */
/**
 * ------------------------------------------------------------------------
 * Why TextAlign and Color are extended instead of used as-is
 * ------------------------------------------------------------------------
 * `prosemirror-model`'s `renderSpec` applies a `style` attribute by assigning
 * `dom.style.cssText` rather than calling `setAttribute('style', …)`. The
 * server-side DOM shim behind `@tiptap/html` (zeed-dom) exposes a `.style`
 * object that accepts the assignment and then throws it away — so EVERY inline
 * `style` attribute silently vanishes from the snapshots generated HERE, while
 * looking perfect in the browser.
 *
 * Both extensions below therefore emit a `data-*` twin next to the style:
 * the browser honours the style, the snapshot keeps the data attribute, and
 * `collab.css` styles both spellings. Highlight already ships this way
 * (`data-color`), which is why it needs no override.
 *
 * If you add another style-emitting extension, give it the same treatment or
 * its formatting will not survive `generateWikiHTML`.
 */
const DurableTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element) =>
              element.getAttribute('data-text-align') ||
              element.style?.textAlign ||
              this.options.defaultAlignment,
            renderHTML: (attributes) => {
              const align = attributes.textAlign;
              if (!align || align === this.options.defaultAlignment) return {};
              return {
                style: `text-align: ${align}`,
                'data-text-align': align,
              };
            },
          },
        },
      },
    ];
  },
});

const DurableColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-color') ||
              element.style?.color?.replace(/['"]+/g, '') ||
              null,
            renderHTML: (attributes) =>
              attributes.color
                ? {
                    style: `color: ${attributes.color}`,
                    'data-color': attributes.color,
                  }
                : {},
          },
        },
      },
    ];
  },
});

export const editorExtensions: Extensions = [
  StarterKit.configure({ history: false }),
  Mention,
  TaskList,
  TaskItem,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  Image,
  Link.configure({ openOnClick: false }),

  // --- Rich formatting set (full-option toolbar) ---
  // Mirrors packages/editor/src/extensions.ts exactly. Drop one and that
  // formatting vanishes from every snapshot written back to the API.
  Underline,
  Highlight.configure({ multicolor: true }),
  TextStyle,
  DurableColor,
  DurableTextAlign.configure({ types: ['heading', 'paragraph'] }),
  Subscript,
  Superscript,
];

/**
 * Render ProseMirror JSON (converted from the Yjs XML fragment) to HTML using
 * the canonical extension set. Pure, no React — safe on the server (@tiptap/html
 * uses zeed-dom, so no jsdom is required).
 */
export function generateWikiHTML(json: Record<string, unknown>): string {
  return generateHTML(json, editorExtensions);
}
