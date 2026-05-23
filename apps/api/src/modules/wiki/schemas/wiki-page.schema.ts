import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class WikiPage {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '' })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'WikiPage', default: null, index: true })
  parentId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;
}
export type WikiPageDocument = HydratedDocument<WikiPage>;
export const WikiPageSchema = SchemaFactory.createForClass(WikiPage);
WikiPageSchema.index({ projectId: 1, updatedAt: -1 });
