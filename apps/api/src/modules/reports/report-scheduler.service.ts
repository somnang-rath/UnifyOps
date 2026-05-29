import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReportTemplate,
  ReportTemplateDocument,
} from './schemas/report-template.schema';
import { ReportRun, ReportRunDocument } from './schemas/report-run.schema';
import { ReportsService } from './reports.service';

@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    @InjectModel(ReportTemplate.name)
    private templateModel: Model<ReportTemplateDocument>,
    @InjectModel(ReportRun.name)
    private runModel: Model<ReportRunDocument>,
    private reportsService: ReportsService,
  ) {}

  // ── Hourly report dispatch ────────────────────────────────────────────────

  @Cron('0 * * * *')
  async runHourlyCheck() {
    const now      = new Date();
    const utcHour  = now.getUTCHours();
    const utcDow   = now.getUTCDay();
    const utcDom   = now.getUTCDate();
    const utcMonth = now.getUTCMonth() + 1;

    const f = { hour: utcHour, dayOfWeek: utcDow, dayOfMonth: utcDom, month: utcMonth };
    await this.runScheduled('daily',   f);
    await this.runScheduled('weekly',  f);
    await this.runScheduled('monthly', f);
    await this.runScheduled('yearly',  f);
  }

  // ── Stale-run cleanup (every 30 minutes) ─────────────────────────────────

  /**
   * Runs stuck in 'generating' for more than 60 minutes are force-failed.
   * This recovers from crashes / ungraceful server restarts.
   */
  @Cron('*/30 * * * *')
  async cleanupStaleRuns() {
    await this.reportsService.cleanupStaleRuns();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private isDue(
    s: { hour: number; dayOfWeek?: number; dayOfMonth?: number; month?: number },
    filter: { hour: number; dayOfWeek: number; dayOfMonth: number; month: number },
    frequency: string,
  ): boolean {
    if (s.hour !== filter.hour) return false;
    if (frequency === 'weekly')  return (s.dayOfWeek  ?? 1) === filter.dayOfWeek;
    if (frequency === 'monthly') return (s.dayOfMonth ?? 1) === filter.dayOfMonth;
    if (frequency === 'yearly')
      return (s.dayOfMonth ?? 1) === filter.dayOfMonth && (s.month ?? 1) === filter.month;
    return true; // daily — only hour matters
  }

  private async runScheduled(
    frequency: string,
    filter: { hour: number; dayOfWeek: number; dayOfMonth: number; month: number },
  ) {
    const candidates = await this.templateModel
      .find({ 'schedule.enabled': true, 'schedule.frequency': frequency })
      .lean();

    const templates = candidates.filter((t) => this.isDue(t.schedule, filter, frequency));
    if (!templates.length) return;

    this.logger.log(`Scheduled ${frequency} reports: ${templates.length} template(s)`);

    for (const template of templates) {
      const recipients = template.recipients ?? [];
      if (!recipients.length) {
        this.logger.warn(`Report "${template.name}" has no recipients — skipping.`);
        continue;
      }

      // dispatchToRecipients creates the run and calls runDispatchInBackground.
      // For the scheduled path we await it so reports run one after another
      // rather than all firing simultaneously (which would spike SMTP).
      try {
        await this.reportsService.dispatchToRecipients(
          template as ReportTemplate,
          recipients,
          frequency,
        );
      } catch (err) {
        this.logger.error(`Scheduled dispatch failed for "${template.name}"`, err as Error);
      }
    }
  }
}
