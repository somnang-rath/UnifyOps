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
}

export const ViewSchema = SchemaFactory.createForClass(View);
ViewSchema.index({ workspaceId: 1, projectId: 1, position: 1 });
ViewSchema.index({ ownerId: 1, updatedAt: -1 });
