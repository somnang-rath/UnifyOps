import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Automation,
  AutomationDocument,
  AutomationLog,
  AutomationLogDocument,
} from './schemas/automation.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import {
  SaveAutomationDto,
  UpdateAutomationDto,
} from './dto/automation.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { ProjectAccessService } from '../projects/access/project-access.service';
import { evaluateCondition } from './condition';

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @InjectModel(Automation.name)
    private autoModel: Model<AutomationDocument>,
    @InjectModel(AutomationLog.name)
    private logModel: Model<AutomationLogDocument>,
    @InjectModel(Issue.name)
    private issueModel: Model<IssueDocument>,
    private notifs: NotificationsService,
    private users: UsersService,
    private access: ProjectAccessService,
  ) {}

  /* ─── CRUD ─────────────────────────────────────────────── */

  /**
   * Rules in the workspaces the caller belongs to. `workspaceId` narrows
   * (ADR 0011 §2b); a workspace the caller is not in is a 404, not an empty
   * list, so ids can't be probed for existence.
   */
  async list(userId: string, workspaceId?: string) {
    if (workspaceId) {
      await this.access.assertWorkspaceMember(userId, workspaceId);
      return this.autoModel
        .find({ workspaceId: new Types.ObjectId(workspaceId) })
        .sort({ updatedAt: -1 })
        .lean();
    }
    const mine = await this.access.myWorkspaceIds(userId);
    return this.autoModel
      .find({ workspaceId: { $in: mine } })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async byId(userId: string, id: string) {
    const rule = await this.autoModel.findById(id).lean();
    if (!rule) throw new NotFoundException();
    await this.access.assertWorkspaceMember(userId, rule.workspaceId);
    return rule;
  }

  async create(userId: string, dto: SaveAutomationDto) {
    await this.access.assertWorkspaceMember(userId, dto.workspaceId);
    return this.autoModel.create({
      ...dto,
      workspaceId: new Types.ObjectId(dto.workspaceId),
      ownerId: new Types.ObjectId(userId),
      timesFired: 0,
    });
  }

  async update(userId: string, id: string, dto: UpdateAutomationDto) {
    const a = await this.assertWritable(userId, id);
    if (dto.name !== undefined) a.name = dto.name;
    if (dto.trigger !== undefined) a.trigger = dto.trigger;
    if (dto.condition !== undefined) a.condition = dto.condition;
    if (dto.action !== undefined) a.action = dto.action;
    if (dto.enabled !== undefined) a.enabled = dto.enabled;
    return a.save();
  }

  async remove(userId: string, id: string) {
    const a = await this.assertWritable(userId, id);
    await a.deleteOne();
    return { ok: true };
  }

  /**
   * Read is workspace membership; write is narrower — the creator, or the
   * workspace owner. Keeping the owner in the gate means a rule doesn't become
   * unmanageable when the person who wrote it leaves, without letting any
   * member silently retarget a rule the whole team depends on.
   *
   * 404 first (non-member), 403 second (member, not entitled): a non-member
   * must not be able to tell an existing rule from a made-up id.
   */
  private async assertWritable(userId: string, id: string) {
    const a = await this.autoModel.findById(id);
    if (!a) throw new NotFoundException();
    await this.access.assertWorkspaceMember(userId, a.workspaceId);
    if (String(a.ownerId) === userId) return a;
    if (await this.access.isWorkspaceOwner(userId, a.workspaceId)) return a;
    throw new ForbiddenException();
  }

  /* ─── Engine ────────────────────────────────────────────── */

  /**
   * Called by other services (issues, MRs, projects, the scheduler) when an
   * event occurs. Runs the enabled rules of that event's workspace **whose
   * condition matches the payload** (`./condition.ts`); a rule whose condition
   * cannot be evaluated is skipped and logged, never run.
   *
   * Scoped to the event's workspace —
   * previously it ran every enabled rule in the instance, so a rule written in
   * one workspace re-assigned issues and notified people in another.
   *
   * The workspace is derived from the event, never from the rule: see
   * {@link workspaceOf}. An event with no workspace (a personal, project-less
   * issue) matches nothing — no workspace rule owns it. Fail closed.
   *
   * There is no HTTP route into this method by design; it is service-to-service
   * only. The `POST /automations/fire` endpoint that used to expose it let any
   * authenticated user run every matching rule against an arbitrary payload.
   */
  async fire(trigger: string, payload: Record<string, unknown>): Promise<void> {
    const workspaceId = await this.workspaceOf(payload);
    if (!workspaceId) {
      this.logger.debug(
        `Automation ${trigger}: no workspace resolved from the payload — skipped`,
      );
      return;
    }

    const rules = await this.autoModel
      .find({ workspaceId, trigger, enabled: true })
      .lean();

    for (const r of rules) {
      // The "when". Until this was wired in, `condition` was stored and never
      // read, so every enabled rule ran on every event of its trigger.
      const verdict = evaluateCondition(r.condition, { ...payload, trigger });

      if (!verdict.ok) {
        // Fail closed: a condition we cannot understand must not be treated as
        // "matches everything" — that is exactly the bug being fixed, and it
        // would be silent. Logged (unlike a clean non-match) because a rule
        // that can never fire is something its author needs to see.
        this.logger.warn(
          `Automation ${String(r._id)} (${r.name}): unusable condition — ${verdict.reason}`,
        );
        await this.logModel.create({
          automationId: r._id,
          trigger,
          payload,
          success: false,
          matched: false,
          error: `Condition not evaluated: ${verdict.reason}`,
        });
        continue;
      }

      if (!verdict.matched) {
        // No log row on purpose. Every rule on a trigger is evaluated for every
        // event, so logging clean non-matches would bury the rows that matter
        // under noise proportional to traffic.
        continue;
      }

      let success = true;
      let errorMsg: string | undefined;

      try {
        await this.runAction(r.action, { ...payload, trigger }, workspaceId);
        await this.autoModel.updateOne(
          { _id: r._id },
          { $set: { lastFired: new Date() }, $inc: { timesFired: 1 } },
        );
      } catch (err) {
        success = false;
        errorMsg = (err as Error).message;
        this.logger.warn(`Automation ${r._id} (${r.name}) failed: ${errorMsg}`);
      }

      await this.logModel.create({
        automationId: r._id,
        trigger,
        payload,
        success,
        matched: true,
        ...(errorMsg ? { error: errorMsg } : {}),
      });
    }
  }

  /**
   * The workspace an event happened in. `projectId` is preferred and resolved
   * against the database — the project's own `workspaceId` is the authority, so
   * a caller cannot widen the blast radius by labelling a payload. The explicit
   * `payload.workspaceId` is only the fallback for events that carry no project.
   * Null means "no tenant" and stops the rule lookup entirely.
   */
  private async workspaceOf(
    payload: Record<string, unknown>,
  ): Promise<Types.ObjectId | null> {
    const projectId = payload.projectId ? String(payload.projectId) : '';
    if (projectId) {
      const project = await this.access.getAccessFields(projectId);
      return project?.workspaceId
        ? new Types.ObjectId(String(project.workspaceId))
        : null;
    }
    const explicit = payload.workspaceId ? String(payload.workspaceId) : '';
    return Types.ObjectId.isValid(explicit) ? new Types.ObjectId(explicit) : null;
  }

  /* ─── Action handlers ───────────────────────────────────── */

  /**
   * `workspaceId` is the event's, resolved once in {@link fire}. The three
   * issue-mutating actions don't re-check it: the rule was selected *because*
   * it lives in the same workspace as the issue in the payload, so the target
   * is in-tenant by construction. `notify` does need it — its recipient lookup
   * is by role or email and would otherwise reach across the instance.
   */
  private async runAction(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
    workspaceId: Types.ObjectId,
  ): Promise<void> {
    const type = String(action.type ?? '').trim();

    switch (type) {
      case 'notify':
        await this.actionNotify(action, payload, workspaceId);
        break;
      case 'set_status':
        await this.actionSetStatus(action, payload);
        break;
      case 'set_assignee':
        await this.actionSetAssignee(action, payload);
        break;
      case 'add_label':
        await this.actionAddLabel(action, payload);
        break;
      case 'webhook':
        await this.actionWebhook(action, payload);
        break;
      default:
        this.logger.warn(`Automation: unknown action type "${type}" — skipped`);
    }
  }

  /**
   * Sends an in-app notification (+ email if user prefs allow).
   * action.target: email address OR role name OR empty (→ author + assignee)
   * action.value:  notification title override (optional)
   *
   * Every recipient is filtered down to the event's workspace before the push.
   * A role target resolves against *all* users in the instance holding that
   * role, so without the filter a rule in one workspace mailed the issue title
   * to every "dev" on the server — the same title leak §1.1 closed on /search,
   * arriving by notification instead.
   */
  private async actionNotify(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
    workspaceId: Types.ObjectId,
  ): Promise<void> {
    const target = String(action.target ?? '').trim();
    const titleOverride = String(action.value ?? '').trim();
    const subject = String(payload.title ?? 'Automation triggered');
    const trigger = String(payload.trigger ?? '');
    const link = payload.issueId
      ? `/issues/${payload.issueId}`
      : payload.mrId
        ? `/approvals/${payload.mrId}`
        : undefined;

    const notifTitle = titleOverride || triggerToTitle(trigger);

    let recipientIds: string[] = [];

    if (!target) {
      // Default: notify author + assignee from the payload
      if (payload.authorId) recipientIds.push(String(payload.authorId));
      if (payload.assigneeId) recipientIds.push(String(payload.assigneeId));
    } else if (target.includes('@')) {
      // Specific email address
      const user = await this.users.findByEmail(target);
      if (user) recipientIds.push(String(user._id));
    } else {
      // Role name (admin / cpo / marketing / sales / dev / …)
      const roleUsers = await this.users.findByRole(target);
      recipientIds = roleUsers.map((u) => u.id);
    }

    // De-duplicate, then drop anyone outside the event's workspace.
    recipientIds = Array.from(new Set(recipientIds)).filter(Boolean);
    if (recipientIds.length === 0) return;

    const inWorkspace = new Set(
      (await this.access.workspaceMemberIds(workspaceId)).map(String),
    );
    recipientIds = recipientIds.filter((id) => inWorkspace.has(id));
    if (recipientIds.length === 0) return;

    await this.notifs.pushMany(recipientIds, {
      type: 'issue',
      title: notifTitle,
      subject,
      link,
      entityRef: payload.issueId
        ? { kind: 'issue', id: String(payload.issueId) }
        : undefined,
    });
  }

  /**
   * Updates the issue's status field.
   * action.value: new status string (e.g. "done", "inprogress")
   */
  private async actionSetStatus(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const issueId = String(payload.issueId ?? '').trim();
    const newStatus = String(action.value ?? '').trim();
    if (!issueId || !newStatus || !Types.ObjectId.isValid(issueId)) return;

    await this.issueModel.updateOne(
      { _id: new Types.ObjectId(issueId) },
      { $set: { status: newStatus } },
    );
    this.logger.log(`Automation set_status: issue ${issueId} → ${newStatus}`);
  }

  /**
   * Re-assigns the issue to a specific user.
   * action.target: user email address
   */
  private async actionSetAssignee(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const issueId = String(payload.issueId ?? '').trim();
    const targetEmail = String(action.target ?? '').trim();
    if (!issueId || !targetEmail || !Types.ObjectId.isValid(issueId)) return;

    const user = await this.users.findByEmail(targetEmail);
    if (!user) {
      this.logger.warn(`Automation set_assignee: user not found for email "${targetEmail}"`);
      return;
    }

    await this.issueModel.updateOne(
      { _id: new Types.ObjectId(issueId) },
      { $set: { assigneeId: user._id } },
    );
    this.logger.log(`Automation set_assignee: issue ${issueId} → ${targetEmail}`);
  }

  /**
   * Adds a label to the issue (no-op if already present).
   * action.value: label string
   */
  private async actionAddLabel(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const issueId = String(payload.issueId ?? '').trim();
    const label = String(action.value ?? '').trim();
    if (!issueId || !label || !Types.ObjectId.isValid(issueId)) return;

    await this.issueModel.updateOne(
      { _id: new Types.ObjectId(issueId) },
      { $addToSet: { labels: label } },
    );
    this.logger.log(`Automation add_label: issue ${issueId} + "${label}"`);
  }

  /**
   * POSTs the trigger payload as JSON to an external URL.
   * action.value: webhook URL (must start with https:// or http://)
   */
  private async actionWebhook(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const url = String(action.value ?? '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.logger.warn(`Automation webhook: invalid URL "${url}"`);
      return;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'UnifyOps/1.0' },
      body: JSON.stringify({ event: payload.trigger, data: payload }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Webhook responded ${res.status} ${res.statusText}`);
    }
    this.logger.log(`Automation webhook: POST ${url} → ${res.status}`);
  }
}

/* ─── Helpers ───────────────────────────────────────────── */

function triggerToTitle(trigger: string): string {
  const map: Record<string, string> = {
    'issue.created': 'New issue created',
    'issue.status_changed': 'Issue status changed',
    'issue.assigned': 'Issue assigned',
    'issue.due_soon': 'Issue due soon',
    'mr.opened': 'Approval request opened',
    'mr.merged': 'Approval request merged',
    'project.member_added': 'Added to a project',
  };
  return map[trigger] ?? 'Automation triggered';
}
