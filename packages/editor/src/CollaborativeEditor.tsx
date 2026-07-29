'use client';

import * as React from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import type * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { editorExtensions } from './extensions';
import { useCollaborativeDoc } from './useCollaborativeDoc';
import { userColor } from './color';
import type {
  ConnectionStatus,
  PresenceUser,
  SaveState,
} from './types';
import './collab.css';

/** Context handed to `renderChrome` so the host app can render its own header. */
export interface EditorChromeContext {
  status: ConnectionStatus;
  saveState: SaveState;
  /** Remote peers currently in the document (self excluded). */
  presence: PresenceUser[];
  /** The Tiptap editor instance, or null before it is ready. */
  editor: Editor | null;
  /**
   * The live server never answered (see `CollaborativeDocState.unreachable`).
   * Hosts should show a real error + `reconnect` rather than a spinner.
   */
  unreachable: boolean;
  /**
   * The server answered but refused the connection (see
   * `CollaborativeDocState.rejected`) — an access/token fault, not a reachability
   * one. Hosts should say so and re-mint rather than blame the network.
   */
  rejected: boolean;
  /** Force a new connection attempt. */
  reconnect: () => void;
}

export interface CollaborativeEditorProps {
  /** Hocuspocus document name, e.g. `wiki:<24-hex>` (ADR 0001 §2). */
  documentName: string;
  /** WebSocket origin (process.env.NEXT_PUBLIC_LIVE_URL). */
  wsUrl: string;
  /** JWT the live server verifies in onAuthenticate. */
  token: string;
  /** The local user, used for the caret label + presence attribution. */
  currentUser: PresenceUser;
  /**
   * First-run seed (ADR 0001 §3): HTML from `wiki.content`. Loaded into the
   * shared doc exactly once, and only if the Yjs fragment is still empty after
   * the first server sync — so peers never duplicate it.
   */
  initialHTML?: string;
  editable?: boolean;
  placeholder?: string;
  autofocus?: boolean;
  className?: string;
  onReady?: (editor: Editor) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onSaveStateChange?: (state: SaveState) => void;
  onPresenceChange?: (users: PresenceUser[]) => void;
  /** Render the host's header/toolbar. Rendered above the editable surface. */
  renderChrome?: (ctx: EditorChromeContext) => React.ReactNode;
}

/**
 * Collaborative rich-text editor bound to a Yjs document over the live server
 * (ADR 0001 §5). Owns the provider lifecycle via `useCollaborativeDoc`; the host
 * app owns data fetching, routing, token minting, and the seed source.
 */
export function CollaborativeEditor(props: CollaborativeEditorProps): React.ReactElement {
  const {
    documentName,
    wsUrl,
    token,
    onStatusChange,
    onSaveStateChange,
  } = props;

  const { doc, provider, status, saveState, unreachable, rejected, reconnect } =
    useCollaborativeDoc({
      documentName,
      wsUrl,
      token,
    });

  // Surface status/save transitions to the host.
  const onStatusRef = React.useRef(onStatusChange);
  onStatusRef.current = onStatusChange;
  React.useEffect(() => {
    onStatusRef.current?.(status);
  }, [status]);

  const onSaveRef = React.useRef(onSaveStateChange);
  onSaveRef.current = onSaveStateChange;
  React.useEffect(() => {
    onSaveRef.current?.(saveState);
  }, [saveState]);

  if (!doc || !provider) {
    // Provider not ready yet — still give the host a chrome slot so its header
    // (indicators, presence) can render a connecting state.
    return (
      <div className={props.className}>
        {props.renderChrome?.({
          status,
          saveState,
          presence: [],
          editor: null,
          unreachable,
          rejected,
          reconnect,
        })}
        <div className="prism-editor-scroll" aria-busy="true" />
      </div>
    );
  }

  // Remount on document switch so the editor + seed guard reset cleanly.
  return (
    <CollabSurface
      key={documentName}
      doc={doc}
      provider={provider}
      status={status}
      saveState={saveState}
      unreachable={unreachable}
      rejected={rejected}
      reconnect={reconnect}
      {...props}
    />
  );
}

interface SurfaceProps extends CollaborativeEditorProps {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  status: ConnectionStatus;
  saveState: SaveState;
  unreachable: boolean;
  rejected: boolean;
  reconnect: () => void;
}

function CollabSurface(props: SurfaceProps): React.ReactElement {
  const {
    doc,
    provider,
    status,
    saveState,
    unreachable,
    rejected,
    reconnect,
    currentUser,
    initialHTML,
    editable = true,
    placeholder = 'Start writing…',
    autofocus = false,
    className,
    onReady,
    onPresenceChange,
    renderChrome,
  } = props;

  const editor = useEditor(
    {
      editable,
      autofocus,
      immediatelyRender: false, // SSR-safe (Next App Router).
      extensions: [
        ...editorExtensions,
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({
          provider,
          user: {
            id: currentUser.id,
            name: currentUser.name,
            color: currentUser.color || userColor(currentUser.id),
            avatar: currentUser.avatar ?? null,
          },
        }),
        Placeholder.configure({ placeholder }),
      ],
    },
    [doc, provider],
  );

  // onReady
  const onReadyRef = React.useRef(onReady);
  onReadyRef.current = onReady;
  React.useEffect(() => {
    if (editor) onReadyRef.current?.(editor);
  }, [editor]);

  // Keep editable in sync when the prop changes after mount.
  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // First-run seeding (ADR 0001 §3): only after the first server sync, and only
  // if the shared fragment is still empty — otherwise a peer already seeded it.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (!editor || !initialHTML || seededRef.current) return;

    const trySeed = () => {
      if (seededRef.current) return;
      const fragment = doc.getXmlFragment('default');
      if (fragment.length === 0) {
        seededRef.current = true;
        // Writes a ProseMirror transaction → propagates into Yjs for all peers.
        editor.commands.setContent(initialHTML);
      }
    };

    if (provider.isSynced) {
      trySeed();
      return;
    }
    const onSynced = () => trySeed();
    provider.on('synced', onSynced);
    return () => {
      provider.off('synced', onSynced);
    };
  }, [editor, provider, doc, initialHTML]);

  // Presence from awareness (self excluded, deduped by user id).
  const [presence, setPresence] = React.useState<PresenceUser[]>([]);
  const onPresenceRef = React.useRef(onPresenceChange);
  onPresenceRef.current = onPresenceChange;

  React.useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;

    const update = () => {
      const selfId = awareness.clientID;
      const byId = new Map<string, PresenceUser>();
      awareness.getStates().forEach((raw, clientId) => {
        if (clientId === selfId) return;
        const u = (raw as { user?: Partial<PresenceUser> }).user;
        if (!u || !u.id || !u.name) return;
        if (!byId.has(u.id)) {
          byId.set(u.id, {
            id: u.id,
            name: u.name,
            color: u.color || userColor(u.id),
            avatar: u.avatar ?? null,
          });
        }
      });
      const list = [...byId.values()];
      setPresence(list);
      onPresenceRef.current?.(list);
    };

    awareness.on('change', update);
    update();
    return () => {
      awareness.off('change', update);
    };
  }, [provider]);

  return (
    <div className={className}>
      {renderChrome?.({
        status,
        saveState,
        presence,
        editor,
        unreachable,
        rejected,
        reconnect,
      })}
      <div className="prism-editor-scroll">
        <EditorContent editor={editor} className="prism-editor" />
      </div>
    </div>
  );
}
