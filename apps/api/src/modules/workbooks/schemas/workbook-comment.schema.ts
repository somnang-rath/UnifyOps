import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class CommentReply {
  @Prop({ required: true })
  id: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}
const CommentReplySchema = SchemaFactory.createForClass(CommentReply);

@Schema({ timestamps: true })
export class WorkbookComment {
  @Prop({ type: Types.ObjectId, ref: 'Workbook', required: true, index: true })
  workbookId: Types.ObjectId;

  @Prop({ required: true })
  sheetId: string;

  @Prop({ required: true })
  cellRef: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ default: false })
  resolved: boolean;

  @Prop({ type: [CommentReplySchema], default: [] })
  replies: CommentReply[];
}
export type WorkbookCommentDocument = HydratedDocument<WorkbookComment>;
export const WorkbookCommentSchema = SchemaFactory.createForClass(WorkbookComment);
WorkbookCommentSchema.index({ workbookId: 1, sheetId: 1, cellRef: 1 });
