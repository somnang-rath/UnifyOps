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
 *   `StarterKit` (with `history: false` — Yjs owns undo/redo), `Mention`, and
 *   the ADR 0009 set (TaskList/TaskItem, Table*, Image, Link).
 * - Do NOT include Collaboration / CollaborationCursor / Placeholder here. Those
 *   are runtime-only client concerns (a Yjs binding, remote carets, an empty
 *   hint) that add no nodes/marks and would be meaningless — or crash — inside a
 *   pure server `generateHTML`. The client layers them on top of this array.
 *
 * `history: false` has no effect on serialized HTML, but keeping it here documents
 * the invariant and keeps the array a faithful description of the client schema.
 */
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
