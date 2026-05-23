import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IssueType = 'bug' | 'feature' | 'task' | 'docs';
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
export type IssueDocument = HydratedDocument<Issue>;

@Schema({ _id: false })
class IssueComment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true })
  body: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}
const IssueCommentSchema = SchemaFactory.createForClass(IssueComment);

@Schema({ _id: false })
class IssueTodo {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, trim: true })
  text: string;

  @Prop({ default: false })
  done: boolean;
}
const IssueTodoSchema = SchemaFactory.createForClass(IssueTodo);

@Schema({ timestamps: true })
export class Issue {
  @Prop({ type: Types.ObjectId, ref: 'Project', index: true })
  projectId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '' })
  desc: string;

  @Prop({
    enum: ['bug', 'feature', 'task', 'docs'],
    default: 'task',
  })
  type: IssueType;

  @Prop({ default: 'todo', index: true })
  status: string;

  @Prop({
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  })
  priority: IssuePriority;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assigneeId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId: Types.ObjectId;

  @Prop()
  dueDate?: Date;

  @Prop({ type: [String], default: [] })
  labels: string[];

  @Prop({ type: [IssueCommentSchema], default: [] })
  comments: IssueComment[];

  @Prop({ type: [IssueTodoSchema], default: [] })
  todos: IssueTodo[];

  @Prop({ type: Types.ObjectId, ref: 'Issue' })
  parentId?: Types.ObjectId;
}

export const IssueSchema = SchemaFactory.createForClass(Issue);
IssueSchema.index({ projectId: 1, status: 1 });
IssueSchema.index({ assigneeId: 1, status: 1 });
IssueSchema.index({ authorId: 1, updatedAt: -1 });
IssueSchema.index({ dueDate: 1 }, { sparse: true });
IssueSchema.index({ title: 'text', desc: 'text' });
