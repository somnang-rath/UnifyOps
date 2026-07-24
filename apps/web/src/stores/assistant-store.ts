import { create } from 'zustand';
import type { ChatContext } from '@/schemas/assistant';

interface AssistantState {
  /** Whether the global slide-over panel is open. */
  open: boolean;
  /** Conversation currently shown in the panel (`null` = new chat). */
  activeConversationId: string | null;
  /** Grounding context attached from the current screen, if any. */
  context: ChatContext | null;

  openPanel: (opts?: { conversationId?: string | null; context?: ChatContext }) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setActiveConversation: (id: string | null) => void;
  newConversation: () => void;
  setContext: (context: ChatContext | null) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  open: false,
  activeConversationId: null,
  context: null,

  openPanel: (opts) =>
    set((s) => ({
      open: true,
      activeConversationId:
        opts?.conversationId !== undefined
          ? opts.conversationId
          : s.activeConversationId,
      context: opts?.context ?? s.context,
    })),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((s) => ({ open: !s.open })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  newConversation: () => set({ activeConversationId: null }),
  setContext: (context) => set({ context }),
}));
