import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type Visibility = 'private' | 'internal' | 'public';
export type ProjectDocument = HydratedDocument<Project>;

/** Block-based content for the project Overview page (mirrors the Note block model). */
export type OverviewBlockType =
  | 'text'
  | 'heading'
  | 'check'
  | 'code'
  | 'image'
  | 'video'
  | 'divider'
  | 'table'
  | 'file';

@Schema({ _id: false })
export class OverviewBlock {
  @Prop({
    enum: [
      'text',
      'heading',
      'check',
      'code',
      'image',
      'video',
      'divider',
      'table',
      'file',
    ],
    required: true,
  })
  type: OverviewBlockType;

  @Prop({ default: '' })
  value: string;

  @Prop({ default: false })
  checked: boolean;

  @Prop()
  lang?: string;

  @Prop()
  color?: string;

  @Prop({ type: Object })
  table?: Record<string, unknown>;

  @Prop()
  fileId?: string;

  @Prop()
  fileViewSize?: string;
}
export const OverviewBlockSchema = SchemaFactory.createForClass(OverviewBlock);

/**
 * A user-defined Kanban column on the project board. Its `id` is the value stored
 * in each issue's `status` field, so cards map to a list by `issue.status === list.id`.
 */
@Schema({ _id: false })
export class BoardList {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '#94a3b8' })
  color: string;

  // null / 0 means "no limit".
  @Prop({ type: Number, default: null })
  wipLimit: number | null;

  @Prop({ default: false })
  collapsed: boolean;
}
export const BoardListSchema = SchemaFactory.createForClass(BoardList);

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '' })
  desc: string;

  @Prop({ default: '', lowercase: true, trim: true })
  namespace: string;

  @Prop({
    enum: ['private', 'internal', 'public'],
    default: 'private',
  })
  visibility: Visibility;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  // The workspace this project belongs to. Nullable during the migration to a
  // workspace-scoped model; backfilled to a default workspace on startup.
  @Prop({ type: Types.ObjectId, ref: 'Workspace', default: null, index: true })
  workspaceId: Types.ObjectId | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members: Types.ObjectId[];

  @Prop({ default: '#6366f1' })
  color: string;

  // Block-based Overview document (Plane-style project home). Excluded from the
  // project list payload; loaded only on the project detail / overview page.
  @Prop({ type: [OverviewBlockSchema], default: [] })
  overview: OverviewBlock[];

  // User-defined Kanban columns for the Work-items Board view. Empty means the
  // client falls back to the four canonical lists (todo/inprogress/review/done).
  @Prop({ type: [BoardListSchema], default: [] })
  boardLists: BoardList[];
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ ownerId: 1, members: 1 });
