import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Automation {
  /**
   * The tenant this rule belongs to (ADR 0003). An automation is a *team* rule,
   * not a personal preference: it mutates issues and notifies people, so the
   * workspace — not the creator — is what bounds its blast radius. `required`,
   * because a rule with no workspace can match no event and would sit in the
   * collection firing on nothing.
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  })
  workspaceId: Types.ObjectId;

  /** Who created it. Audit + a write gate alongside the workspace owner — never the read scope. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  trigger: string;

  /**
   * The "when" — see `../condition.ts` for the grammar. `{}` (the default, and
   * what every rule written before the evaluator existed holds) means "always".
   * Validated on write by `ConditionSchema`; a stored value that still fails to
   * evaluate makes the rule skip, never fire.
   */
  @Prop({ type: Object, default: {} })
  condition: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  action: Record<string, unknown>;

  @Prop({ default: true })
  enabled: boolean;

  @Prop()
  lastFired?: Date;

  @Prop({ default: 0 })
  timesFired: number;
}
export type AutomationDocument = HydratedDocument<Automation>;
export const AutomationSchema = SchemaFactory.createForClass(Automation);

// The exact shape of the engine's lookup in `AutomationsService.fire` — it runs
// once per issue/MR event, so it must not scan the collection.
AutomationSchema.index({ workspaceId: 1, trigger: 1, enabled: 1 });

@Schema({ timestamps: true })
export class AutomationLog {
  @Prop({ type: Types.ObjectId, ref: 'Automation', required: true, index: true })
  automationId: Types.ObjectId;

  @Prop({ required: true })
  trigger: string;

  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>;

  @Prop({ default: true })
  success: boolean;

  /**
   * Whether the rule's condition matched. Rows are only written for rules that
   * matched (`true`) or whose condition could not be evaluated at all
   * (`false` + `error`). A clean non-match writes nothing — every rule on a
   * trigger is evaluated for every event, so logging those would scale the
   * collection with traffic rather than with anything worth reading.
   */
  @Prop({ default: true })
  matched: boolean;

  @Prop()
  error?: string;
}
export type AutomationLogDocument = HydratedDocument<AutomationLog>;
export const AutomationLogSchema = SchemaFactory.createForClass(AutomationLog);
