import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CycleDocument = HydratedDocument<Cycle>;

/**
 * A cycle's lifecycle state is **derived from its dates, never stored** — see
 * {@link cycleStatus}. Storing it would need a scheduler to flip `upcoming` →
 * `current` → `completed` at midnight, and would be wrong between ticks.
 */
export type CycleStatus = 'draft' | 'upcoming' | 'current' | 'completed';

/**
 * A cycle (sprint) — a time-boxed container for work items inside one project.
 *
 * Scope is **project-level, always**: unlike a View, a cycle has no
 * workspace-level form. A sprint that spans every project in the tenant is not
 * a thing teams plan, and allowing it would make the "one current cycle" rule
 * below meaningless. `workspaceId` is denormalised off the project purely so
 * tenant-scoped reads don't need a join (same trick as View).
 *
 * Membership lives on the *issue* (`Issue.cycleId`), not as an array here. An
 * array would need a transaction to stay consistent with the issue's own
 * pointer, and a cycle can hold thousands of items — the 16MB document ceiling
 * is a real risk. One indexed pointer keeps assignment a single atomic write.
 */
@Schema({ timestamps: true })
export class Cycle {
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

  /**
   * Both dates or neither. A cycle with no dates is a `draft` — a backlog
   * bucket the team has named but not scheduled. The service enforces the
   * pairing and `start <= end`.
   */
  @Prop({ type: Date, default: null })
  startDate: Date | null;

  @Prop({ type: Date, default: null })
  endDate: Date | null;

  /** Sort order within the project's cycle list. */
  @Prop({ default: 0 })
  position: number;
}

export const CycleSchema = SchemaFactory.createForClass(Cycle);
CycleSchema.index({ projectId: 1, startDate: 1 });
CycleSchema.index({ workspaceId: 1, updatedAt: -1 });

/**
 * Derive the lifecycle state from the dates at read time.
 *
 * Comparison is against the *instant*, and `endDate` is treated as inclusive of
 * its whole day by the service (it stores end-of-day), so a cycle ending today
 * still reads `current`.
 */
export function cycleStatus(
  cycle: Pick<Cycle, 'startDate' | 'endDate'>,
  now: Date = new Date(),
): CycleStatus {
  if (!cycle.startDate || !cycle.endDate) return 'draft';
  if (now < cycle.startDate) return 'upcoming';
  if (now > cycle.endDate) return 'completed';
  return 'current';
}
