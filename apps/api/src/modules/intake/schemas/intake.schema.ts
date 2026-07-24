import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IntakeFormDocument = HydratedDocument<IntakeForm>;
export type IntakeSubmissionDocument = HydratedDocument<IntakeSubmission>;

/**
 * A public intake form (docs/plan/03-feature-parity.md §1/§4).
 *
 * Anyone with the `anchor` can submit; submissions land in a triage queue that
 * a member turns into a work item. The form is scoped to a project so an
 * accepted submission has a home.
 */
@Schema({ timestamps: true })
export class IntakeForm {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ default: '', maxlength: 2000 })
  description: string;

  /** Public slug for the form (unique). Absent = not published. */
  @Prop({ type: String, default: null, unique: true, sparse: true })
  anchor: string | null;

  @Prop({ default: true })
  isOpen: boolean;
}

export const IntakeFormSchema = SchemaFactory.createForClass(IntakeForm);

export type IntakeStatus = 'pending' | 'accepted' | 'declined';

@Schema({ timestamps: true })
export class IntakeSubmission {
  @Prop({ type: Types.ObjectId, ref: 'IntakeForm', required: true, index: true })
  formId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ default: '', maxlength: 10_000 })
  description: string;

  /** Optional contact from the anonymous submitter. */
  @Prop({ type: String, default: null })
  submitterEmail: string | null;

  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
    index: true,
  })
  status: IntakeStatus;

  /** Set when accepted → the work item this became. */
  @Prop({ type: Types.ObjectId, ref: 'Issue', default: null })
  issueId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  triagedBy: Types.ObjectId | null;
}

export const IntakeSubmissionSchema =
  SchemaFactory.createForClass(IntakeSubmission);
IntakeSubmissionSchema.index({ formId: 1, status: 1, createdAt: -1 });
