import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type { TypingEvent } from '@/schemas/chat';

/**
 * Ephemeral chat UI state only. Server data (channels, messages) stays in
 * TanStack Query; this holds the socket handle, per-channel typing indicators,
 * and composer drafts — none of which belong in the query cache.
 */
interface TypingUser {
  userId: string;
  name: string;
  at: number;
}

interface ChatState {
  socket: Socket | null;
  connected: boolean;
  /** channelId → userId → typing entry (with a timestamp to expire it). */
  typing: Record<string, Record<string, TypingUser>>;
  drafts: Record<string, string>;

  setSocket: (s: Socket | null) => void;
  setConnected: (c: boolean) => void;
  setTyping: (e: TypingEvent) => void;
  typingIn: (channelId: string) => TypingUser[];
  setDraft: (channelId: string, text: string) => void;
}

/** Typing entries older than this are treated as stale and filtered out. */
const TYPING_TTL_MS = 5000;

export const useChatStore = create<ChatState>((set, get) => ({
  socket: null,
  connected: false,
  typing: {},
  drafts: {},

  setSocket: (socket) => set({ socket }),
  setConnected: (connected) => set({ connected }),

  setTyping: (e) =>
    set((state) => ({
      typing: {
        ...state.typing,
        [e.channelId]: {
          ...(state.typing[e.channelId] ?? {}),
          [e.userId]: { userId: e.userId, name: e.name, at: Date.now() },
        },
      },
    })),

  typingIn: (channelId) => {
    const now = Date.now();
    const users = get().typing[channelId] ?? {};
    return Object.values(users).filter((u) => now - u.at < TYPING_TTL_MS);
  },

  setDraft: (channelId, text) =>
    set((state) => ({ drafts: { ...state.drafts, [channelId]: text } })),
}));
