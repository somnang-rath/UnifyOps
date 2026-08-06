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

  /**
   * Every object id a tool result surfaced during this turn (ADR 0015 §2.3).
   *
   * This is what makes "the model may only act on ids it has actually seen" a
   * *conversation*-wide rule rather than a per-request one: the next turn seeds
   * its `ToolSession` from these. Without it, "delete the ones we just found"
   * would fail the moment the user pressed enter twice.
   */
  @Prop({ type: [String], default: undefined })
  toolIds?: string[];
}

export type AssistantMessageDocument = HydratedDocument<AssistantMessage>;
export const AssistantMessageSchema =
  SchemaFactory.createForClass(AssistantMessage);
AssistantMessageSchema.index({ conversationId: 1, createdAt: 1 });
