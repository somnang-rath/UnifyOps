import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class BoardColumn {
  @Prop({ required: true }) id: string;
  @Prop({ required: true }) name: string;
  @Prop({ required: true, default: 'slate' }) color: string;
  @Prop({ default: false }) collapsed: boolean;
  @Prop({ default: false }) builtin: boolean;
  @Prop({ type: Number, default: null }) wipLimit?: number | null;
}
const BoardColumnSchema = SchemaFactory.createForClass(BoardColumn);

@Schema({ timestamps: true })
export class KanbanBoard {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: [BoardColumnSchema], default: [] })
  columns: BoardColumn[];
}
export type KanbanBoardDocument = HydratedDocument<KanbanBoard>;
export const KanbanBoardSchema = SchemaFactory.createForClass(KanbanBoard);
