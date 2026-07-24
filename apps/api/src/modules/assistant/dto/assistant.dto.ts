import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Optional grounding context the UI attaches from the current screen. */
export const ChatContextSchema = z.object({
  type: z.enum(['project', 'issue', 'wiki']).optional(),
  id: objectId.optional(),
  title: z.string().max(300).optional(),
  text: z.string().max(20000).optional(),
});
export type ChatContextDto = z.infer<typeof ChatContextSchema>;

export const ChatSchema = z.object({
  conversationId: objectId.optional(),
  message: z.string().min(1).max(20000),
  /** Override the admin-configured model for this turn (optional). */
  model: z.string().max(120).optional(),
  context: ChatContextSchema.optional(),
});
export type ChatDto = z.infer<typeof ChatSchema>;

export const RenameConversationSchema = z.object({
  title: z.string().min(1).max(200).trim(),
});
export type RenameConversationDto = z.infer<typeof RenameConversationSchema>;
