import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import {
  Workspace,
  WorkspaceDocument,
} from '../workspaces/schemas/workspace.schema';
import { IssuesService } from '../issues/issues.service';
import { CyclesService } from '../cycles/cycles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssistantService } from './assistant.service';

/** One recipient's week, already scoped to what *they* can read. */
export interface DigestPayload {
  openAssigned: number;
  overdue: { id: string; title: string; dueDate: string }[];
  dueThisWeek: { id: string; title: string; dueDate: string }[];
  highPriority: { id: string; title: string; priority: string }[];
  cycles: {
    id: string;
    name: string;
    endDate: string | null;
    completed: number;
    total: number;
  }[];
}

const DIGEST_SYSTEM = [
  'You write a short Friday status note for one person about their own work.',
  'Three or four sentences, plain text, no headings, no bullet points, no',
  'markdown. Lead with what needs attention (overdue first), then how their',
  'cycles are tracking. Be specific with names and numbers. If there is',
  'nothing pressing, say so briefly rather than padding.',
].join(' ');

const MAX_SUBJECT = 900;
const SAMPLE = 8;

/**
 * The weekly AI digest (ADR 0015 §2.6).
 *
 * The important property is what this service does *not* have: an identity. A
 * scheduled job has no calling user, and under §2.1 that means no read
 * permissions at all. So rather than inventing a service account with
 * instance-wide read, each recipient's digest is assembled by reading **as that
 * recipient**, through the same service methods their own screens use, and the
 * model is handed a payload that was already scoped before it saw it. It issues
 * no tool calls and never sees a cross-user corpus.
 *
 * The cron lives here rather than in `notifications.scheduler.ts` because the
 * digest needs `AssistantService`, and NotificationsModule sits *below* the
 * assistant in the import graph (issues → notifications) — putting it there
 * would need a forwardRef to break a cycle that simply doesn't have to exist.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    private issues: IssuesService,
    private cycles: CyclesService,
    private notifs: NotificationsService,
    private assistant: AssistantService,
  ) {}

  /**
   * Friday 17:00. A literal expression, not `CronExpression.EVERY_WEEK` —
   * that one fires at Sunday midnight, which is nobody's end of week.
   */
  @Cron('0 17 * * 5', { name: 'assistant-weekly-digest' })
  async weeklyDigest(): Promise<void> {
    try {
      const { recipients, sent } = await this.runWeekly();
      this.logger.log(`Weekly digest: ${sent}/${recipients} delivered`);
    } catch (err) {
      this.logger.error('Weekly digest failed', err as Error);
    }
  }

  /** Everyone in at least one workspace gets one. Returns delivery counts. */
  async runWeekly(): Promise<{ recipients: number; sent: number }> {
    const workspaces = await this.workspaceModel
      .find({}, { ownerId: 1, members: 1 })
      .lean();
    const userIds = new Set<string>();
    for (const ws of workspaces) {
      userIds.add(String(ws.ownerId));
      for (const m of ws.members ?? []) userIds.add(String(m));
    }

    let sent = 0;
    for (const userId of userIds) {
      try {
        if (await this.deliver(userId)) sent += 1;
      } catch (err) {
        // One recipient's failure must not cost everyone else their digest.
        this.logger.warn(`Digest failed for ${userId}: ${String(err)}`);
      }
    }
    return { recipients: userIds.size, sent };
  }

  /** Build + summarise + notify one recipient. False when there was nothing to say. */
  async deliver(userId: string): Promise<boolean> {
    const { payload, summary } = await this.previewFor(userId);
    if (!hasContent(payload)) return false;

    await this.notifs.push({
      userId,
      type: 'digest',
      title: 'Your week in Prism',
      subject: summary.slice(0, MAX_SUBJECT),
      link: '/',
    });
    return true;
  }

  /**
   * The digest for one user, without sending it. Drives `GET /assistant/digest`
   * so a person can see exactly what the job would say about them — and so the
   * §2.6 scoping claim is testable rather than asserted.
   */
  async previewFor(
    userId: string,
  ): Promise<{ payload: DigestPayload; summary: string; ai: boolean }> {
    const payload = await this.buildFor(userId);
    const summary = await this.summarise(payload);
    return { ...summary, payload };
  }

  /**
   * Gather one user's week. Every read here goes through the ordinary
   * service method with `userId` as the caller, so the payload can only ever
   * contain what that person could already open in the UI.
   */
  async buildFor(userId: string): Promise<DigestPayload> {
    const assigned = await this.issues.list(userId, {
      assigneeId: userId,
      status: 'open',
      page: 1,
      limit: 100,
    } as never);
    const items = (assigned.items ?? []) as Record<string, unknown>[];

    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const overdue: DigestPayload['overdue'] = [];
    const dueThisWeek: DigestPayload['dueThisWeek'] = [];
    const highPriority: DigestPayload['highPriority'] = [];

    for (const i of items) {
      const due = i.dueDate ? new Date(String(i.dueDate)) : null;
      const row = { id: String(i._id), title: String(i.title ?? '') };
      if (due && !Number.isNaN(due.valueOf())) {
        const dueDate = due.toISOString().slice(0, 10);
        if (due < now) overdue.push({ ...row, dueDate });
        else if (due <= weekEnd) dueThisWeek.push({ ...row, dueDate });
      }
      if (i.priority === 'critical' || i.priority === 'high') {
        highPriority.push({ ...row, priority: String(i.priority) });
      }
    }

    const cycles = await this.cycles.list(userId, { status: 'current' } as never);

    return {
      openAssigned: items.length,
      overdue: overdue.slice(0, SAMPLE),
      dueThisWeek: dueThisWeek.slice(0, SAMPLE),
      highPriority: highPriority.slice(0, SAMPLE),
      cycles: cycles.slice(0, SAMPLE).map((c) => ({
        id: String(c._id),
        name: String(c.name),
        endDate: c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : null,
        completed: c.progress?.completed ?? 0,
        total: c.progress?.total ?? 0,
      })),
    };
  }

  /**
   * Turn the scoped payload into prose. Falls back to a deterministic sentence
   * when the assistant is disabled or the provider is down — the digest is a
   * notification feature that AI improves, not one that AI gates.
   */
  private async summarise(
    payload: DigestPayload,
  ): Promise<{ summary: string; ai: boolean }> {
    if (!hasContent(payload)) return { summary: plainSummary(payload), ai: false };
    const text = await this.assistant.complete(
      DIGEST_SYSTEM,
      JSON.stringify(payload),
      400,
    );
    return text
      ? { summary: text, ai: true }
      : { summary: plainSummary(payload), ai: false };
  }
}

function hasContent(p: DigestPayload): boolean {
  return (
    p.openAssigned > 0 ||
    p.overdue.length > 0 ||
    p.dueThisWeek.length > 0 ||
    p.cycles.length > 0
  );
}

/** The no-AI digest. Same facts, no prose. */
function plainSummary(p: DigestPayload): string {
  if (!hasContent(p)) return 'Nothing assigned to you is open right now.';
  const parts = [`${p.openAssigned} open item(s) assigned to you`];
  if (p.overdue.length) parts.push(`${p.overdue.length} overdue`);
  if (p.dueThisWeek.length) parts.push(`${p.dueThisWeek.length} due this week`);
  for (const c of p.cycles) {
    parts.push(`${c.name}: ${c.completed}/${c.total} done`);
  }
  return `${parts.join(' · ')}.`;
}
