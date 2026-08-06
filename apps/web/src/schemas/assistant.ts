import { z } from 'zod';

/** Non-secret assistant settings returned by `GET /assistant/config`. */
export interface AssistantConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai';
  model: string;
  allowTools: boolean;
}

export type AssistantRole = 'user' | 'assistant';

/** A single agentic tool call recorded on an assistant turn. */
export interface AssistantToolCall {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
}

/** One persisted turn (`GET /assistant/conversations/:id`). */
export interface AssistantMessage {
  _id: string;
  conversationId: string;
  ownerId: string;
  role: AssistantRole;
  content: string;
  tokens: number;
  inputTokens?: number;
  tools?: AssistantToolCall[];
  createdAt: string;
  updatedAt: string;
}

/** Remaining per-user rate budget (`GET /assistant/usage`). */
export interface AssistantUsage {
  limit: number;
  remaining: number;
  resetAt: number;
  conversation?: { totalTokens: number; totalInputTokens: number };
}

/** A chat thread owned by the current user. */
export interface AssistantConversation {
  _id: string;
  ownerId: string;
  title: string;
  model: string;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail {
  conversation: AssistantConversation;
  messages: AssistantMessage[];
}

/** Optional grounding context attached from the current screen. Mirrors the API DTO. */
export const chatContextSchema = z.object({
  type: z.enum(['project', 'issue', 'wiki']),
  id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  title: z.string().max(300).optional(),
  text: z.string().max(20000).optional(),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

/** Composer input validation (mirrors `ChatSchema` on the API). */
export const chatInputSchema = z.object({
  message: z.string().min(1, 'Type a message').max(20000),
});
export type ChatInput = z.infer<typeof chatInputSchema>;

/** Payload sent to `POST /assistant/chat`. */
export interface ChatRequest {
  conversationId?: string;
  message: string;
  model?: string;
  context?: ChatContext;
}

/** An in-flight tool step surfaced during streaming (before persistence). */
export interface ToolStep {
  id: string;
  name: string;
  input: Record<string, unknown>;
  ok?: boolean;
}

/**
 * A destructive action the assistant has *proposed* but not performed (ADR
 * 0015 §2.2). Nothing has happened until the user presses confirm, which
 * replays `confirm` as an ordinary authenticated API call — there is no token
 * here, and the model cannot complete the action itself.
 */
export interface PendingAction {
  kind: string;
  summary: string;
  items: { id: string; title: string }[];
  /** Ids the tool could not resolve for this user; shown so nothing is silent. */
  skipped?: string[];
  confirm: { method: 'POST'; path: string; body: Record<string, unknown> };
}

/** Human-friendly labels for the agentic tools. */
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_issues: { running: 'Searching issues…', done: 'Searched issues' },
  search_wiki: { running: 'Searching wiki…', done: 'Searched wiki' },
  get_wiki_page: { running: 'Reading wiki page…', done: 'Read wiki page' },
  list_project_members: { running: 'Looking up members…', done: 'Read members' },
  list_cycles: { running: 'Looking up cycles…', done: 'Read cycles' },
  list_modules: { running: 'Looking up modules…', done: 'Read modules' },
  create_issue: { running: 'Creating issue…', done: 'Created issue' },
  update_issue: { running: 'Updating issue…', done: 'Updated issue' },
  assign_issue: { running: 'Assigning…', done: 'Assigned' },
  move_to_cycle: { running: 'Moving to cycle…', done: 'Moved to cycle' },
  move_to_module: { running: 'Moving to module…', done: 'Moved to module' },
  create_cycle: { running: 'Creating cycle…', done: 'Created cycle' },
  bulk_update: { running: 'Applying bulk edit…', done: 'Applied bulk edit' },
  // Tier C never performs anything — the label must not imply otherwise.
  delete_issue: { running: 'Preparing…', done: 'Proposed a deletion' },
  bulk_delete: { running: 'Preparing…', done: 'Proposed a deletion' },
};

export function toolStepLabel(name: string, done: boolean): string {
  const l = TOOL_LABELS[name];
  if (!l) return name;
  return done ? l.done : l.running;
}

/** Decoded SSE events emitted by the chat stream. */
export type ChatStreamEvent =
  | {
      type: 'meta';
      conversationId: string;
      model: string;
      rateLimit?: { limit: number; remaining: number };
    }
  | { type: 'delta'; text: string }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      id: string;
      ok: boolean;
      /** Present only for Tier C tools, which propose instead of acting. */
      pendingAction?: PendingAction;
    }
  | {
      type: 'done';
      conversationId: string;
      messageId: string;
      tokens: number;
      inputTokens?: number;
    }
  | { type: 'error'; message: string };
