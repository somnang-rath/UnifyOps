import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WebhookDeliveryDocument = HydratedDocument<WebhookDelivery>;

/**
 * One attempt to deliver one event to one webhook (docs/plan/03 §3).
 *
 * Kept for the delivery-log UI and for retry. Rows self-expire after 30 days so
 * the log does not grow without bound.
 */
@Schema({ timestamps: true })
export class WebhookDelivery {
  @Prop({ type: Types.ObjectId, ref: 'Webhook', required: true, index: true })
  webhookId: Types.ObjectId;

  @Prop({ required: true })
  event: string;

  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>;

  @Prop({ type: Number, default: null })
  status: number | null;

  @Prop({ default: false })
  success: boolean;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 })
  createdAt: Date;
}

export const WebhookDeliverySchema =
  SchemaFactory.createForClass(WebhookDelivery);
WebhookDeliverySchema.index({ webhookId: 1, createdAt: -1 });
