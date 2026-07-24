import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ViewDocument = HydratedDocument<View>;

export type ViewLayout = 'list' | 'kanban' | 'calendar' | 'timeline' | 'spreadsheet';

/**
 * A saved view — a named filter/group/sort/layout preset over work items
 * (docs/plan/03-feature-parity.md §2, ADR 0009).
 *
 * Scope: a view with a `projectId` belongs to that project; a view without one
 * is workspace-level and spans every project the reader can see. `ownerId` +
 * `isShared` decide visibility — a private view is the owner's alone, a shared
 * view is visible to everyone who can read its scope.
 *
 * `filters` is a free-form object rather than typed columns on purpose: the
 * filterable surface (labels, custom fields, relations) grows, and the view
 * layer should not need a migration every time the query shape does. The
 * service validates the shape it understands and ignores the rest.
 */
@Schema({ timestamps: true })
export class View {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  /** null = workspace-level view (spans all readable projects). */
  @Prop({ type: Types.ObjectId, ref: 'Project', default: null, index: true })
  projectId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['list', 'kanban', 'calendar', 'timeline', 'spreadsheet'],
    default: 'list',
  })
  layout: ViewLayout;

  /** Query criteria: { status, priority, type, assigneeId, labels, q, ... }. */
  @Prop({ type: Object, default: {} })
  filters: Record<string, unknown>;

  /** e.g. 'status' | 'assignee' | 'priority' | 'label' | null. */
  @Prop({ type: String, default: null })
  groupBy: string | null;

  /** e.g. 'updatedAt:desc' | 'priority:asc'. */
  @Prop({ type: String, default: 'updatedAt:desc' })
  sortBy: string;

  /** Which columns/fields to show, in order (layout-dependent). */
  @Prop({ type: [String], default: [] })
  displayProperties: string[];

  /** Visible to the whole scope, not just the owner. */
  @Prop({ default: false, index: true })
  isShared: boolean;

  /** Sort order of the view in a project/workspace's saved-view list. */
  @Prop({ default: 0 })
  position: number;

  // ── Public Space publishing (ADR 0012 §1, mirrors WikiPage) ──
  // Whether this view is currently published to the public Space.
  @Prop({ default: false, index: true })
  isPublic: boolean;

  // Public slug that resolves the view in the Space app. Minted once on first
  // publish and reused (unpublish keeps it). Uniqueness is enforced by the
  // partial index below, NOT by `unique: true` here — see the note on that index.
  @Prop({ type: String, default: null })
  anchor: string | null;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  publishedBy: Types.ObjectId | null;
}

export const ViewSchema = SchemaFactory.createForClass(View);
ViewSchema.index({ workspaceId: 1, projectId: 1, position: 1 });
ViewSchema.index({ ownerId: 1, updatedAt: -1 });

// Anchors are globally unique, but only once minted: every unpublished view
// keeps `anchor: null` and those must not collide with each other.
//
// `unique + sparse` does NOT achieve that. A sparse index only skips documents
// where the field is ABSENT — and `default: null` means the field is always
// present, so the second unpublished view would hit
// `E11000 dup key: { anchor: null }`. A partial index keyed on $type: 'string'
// is the correct tool: nulls are outside the index entirely.
ViewSchema.index(
  { anchor: 1 },
  { unique: true, partialFilterExpression: { anchor: { $type: 'string' } } },
);
