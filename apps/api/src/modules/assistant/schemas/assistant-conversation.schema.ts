import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** A single AI Assistant chat thread, owned by one user. */
@Schema({ timestamps: true })
export class AssistantConversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ default: 'New chat', trim: true })
  title: string;

  /** Model that produced the latest reply (for display). */
  @Prop({ default: '' })
  model: string;

  /** Cumulative output-token estimate across the conversation. */
  @Prop({ default: 0 })
  totalTokens: number;

  /** Cumulative input-token estimate across the conversation. */
  @Prop({ default: 0 })
  totalInputTokens: number;
}

export type AssistantConversationDocument =
  HydratedDocument<AssistantConversation>;
export const AssistantConversationSchema = SchemaFactory.createForClass(
  AssistantConversation,
);
AssistantConversationSchema.index({ ownerId: 1, updatedAt: -1 });
