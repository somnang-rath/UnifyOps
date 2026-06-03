import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job } from 'bullmq';
import { Model } from 'mongoose';
import {
  REPORT_QUEUE,
  ReportDispatchJobData,
} from './report-queue.constants';
import { ReportsService } from './reports.service';
import {
  ReportTemplate,
  ReportTemplateDocument,
  ReportRecipient,
} from './schemas/report-template.schema';

/**
 * BullMQ worker — processes one report-dispatch job at a time (concurrency: 1).
 *
 * Each job holds { runId, templateId, frequency }. The worker reloads the
 * template from MongoDB so the Redis payload stays small, then delegates to
 * ReportsService.runDispatchInBackground which already handles batching,
 * per-recipient PDF generation, SMTP delivery, and delivery-log persistence.
 *
 * On failure BullMQ retries the job (see attempts / backoff in enqueueDispatch).
 * runDispatchInBackground skips recipients that already have a 'success'
 * delivery log, so retries are idempotent — no duplicate emails.
 */
@Processor(REPORT_QUEUE, { concurrency: 1 })
export class ReportDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportDispatchProcessor.name);

  constructor(
    private readonly reportsService: ReportsService,
    @InjectModel(ReportTemplate.name)
    private readonly templateModel: Model<ReportTemplateDocument>,
  ) {
    super();
  }

  async process(job: Job<ReportDispatchJobData>): Promise<void> {
    const { runId, templateId, frequency } = job.data;
    this.logger.log(`[queue] job ${job.id} started — run=${runId} template=${templateId}`);

    const template = await this.templateModel.findById(templateId).lean();
    if (!template) {
      // Template was deleted after the job was enqueued — nothing to do.
      this.logger.warn(`[queue] job ${job.id} — template ${templateId} not found, aborting`);
      return;
    }

    const recipients = (template.recipients ?? []) as ReportRecipient[];
    await this.reportsService.runDispatchInBackground(
      runId,
      template as ReportTemplate,
      recipients,
      frequency,
    );

    this.logger.log(`[queue] job ${job.id} finished — run=${runId}`);
  }
}
