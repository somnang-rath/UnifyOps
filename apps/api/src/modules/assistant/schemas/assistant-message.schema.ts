import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AssistantRole = 'user' | 'assistant';

/** One turn in an {@link AssistantConversation}. */
@Schema({ timestamps: true })
export class AssistantMessage {
  @Prop({
    type: Types.ObjectId,
    ref: 'AssistantConversation',
    required: true,
    index: true,
  })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ enum: ['user', 'assistant'], required: true })
  role: AssistantRole;

  @Prop({ default: '' })
  content: string;

  /** Output tokens produced for this turn (assistant messages only). */
  @Prop({ default: 0 })
  tokens: number;

  /** Input tokens billed for this turn (assistant messages only). */
  @Prop({ default: 0 })
  inputTokens: number;

  /** Compact trace of agentic tool calls made while producing this turn. */
  @Prop({
    type: [
      {
        _id: false,
        name: String,
        input: Object,
        ok: Boolean,
      },
    ],
    default: undefined,
  })
  tools?: { name: string; input: Record<string, unknown>; ok: boolean }[];
}

export type AssistantMessageDocument = HydratedDocument<AssistantMessage>;
export const AssistantMessageSchema =
  SchemaFactory.createForClass(AssistantMessage);
AssistantMessageSchema.index({ conversationId: 1, createdAt: 1 });
