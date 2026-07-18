import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IssueRelationDocument = HydratedDocument<IssueRelation>;

/**
 * Relation kinds stored on the *source* side (docs/plan/03-feature-parity.md §1).
 *
 * `blocks` / `blocked_by` are one relationship seen from two ends — we store the
 * single `blocks` direction and present the inverse to the blocked issue. The
 * symmetric kinds (`relates_to`, `duplicate`) read the same from both ends.
 */
export type RelationType = 'blocks' | 'relates_to' | 'duplicate';

/** How a stored relation appears from the other issue's point of view. */
export const INVERSE_RELATION: Record<RelationType, string> = {
  blocks: 'blocked_by',
  relates_to: 'relates_to',
  duplicate: 'duplicate',
};

@Schema({ timestamps: true })
export class IssueRelation {
  @Prop({ type: Types.ObjectId, ref: 'Issue', required: true, index: true })
  sourceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Issue', required: true, index: true })
  targetId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['blocks', 'relates_to', 'duplicate'],
    required: true,
  })
  type: RelationType;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const IssueRelationSchema = SchemaFactory.createForClass(IssueRelation);
// One relation of a given type between two issues — no duplicates.
IssueRelationSchema.index(
  { sourceId: 1, targetId: 1, type: 1 },
  { unique: true },
);
IssueRelationSchema.index({ targetId: 1, type: 1 });
