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

/** Human-friendly labels for the agentic tools. */
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  search_issues: { running: 'Searching issues…', done: 'Searched issues' },
  search_wiki: { running: 'Searching wiki…', done: 'Searched wiki' },
  get_wiki_page: { running: 'Reading wiki page…', done: 'Read wiki page' },
  create_issue: { running: 'Creating issue…', done: 'Created issue' },
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
  | { type: 'tool_result'; id: string; ok: boolean }
  | {
      type: 'done';
      conversationId: string;
      messageId: string;
      tokens: number;
      inputTokens?: number;
    }
  | { type: 'error'; message: string };
