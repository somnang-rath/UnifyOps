import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../schemas/webhook.schema';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** '*' plus the known event names. */
const EventName = z.union([z.literal('*'), z.enum(WEBHOOK_EVENTS)]);

export const CreateWebhookSchema = z.object({
  workspaceId: objectId,
  // Only http(s); a webhook that could hit file:// or a raw IP is an SSRF hole.
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'URL must be http or https'),
  events: z.array(EventName).min(1).max(20).default(['*']),
});
export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;

export const UpdateWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'URL must be http or https')
    .optional(),
  events: z.array(EventName).min(1).max(20).optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookDto = z.infer<typeof UpdateWebhookSchema>;

export const ListWebhooksQuerySchema = z.object({
  workspaceId: objectId,
});
export type ListWebhooksQuery = z.infer<typeof ListWebhooksQuerySchema>;
