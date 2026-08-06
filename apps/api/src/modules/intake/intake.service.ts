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
import { ProjectsService } from '../projects/projects.service';
import { AssistantService } from '../assistant/assistant.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ISSUE_PRIORITIES } from '../issues/dto/issue.dto';
import type {
  CreateIntakeFormDto,
  SubmitIntakeDto,
  TriageDto,
  UpdateIntakeFormDto,
} from './dto/intake.dto';

const oid = (v: string) => new Types.ObjectId(v);

/** The most the model may propose — a triager scanning a queue, not a taxonomy. */
const MAX_SUGGESTED_LABELS = 4;

const TRIAGE_SYSTEM = [
  'You triage incoming requests for a software project.',
  'Reply with ONLY a JSON object, no prose and no code fence:',
  '{"priority":"low|medium|high|critical","labels":["kebab-case", ...],',
  '"assigneeId":"<id from the members list or null>","reasoning":"one short sentence"}',
  'Pick at most 4 labels. Choose an assignee only when the request clearly',
  'matches one person\'s area; otherwise use null. Never invent an id.',
].join('\n');

@Injectable()
export class IntakeService {
  constructor(
    @InjectModel(IntakeForm.name)
    private formModel: Model<IntakeFormDocument>,
    @InjectModel(IntakeSubmission.name)
    private subModel: Model<IntakeSubmissionDocument>,
    private access: ProjectAccessService,
    private issues: IssuesService,
    private projects: ProjectsService,
    private assistant: AssistantService,
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
  async triage(userId: string, submissionId: string, dto: TriageDto) {
    const sub = await this.subModel.findById(submissionId);
    if (!sub) throw new NotFoundException('Submission not found');
    const form = await this.ownedForm(userId, String(sub.formId));

    if (sub.status !== 'pending') {
      throw new BadRequestException(`Already ${sub.status}`);
    }

    if (dto.action === 'decline') {
      sub.status = 'declined';
      sub.triagedBy = oid(userId);
      await sub.save();
      return { status: sub.status };
    }

    // Accept pre-fills from the AI suggestion, and anything the triager passed
    // explicitly wins over it (ADR 0015 §2.5: accepting with edits stays one
    // click). The issue is still authored by the triaging user, exactly as
    // before — the suggestion changes the defaults, never the actor.
    const suggested = sub.suggestion;
    const priority =
      dto.priority ??
      (isPriority(suggested?.priority) ? suggested.priority : 'medium');
    const labels = [
      'intake',
      ...(dto.labels ?? suggested?.labels ?? []).filter((l) => l !== 'intake'),
    ];
    const assigneeId =
      dto.assigneeId !== undefined
        ? dto.assigneeId
        : suggested?.assigneeId
          ? String(suggested.assigneeId)
          : undefined;

    const issue = await this.issues.create(userId, {
      projectId: String(form.projectId),
      title: sub.title,
      desc: sub.description,
      type: 'task',
      status: 'todo',
      priority,
      labels,
      ...(assigneeId ? { assigneeId } : {}),
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

    const submission = await this.subModel.create({
      formId: form._id,
      title: dto.title,
      description: dto.description,
      submitterEmail: dto.submitterEmail ?? null,
    });

    // Fire-and-forget: a slow or down AI provider must not make a public form
    // stop accepting submissions. The queue simply shows no suggestion.
    this.generateSuggestion(String(submission._id)).catch(() => {});

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

  // ── AI triage suggestions (ADR 0015 §2.5) ─────────────────────────

  /** Re-run the suggestion by hand. Same gate as triaging: project write. */
  async resuggest(userId: string, submissionId: string) {
    const sub = await this.subModel.findById(submissionId);
    if (!sub) throw new NotFoundException('Submission not found');
    await this.ownedForm(userId, String(sub.formId));
    const suggestion = await this.generateSuggestion(submissionId);
    if (!suggestion) {
      throw new BadRequestException(
        'The AI assistant is not configured, or produced nothing usable.',
      );
    }
    return suggestion;
  }

  /**
   * Ask the model to propose a priority, labels and an assignee for one
   * submission, and store the result. Returns null (never throws) when the
   * assistant is off or the answer was unusable.
   *
   * A submission arrives from an anonymous stranger, so there is no calling
   * user to run as. Rather than a service identity, the member list is read as
   * **the person who created the form** — a real user, on their own project,
   * seeing only what the project page already shows them — and the result is
   * visible only to people who can already triage that queue.
   */
  async generateSuggestion(submissionId: string) {
    const sub = await this.subModel.findById(submissionId);
    if (!sub) return null;
    const form = await this.formModel.findById(sub.formId).lean();
    if (!form) return null;

    let members: { id: string; name: string; email: string }[] = [];
    try {
      members = await this.projects.membersForAssistant(
        String(form.createdBy),
        String(form.projectId),
      );
    } catch {
      // The form's creator lost access to its project — suggest without
      // an assignee rather than reaching for a wider identity.
      members = [];
    }

    const prompt = [
      `Project: ${form.title}`,
      form.description ? `Form description: ${form.description}` : '',
      '',
      `Request title: ${sub.title}`,
      sub.description ? `Request details:\n${sub.description}` : '',
      '',
      members.length
        ? `Project members:\n${members
            .map((m) => `- ${m.name} <${m.email}> id=${m.id}`)
            .join('\n')}`
        : 'Project members: (none available — use null for assigneeId)',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await this.assistant.complete(TRIAGE_SYSTEM, prompt, 400);
    if (!raw) return null;

    const parsed = parseJsonObject(raw);
    if (!parsed) return null;

    // Everything below is fail-closed: an unrecognised value is dropped, not
    // stored. The model proposes; the schema decides what a proposal may say.
    const priority = isPriority(parsed.priority) ? parsed.priority : null;
    const labels = Array.isArray(parsed.labels)
      ? parsed.labels
          .filter((l): l is string => typeof l === 'string')
          .map((l) => l.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40))
          .filter(Boolean)
          .slice(0, MAX_SUGGESTED_LABELS)
      : [];
    // An id that is not a member of this project is a hallucination, and
    // storing it would put a stranger's name on someone's queue.
    const memberIds = new Set(members.map((m) => m.id));
    const assigneeId =
      typeof parsed.assigneeId === 'string' && memberIds.has(parsed.assigneeId)
        ? oid(parsed.assigneeId)
        : null;
    const reasoning =
      typeof parsed.reasoning === 'string'
        ? parsed.reasoning.trim().slice(0, 500)
        : '';

    const suggestion = {
      priority,
      labels,
      assigneeId,
      reasoning,
      generatedAt: new Date(),
    };
    await this.subModel.updateOne(
      { _id: sub._id },
      { $set: { suggestion } },
    );
    return suggestion;
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

function isPriority(v: unknown): v is (typeof ISSUE_PRIORITIES)[number] {
  return (
    typeof v === 'string' &&
    (ISSUE_PRIORITIES as readonly string[]).includes(v)
  );
}

/**
 * Pull the first JSON object out of a model reply. Models fence JSON, prefix it
 * with "Here you go:", or both, however firmly the prompt asks them not to —
 * and a malformed reply must degrade to "no suggestion", never to a throw.
 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
