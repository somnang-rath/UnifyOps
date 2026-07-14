import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
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
 * `packages/editor/src/extensions.ts` (StarterKit minus history + Mention).
 * Any node/mark added client-side WITHOUT mirroring it here will be silently
 * dropped from server snapshots (ADR "Consequences").
 *
 * Notes for HTML rendering:
 * - `history` is disabled to match the collaborative client (Collaboration
 *   provides its own undo/redo). It has no effect on serialized HTML.
 * - The Collaboration extension itself is intentionally excluded here: it adds
 *   no nodes/marks to the schema and is a client-only binding concern.
 */
export const editorExtensions: Extensions = [
  StarterKit.configure({ history: false }),
  Mention,
];

/**
 * Render ProseMirror JSON (converted from the Yjs XML fragment) to HTML using
 * the canonical extension set. Pure, no React — safe on the server (@tiptap/html
 * uses zeed-dom, so no jsdom is required).
 */
export function generateWikiHTML(json: Record<string, unknown>): string {
  return generateHTML(json, editorExtensions);
}
