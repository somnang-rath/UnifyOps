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
  ) {}

  /* ─── CRUD ─────────────────────────────────────────────── */

  list(ownerId: string) {
    return this.autoModel
      .find({ ownerId: new Types.ObjectId(ownerId) })
      .sort({ updatedAt: -1 })
      .lean();
  }

  byId(ownerId: string, id: string) {
    return this.autoModel
      .findOne({ _id: id, ownerId: new Types.ObjectId(ownerId) })
      .lean();
  }

  create(ownerId: string, dto: SaveAutomationDto) {
    return this.autoModel.create({
      ...dto,
      ownerId: new Types.ObjectId(ownerId),
      timesFired: 0,
    });
  }

  async update(ownerId: string, id: string, dto: UpdateAutomationDto) {
    const a = await this.autoModel.findById(id);
    if (!a) throw new NotFoundException();
    if (String(a.ownerId) !== ownerId) throw new ForbiddenException();
    if (dto.name !== undefined) a.name = dto.name;
    if (dto.trigger !== undefined) a.trigger = dto.trigger;
    if (dto.condition !== undefined) a.condition = dto.condition;
    if (dto.action !== undefined) a.action = dto.action;
    if (dto.enabled !== undefined) a.enabled = dto.enabled;
    return a.save();
  }

  async remove(ownerId: string, id: string) {
    const a = await this.autoModel.findById(id);
    if (!a) throw new NotFoundException();
    if (String(a.ownerId) !== ownerId) throw new ForbiddenException();
    await a.deleteOne();
    return { ok: true };
  }

  /* ─── Engine ────────────────────────────────────────────── */

  /**
   * Called by other services (issues, MRs, kanban) when an event occurs.
   * Finds all enabled automation rules matching the trigger and runs them.
   */
  async fire(trigger: string, payload: Record<string, unknown>): Promise<void> {
    const rules = await this.autoModel
      .find({ trigger, enabled: true })
      .lean();

    for (const r of rules) {
      let success = true;
      let errorMsg: string | undefined;

      try {
        await this.runAction(r.action, { ...payload, trigger });
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
        ...(errorMsg ? { error: errorMsg } : {}),
      });
    }
  }

  /* ─── Action handlers ───────────────────────────────────── */

  private async runAction(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const type = String(action.type ?? '').trim();

    switch (type) {
      case 'notify':
        await this.actionNotify(action, payload);
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
   */
  private async actionNotify(
    action: Record<string, unknown>,
    payload: Record<string, unknown>,
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

    // De-duplicate
    recipientIds = Array.from(new Set(recipientIds)).filter(Boolean);
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
