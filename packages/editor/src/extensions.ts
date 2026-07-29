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
 * The single canonical DOCUMENT-SCHEMA Tiptap extension array (ADR 0001 §4/§5;
 * task/table/image/link additions per ADR 0009 §3).
 *
 * This set is shared by BOTH the collaborative client render (see
 * ./CollaborativeEditor) AND the live server's snapshot renderer
 * (`generateHTML(pmJSON, editorExtensions)`), so Yjs → HTML never diverges.
 *
 * IMPORTANT — what belongs here and what does not:
 * - Include only extensions that contribute NODES/MARKS to the serialized HTML:
 *   `StarterKit` (with `history: false` — Yjs owns undo/redo), `Mention`, the
 *   ADR 0009 set (TaskList/TaskItem, Table*, Image, Link), and the rich
 *   formatting set below (Underline/Highlight/TextStyle+Color/TextAlign/
 *   Sub/Superscript).
 * - Do NOT include Collaboration / CollaborationCursor / Placeholder here. Those
 *   are runtime-only client concerns (a Yjs binding, remote carets, an empty
 *   hint) that add no nodes/marks and would be meaningless — or crash — inside a
 *   pure server `generateHTML`. The client layers them on top of this array.
 *
 * `history: false` has no effect on serialized HTML, but keeping it here documents
 * the invariant and keeps the array a faithful description of the client schema.
 */
/**
 * ------------------------------------------------------------------------
 * Why TextAlign and Color are extended instead of used as-is
 * ------------------------------------------------------------------------
 * `prosemirror-model`'s `renderSpec` applies a `style` attribute by assigning
 * `dom.style.cssText` rather than calling `setAttribute('style', …)`. The
 * server-side DOM shim behind `@tiptap/html` (zeed-dom) exposes a `.style`
 * object that accepts the assignment and then throws it away — so EVERY inline
 * `style` attribute silently vanishes from server-rendered snapshots, while
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
  // Every entry here contributes a mark or a node attribute to the serialized
  // HTML, so each MUST be mirrored in apps/live/src/editor-extensions.ts.
  Underline,
  // `multicolor` keeps the chosen swatch as a `data-color` attribute, which is
  // what survives the Yjs → HTML snapshot round-trip (see the note above).
  Highlight.configure({ multicolor: true }),
  // TextStyle is the carrier mark Color writes its color onto — Color alone
  // renders nothing.
  TextStyle,
  DurableColor,
  // Alignment is an ATTRIBUTE on existing nodes, not a new node. Older docs
  // simply have no `textAlign` and fall back to the default.
  DurableTextAlign.configure({ types: ['heading', 'paragraph'] }),
  Subscript,
  Superscript,
];

/**
 * Render ProseMirror JSON (converted from the Yjs XML fragment) to HTML using
 * the canonical extension set. Pure, no React — safe on the server
 * (`@tiptap/html` uses zeed-dom, so no jsdom is required).
 *
 * The live server's snapshot hook calls this so `wiki.content` stays byte-for-byte
 * consistent with what the client editor would produce.
 */
export function generateWikiHTML(json: Record<string, unknown>): string {
  return generateHTML(json, editorExtensions);
}
