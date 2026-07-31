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

  // Cover image, hotlinked https URL (ADR 0010 §3). Never downloaded or
  // re-hosted; null = no cover (back-compat default, no migration needed).
  @Prop({ type: String, default: null })
  coverImage: string | null;

  // Block-based Overview document (Plane-style project home). Excluded from the
  // project list payload; loaded only on the project detail / overview page.
  @Prop({ type: [OverviewBlockSchema], default: [] })
  overview: OverviewBlock[];

  // User-defined Kanban columns for the Work-items Board view. Empty means the
  // client falls back to the four canonical lists (todo/inprogress/review/done).
  @Prop({ type: [BoardListSchema], default: [] })
  boardLists: BoardList[];

  // ── Public Space publishing (ADR 0012 §1, mirrors WikiPage) ──
  // Whether this project is currently published to the public Space.
  @Prop({ default: false, index: true })
  isPublic: boolean;

  // Public slug that resolves the project in the Space app. Minted once on
  // first publish and reused (unpublish keeps it). Uniqueness is enforced by the
  // partial index below, NOT by `unique: true` here — see the note on that index.
  @Prop({ type: String, default: null })
  anchor: string | null;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  publishedBy: Types.ObjectId | null;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ ownerId: 1, members: 1 });

// Anchors are globally unique, but only once minted: every unpublished project
// keeps `anchor: null` and those must not collide with each other.
//
// `unique + sparse` does NOT achieve that. A sparse index only skips documents
// where the field is ABSENT — and `default: null` means the field is always
// present, so the second unpublished project would hit
// `E11000 dup key: { anchor: null }`. A partial index keyed on $type: 'string'
// is the correct tool: nulls are outside the index entirely.
ProjectSchema.index(
  { anchor: 1 },
  { unique: true, partialFilterExpression: { anchor: { $type: 'string' } } },
);

// Backs `$text` in SearchService — mirrors IssueSchema's. Mongo allows exactly
// one text index per collection, so any new searchable field goes in here
// rather than into a second index.
ProjectSchema.index({ name: 'text', desc: 'text' });
