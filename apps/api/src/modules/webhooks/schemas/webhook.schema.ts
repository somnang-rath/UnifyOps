import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WebhookDocument = HydratedDocument<Webhook>;

/** Events a webhook can subscribe to. `*` means every event. */
export const WEBHOOK_EVENTS = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'project.created',
  'intake.received',
] as const;

/**
 * An outbound webhook (docs/plan/03-feature-parity.md §3).
 *
 * `secret` signs each delivery (HMAC-SHA256 over the raw body) so the receiver
 * can verify the payload really came from this instance. It is returned to the
 * owner on create and thereafter only ever used server-side to sign — the list
 * endpoint never echoes it back.
 */
@Schema({ timestamps: true })
export class Webhook {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true })
  url: string;

  /** Subscribed events; `['*']` for all. */
  @Prop({ type: [String], default: ['*'] })
  events: string[];

  @Prop({ required: true })
  secret: string;

  @Prop({ default: true })
  active: boolean;

  /** Rolling health, updated by the deliverer. */
  @Prop({ type: Date, default: null })
  lastDeliveryAt: Date | null;

  @Prop({ type: Number, default: null })
  lastStatus: number | null;

  @Prop({ default: 0 })
  consecutiveFailures: number;
}

export const WebhookSchema = SchemaFactory.createForClass(Webhook);
WebhookSchema.index({ workspaceId: 1, active: 1 });
