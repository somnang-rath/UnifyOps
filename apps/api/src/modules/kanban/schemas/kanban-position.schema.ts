import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class KanbanPosition {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Issue', required: true, index: true })
  issueId: Types.ObjectId;

  @Prop({ required: true })
  columnId: string;
}
export type KanbanPositionDocument = HydratedDocument<KanbanPosition>;
export const KanbanPositionSchema = SchemaFactory.createForClass(KanbanPosition);
KanbanPositionSchema.index({ userId: 1, issueId: 1 }, { unique: true });
