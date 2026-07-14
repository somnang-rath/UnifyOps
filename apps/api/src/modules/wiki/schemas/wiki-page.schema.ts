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

  // ── Phase 3: public Space publishing (ADR 0002 §1) ──
  // Whether this page is currently published to the public Space.
  @Prop({ default: false, index: true })
  isPublic: boolean;

  // Public slug that resolves the page in the Space app. Minted once on first
  // publish and reused (unpublish keeps it). unique + sparse so unlimited rows
  // may keep anchor: null while any non-null anchor is globally unique.
  @Prop({ type: String, default: null, unique: true, sparse: true })
  anchor: string | null;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  publishedBy: Types.ObjectId | null;
}
export type WikiPageDocument = HydratedDocument<WikiPage>;
export const WikiPageSchema = SchemaFactory.createForClass(WikiPage);
WikiPageSchema.index({ projectId: 1, updatedAt: -1 });
