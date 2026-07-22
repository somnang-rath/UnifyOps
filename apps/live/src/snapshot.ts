import type { onStoreDocumentPayload } from '@hocuspocus/server';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import type { Env } from './env';
import { parseDocumentName } from './auth';
// NOTE (ADR 0001 §5): the canonical Tiptap schema is OWNED by @prism/editor, but
// the live server is a CommonJS/tsx app and the shared package's `/server` subpath
// can't be imported here without switching module resolution to node16 — which
// breaks against the ESM-only Tiptap/Hocuspocus deps. So this keeps a byte-for-byte
// copy in ./editor-extensions.ts. INVARIANT: it MUST stay identical to
// packages/editor/src/extensions.ts or client/server HTML will diverge.
import { generateWikiHTML } from './editor-extensions';
import { putDocContent } from './api-client';

/**
 * Snapshot-back hook (ADR 0001 §4; dispatch by doc kind per ADR 0009 §4). Runs
 * on `onStoreDocument`, which the server debounces (see server config: debounce
 * ~2s, maxDebounce ~10s), so this fires after editing quiescence — not per
 * keystroke.
 *
 * Yjs XML fragment ("default") → ProseMirror JSON → HTML → PUT to the API
 * (`/internal/wiki/:id/content` or `/internal/notes/:id/content`).
 * Failures are logged, not thrown: a snapshot error must not tear down the live
 * document or drop the Mongo persistence handled by the Database extension.
 */
export function makeOnStoreDocument(env: Env) {
  return async (data: onStoreDocumentPayload): Promise<void> => {
    const { documentName, document, context } = data;

    const parsed = parseDocumentName(documentName);
    if (!parsed) return; // unknown docs are rejected at auth, but guard anyway.

    try {
      // Tiptap's default shared fragment name is "default".
      const fragment = document.getXmlFragment('default');
      const pmJson = yXmlFragmentToProsemirrorJSON(fragment) as Record<
        string,
        unknown
      >;
      const html = generateWikiHTML(pmJson);

      const editedBy =
        context && typeof context.userId === 'string'
          ? context.userId
          : undefined;

      await putDocContent(env, parsed.kind, parsed.id, html, editedBy);
    } catch (err) {
      console.error(
        `[live] snapshot-back failed for ${documentName}:`,
        err instanceof Error ? err.message : err,
      );
    }
  };
}
