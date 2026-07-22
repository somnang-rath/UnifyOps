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

  // Cover image, hotlinked https URL (ADR 0010 §3). Never downloaded or
  // re-hosted; null = no cover (back-compat default, no migration needed).
  @Prop({ type: String, default: null })
  coverImage: string | null;

  // ── Phase 3: public Space publishing (ADR 0002 §1) ──
  // Whether this page is currently published to the public Space.
  @Prop({ default: false, index: true })
  isPublic: boolean;

  // Public slug that resolves the page in the Space app. Minted once on first
  // publish and reused (unpublish keeps it). Uniqueness is enforced by the
  // partial index below, NOT by `unique: true` here — see the note on that index.
  @Prop({ type: String, default: null })
  anchor: string | null;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  publishedBy: Types.ObjectId | null;
}
export type WikiPageDocument = HydratedDocument<WikiPage>;
export const WikiPageSchema = SchemaFactory.createForClass(WikiPage);
WikiPageSchema.index({ projectId: 1, updatedAt: -1 });

// Anchors are globally unique, but only once minted: every unpublished page
// keeps `anchor: null` and those must not collide with each other.
//
// `unique + sparse` does NOT achieve that. A sparse index only skips documents
// where the field is ABSENT — and `default: null` means the field is always
// present, so the second unpublished page hit
// `E11000 dup key: { anchor: null }`. A partial index keyed on $type: 'string'
// is the correct tool: nulls are outside the index entirely.
WikiPageSchema.index(
  { anchor: 1 },
  { unique: true, partialFilterExpression: { anchor: { $type: 'string' } } },
);
