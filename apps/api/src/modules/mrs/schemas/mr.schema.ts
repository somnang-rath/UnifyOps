import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MRStatus = 'open' | 'merged' | 'closed';

@Schema({ _id: false })
class MRComment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true })
  body: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}
const MRCommentSchema = SchemaFactory.createForClass(MRComment);

@Schema({ timestamps: true })
export class MergeRequest {
  @Prop({ required: true, trim: true }) title: string;
  @Prop({ default: '' })                desc: string;

  @Prop({ required: true, trim: true })  sourceBranch: string;
  @Prop({ default: 'main', trim: true }) targetBranch: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', index: true })
  projectId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  reviewerId?: Types.ObjectId;

  @Prop({
    enum: ['open', 'merged', 'closed'],
    default: 'open',
    index: true,
  })
  status: MRStatus;

  @Prop() decidedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  decidedById?: Types.ObjectId;

  @Prop({ type: [MRCommentSchema], default: [] })
  comments: MRComment[];
}
export type MergeRequestDocument = HydratedDocument<MergeRequest>;
export const MergeRequestSchema = SchemaFactory.createForClass(MergeRequest);
MergeRequestSchema.index({ projectId: 1, status: 1 });
MergeRequestSchema.index({ authorId: 1, updatedAt: -1 });
MergeRequestSchema.index({ reviewerId: 1, status: 1 }, { sparse: true });
MergeRequestSchema.index({ title: 'text', desc: 'text' });
