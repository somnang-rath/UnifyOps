import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const MODULE_STATUSES = [
  'backlog',
  'planned',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export type ProjectModuleDocument = HydratedDocument<ProjectModule>;

/**
 * A module — a feature- or goal-shaped grouping of work items inside a project
 * ("Billing v2", "Mobile onboarding"). The long-lived counterpart to a Cycle.
 *
 * Two differences from Cycle drive the whole schema, and both come from the
 * question each answers:
 *
 * 1. **Status is stored, not derived.** A cycle's state is a fact about the
 *    calendar, so `cycleStatus` computes it. A module's is a decision — work
 *    can be `paused` or `cancelled` while its dates say otherwise, and no date
 *    arithmetic can know that. So it is an explicit, human-set field.
 * 2. **No non-overlap rule and no both-or-neither dates.** Modules run in
 *    parallel by design ("what are we building" has many answers at once) and
 *    are routinely created with a target date but no start.
 *
 * Named `ProjectModule` rather than `Module` because `@nestjs/common` exports a
 * `Module` decorator — the collision would be a live footgun in every file that
 * imports both. `@Schema({ collection })` pins the Mongo collection so the name
 * change stays purely a TypeScript concern.
 */
@Schema({ timestamps: true, collection: 'modules' })
export class ProjectModule {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ default: '', maxlength: 2000 })
  description: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  /** Denormalised from the project so tenant-scoped list queries need no join. */
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  /** The person accountable for the module. Distinct from `ownerId`, its creator. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  leadId: Types.ObjectId | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  memberIds: Types.ObjectId[];

  /** Independently optional — a target with no start is a normal state here. */
  @Prop({ type: Date, default: null })
  startDate: Date | null;

  @Prop({ type: Date, default: null })
  targetDate: Date | null;

  @Prop({
    type: String,
    enum: MODULE_STATUSES,
    default: 'backlog',
    index: true,
  })
  status: ModuleStatus;

  /** Sort order within the project's module list. */
  @Prop({ default: 0 })
  position: number;
}

export const ProjectModuleSchema = SchemaFactory.createForClass(ProjectModule);
ProjectModuleSchema.index({ projectId: 1, position: 1 });
ProjectModuleSchema.index({ workspaceId: 1, updatedAt: -1 });
