import { z } from 'zod';

export const CHANNEL_VISIBILITIES = ['public', 'private'] as const;
export const RELAY_DIRECTIONS = [
  'both',
  'to-telegram',
  'from-telegram',
] as const;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// ── Channels ────────────────────────────────────────────────────────

export const CreateChannelSchema = z.object({
  workspaceId: objectId,
  name: z.string().min(1).max(80).trim(),
  topic: z.string().max(500).default(''),
  visibility: z.enum(CHANNEL_VISIBILITIES).default('public'),
  /** Seed members. The creator is always added regardless. */
  memberIds: z.array(objectId).max(200).default([]),
});
export type CreateChannelDto = z.infer<typeof CreateChannelSchema>;

export const UpdateChannelSchema = z
  .object({
    name: z.string().min(1).max(80).trim(),
    topic: z.string().max(500),
    visibility: z.enum(CHANNEL_VISIBILITIES),
    archived: z.boolean(),
    /** Scopes the AI assistant in this channel's Telegram bridge (ADR 0015 §2.4). */
    projectId: objectId.nullable(),
  })
  .partial();
export type UpdateChannelDto = z.infer<typeof UpdateChannelSchema>;

export const ListChannelQuerySchema = z.object({
  workspaceId: objectId,
  /** `mine` = joined channels + DMs. `all` also lists joinable public channels. */
  scope: z.enum(['mine', 'all']).default('mine'),
  includeArchived: z.coerce.boolean().default(false),
});
export type ListChannelQuery = z.infer<typeof ListChannelQuerySchema>;

export const ChannelMembersSchema = z.object({
  userIds: z.array(objectId).min(1).max(200),
});
export type ChannelMembersDto = z.infer<typeof ChannelMembersSchema>;

export const OpenDmSchema = z.object({
  workspaceId: objectId,
  userId: objectId,
});
export type OpenDmDto = z.infer<typeof OpenDmSchema>;

// ── Messages ────────────────────────────────────────────────────────

export const SendMessageSchema = z.object({
  /** Markdown subset (ADR 0007 §4), not a rich-text document. */
  body: z.string().max(20_000).default(''),
  replyToId: objectId.optional().nullable(),
  attachmentIds: z.array(objectId).max(10).default([]),
  /** Client-generated uuid — makes a retried POST idempotent and drives optimistic UI. */
  clientId: z.string().min(8).max(64).optional(),
});
export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export const EditMessageSchema = z.object({
  body: z.string().min(1).max(20_000),
});
export type EditMessageDto = z.infer<typeof EditMessageSchema>;

export const ListMessageQuerySchema = z.object({
  /** Cursor: return messages older than this id. `_id` is monotonic, so no tie-break needed. */
  before: objectId.optional(),
  after: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessageQuery = z.infer<typeof ListMessageQuerySchema>;

export const ReactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});
export type ReactionDto = z.infer<typeof ReactionSchema>;

export const MarkReadSchema = z.object({
  lastReadMessageId: objectId,
});
export type MarkReadDto = z.infer<typeof MarkReadSchema>;

// ── Telegram link ───────────────────────────────────────────────────

export const UpdateTelegramLinkSchema = z
  .object({
    direction: z.enum(RELAY_DIRECTIONS),
    active: z.boolean(),
  })
  .partial();
export type UpdateTelegramLinkDto = z.infer<typeof UpdateTelegramLinkSchema>;
