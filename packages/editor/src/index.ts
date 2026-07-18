/**
 * @prism/editor — shared Tiptap + Yjs collaborative editor (ADR 0001 §5).
 *
 * The client editor and the live server's snapshot renderer both build on the
 * SAME `editorExtensions`, so Yjs → HTML serialization never diverges.
 *
 * Server-only consumers (the live snapshot hook) should import the pure schema
 * from the `@prism/editor/server` subpath to avoid pulling React into Node:
 *
 *     import { editorExtensions, generateWikiHTML } from '@prism/editor/server';
 */

// Pure, framework-free schema (also re-exported via ./server for Node).
export { editorExtensions, generateWikiHTML } from './extensions';

// Standalone WYSIWYG markdown editor (non-collaborative) — used by comment /
// description composers across the web app.
export { RichTextEditor } from './RichTextEditor';
export type {
  RichTextEditorProps,
  UploadedAttachment,
  MentionUser,
} from './RichTextEditor';

// React client surface.
export { CollaborativeEditor } from './CollaborativeEditor';
export type {
  CollaborativeEditorProps,
  EditorChromeContext,
} from './CollaborativeEditor';
export { useCollaborativeDoc } from './useCollaborativeDoc';
export type {
  UseCollaborativeDocOptions,
  CollaborativeDocState,
} from './useCollaborativeDoc';

// Scoped, short-lived token for the live socket (docs/plan/01 §2).
export { useCollabToken } from './useCollabToken';
export type {
  UseCollabTokenOptions,
  CollabTokenState,
  CollabTokenResponse,
} from './useCollabToken';

// Presence + helpers.
export { userColor } from './color';
export type {
  PresenceUser,
  ConnectionStatus,
  SaveState,
  CollaborationConfig,
} from './types';
