import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IntakeForm,
  IntakeFormDocument,
  IntakeSubmission,
  IntakeSubmissionDocument,
} from './schemas/intake.schema';
import { ProjectAccessService } from '../projects/access/project-access.service';
import { IssuesService } from '../issues/issues.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import type {
  CreateIntakeFormDto,
  SubmitIntakeDto,
  UpdateIntakeFormDto,
} from './dto/intake.dto';

const oid = (v: string) => new Types.ObjectId(v);

@Injectable()
export class IntakeService {
  constructor(
    @InjectModel(IntakeForm.name)
    private formModel: Model<IntakeFormDocument>,
    @InjectModel(IntakeSubmission.name)
    private subModel: Model<IntakeSubmissionDocument>,
    private access: ProjectAccessService,
    private issues: IssuesService,
    private webhooks: WebhooksService,
  ) {}

  // ── Forms (authenticated, project members) ────────────────────────

  async createForm(userId: string, dto: CreateIntakeFormDto) {
    await this.access.assertProjectWritable(userId, dto.projectId);
    const fields = await this.access.getAccessFields(dto.projectId);
    if (!fields?.workspaceId) {
      throw new BadRequestException('Project has no workspace');
    }
    try {
      const form = await this.formModel.create({
        projectId: oid(dto.projectId),
        workspaceId: fields.workspaceId,
        createdBy: oid(userId),
        title: dto.title,
        description: dto.description,
        anchor: dto.anchor ?? null,
      });
      return form.toObject();
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('That anchor is already taken');
      }
      throw err;
    }
  }

  async listForms(userId: string, projectId: string) {
    if (!(await this.access.canReadProjectById(userId, projectId))) {
      throw new NotFoundException('Project not found');
    }
    return this.formModel
      .find({ projectId: oid(projectId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  async updateForm(userId: string, id: string, dto: UpdateIntakeFormDto) {
    const form = await this.ownedForm(userId, id);
    if (dto.title !== undefined) form.title = dto.title;
    if (dto.description !== undefined) form.description = dto.description;
    if (dto.isOpen !== undefined) form.isOpen = dto.isOpen;
    if (dto.anchor !== undefined) form.anchor = dto.anchor;
    try {
      await form.save();
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('That anchor is already taken');
      }
      throw err;
    }
    return form.toObject();
  }

  async submissions(userId: string, formId: string) {
    await this.ownedForm(userId, formId);
    return this.subModel
      .find({ formId: oid(formId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Accept a submission → create a real work item in the form's project, or
   * decline it. Accepting is idempotent-ish: a second accept is rejected rather
   * than spawning a duplicate issue.
   */
  async triage(
    userId: string,
    submissionId: string,
    action: 'accept' | 'decline',
  ) {
    const sub = await this.subModel.findById(submissionId);
    if (!sub) throw new NotFoundException('Submission not found');
    const form = await this.ownedForm(userId, String(sub.formId));

    if (sub.status !== 'pending') {
      throw new BadRequestException(`Already ${sub.status}`);
    }

    if (action === 'decline') {
      sub.status = 'declined';
      sub.triagedBy = oid(userId);
      await sub.save();
      return { status: sub.status };
    }

    const issue = await this.issues.create(userId, {
      projectId: String(form.projectId),
      title: sub.title,
      desc: sub.description,
      type: 'task',
      status: 'todo',
      priority: 'medium',
      labels: ['intake'],
      todos: [],
    });

    sub.status = 'accepted';
    sub.issueId = (issue as { _id: Types.ObjectId })._id;
    sub.triagedBy = oid(userId);
    await sub.save();

    return { status: sub.status, issueId: String(sub.issueId) };
  }

  // ── Public submission (anonymous) ─────────────────────────────────

  /** The public form shape — no internal ids beyond what a submitter needs. */
  async publicForm(anchor: string) {
    const form = await this.formModel
      .findOne({ anchor, isOpen: true }, { title: 1, description: 1, anchor: 1 })
      .lean();
    if (!form) throw new NotFoundException();
    return {
      anchor: form.anchor,
      title: form.title,
      description: form.description,
    };
  }

  async submit(anchor: string, dto: SubmitIntakeDto) {
    const form = await this.formModel.findOne({ anchor, isOpen: true });
    if (!form) throw new NotFoundException();

    await this.subModel.create({
      formId: form._id,
      title: dto.title,
      description: dto.description,
      submitterEmail: dto.submitterEmail ?? null,
    });

    // Notify integrations without exposing the submitter's email in the payload.
    this.webhooks
      .dispatch(form.workspaceId, 'intake.received', {
        formId: String(form._id),
        projectId: String(form.projectId),
        title: dto.title,
      })
      .catch(() => {});

    return { ok: true };
  }

  private async ownedForm(
    userId: string,
    id: string,
  ): Promise<IntakeFormDocument> {
    const form = await this.formModel.findById(id);
    if (!form) throw new NotFoundException('Form not found');
    // Managing a form / its submissions requires write on its project.
    await this.access.assertProjectWritable(userId, String(form.projectId));
    return form;
  }
}
