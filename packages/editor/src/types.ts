/** Live-collaboration connection status, mapped 1:1 from the provider. */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Best-effort persistence indicator derived from the provider's sync state:
 * - `saving`  — local edits not yet acknowledged by the live server.
 * - `saved`   — connected and fully synced (server has every local update).
 * - `offline` — the socket is down; edits are buffered locally until reconnect.
 */
export type SaveState = 'saved' | 'saving' | 'offline';

/** A participant in a collaborative document (self or a remote peer). */
export interface PresenceUser {
  /** Stable user id (Mongo user _id). */
  id: string;
  /** Display name shown on the caret label and presence stack. */
  name: string;
  /** Deterministic caret/presence color (see `userColor`). */
  color: string;
  /** Optional avatar URL for the presence stack. */
  avatar?: string | null;
}

/**
 * Config for connecting a document to the live collaboration server.
 * Retained for typing (ADR 0001 §5). `collaborationEndpoint()` is removed —
 * the provider takes `url` + `name` directly.
 */
export interface CollaborationConfig {
  /** e.g. process.env.NEXT_PUBLIC_LIVE_URL → ws://localhost:3100 */
  wsUrl: string;
  /** The Hocuspocus document name, e.g. `wiki:<24-hex>` (ADR 0001 §2). */
  documentName: string;
  /** JWT the live server verifies in its onAuthenticate hook. */
  token: string;
}
