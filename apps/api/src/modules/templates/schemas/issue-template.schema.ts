import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  IssuePriority,
  IssueType,
} from '../../issues/schemas/issue.schema';

export type IssueTemplateDocument = HydratedDocument<IssueTemplate>;

@Schema({ _id: false })
class TemplateTodo {
  @Prop({ required: true, trim: true })
  text: string;

  @Prop({ default: false })
  done: boolean;
}
const TemplateTodoSchema = SchemaFactory.createForClass(TemplateTodo);

/**
 * The issue fields a template pre-fills. Field names/enums mirror the Issue
 * schema exactly (`desc`, `type`, `priority`, `labels`, `todos`) so applying a
 * template is a plain spread into a create-issue payload. Todos carry no `id`
 * here — ids are minted when the template is applied, not stored.
 */
@Schema({ _id: false })
class TemplateDefaults {
  @Prop()
  desc?: string;

  @Prop({ enum: ['bug', 'feature', 'task', 'docs'] })
  type?: IssueType;

  @Prop({ enum: ['low', 'medium', 'high', 'critical'] })
  priority?: IssuePriority;

  @Prop({ type: [String] })
  labels?: string[];

  @Prop({ type: [TemplateTodoSchema] })
  todos?: TemplateTodo[];
}
const TemplateDefaultsSchema = SchemaFactory.createForClass(TemplateDefaults);

/**
 * A reusable issue template (Phase 8 workstream B). Workspace-scoped like a
 * View (ADR 0003–0006): `projectId` null = workspace-level template, visible
 * next to any project's own templates in that workspace.
 */
@Schema({ timestamps: true })
export class IssueTemplate {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  /** null = workspace-level template (offered in every project). */
  @Prop({ type: Types.ObjectId, ref: 'Project', default: null, index: true })
  projectId: Types.ObjectId | null;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ type: TemplateDefaultsSchema, default: {} })
  defaults: TemplateDefaults;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  /** Sort order within a project/workspace's template list. */
  @Prop({ default: 0 })
  position: number;
}

export const IssueTemplateSchema = SchemaFactory.createForClass(IssueTemplate);
IssueTemplateSchema.index({ workspaceId: 1, projectId: 1, position: 1 });
