import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  REPORT_QUEUE,
  REPORT_DISPATCH_JOB,
  ReportDispatchJobData,
} from './report-queue.constants';
import {
  ReportTemplate,
  ReportTemplateDocument,
  ReportRecipient,
  ReportBlocklistEntry,
  ReportGrant,
  ReportRecipientDataFilter,
  ReportDataRecipientsConfig,
  ReportPerRecipientUrlConfig,
} from './schemas/report-template.schema';
import { ReportRun, ReportRunDocument } from './schemas/report-run.schema';
import {
  ReportDeliveryLog,
  ReportDeliveryLogDocument,
  ReportDeliveryStatus,
} from './schemas/report-delivery-log.schema';
import {
  AddBlocklistEntryDto,
  AddGrantDto,
  CreateReportTemplateDto,
  FetchDatasourceDto,
  UpdateReportTemplateDto,
} from './dto/report.dto';
import { ReportDataService, WidgetData } from './report-data.service';
import { ReportGeneratorService } from './report-generator.service';
import { EmailService } from '../notifications/email.service';
import { User, UserDocument } from '../users/schemas/user.schema';

// ── Tuning constants (adjust for your SMTP plan) ──────────────────────────────

/** Max recipients processed in parallel per wave. Keep low to control RAM. */
const BATCH_CONCURRENCY = 5;

/**
 * Milliseconds to pause between batches.
 * At 5 emails/batch + 500 ms gap → ~10 emails/second max.
 * Raise this if your SMTP provider rate-limits you.
 */
const BATCH_DELAY_MS = 500;

/** Maximum minutes a run can stay in 'generating' before being force-failed. */
const STALE_RUN_MINUTES = 60;

// ── Internal types ────────────────────────────────────────────────────────────

interface ResolvedRecipient {
  email: string;
  userId?: string;
  filterValue?: string;
  /** Mode C: fully-resolved URL for this recipient's private data. */
  perRecipientDataUrl?: string;
  canDownload: boolean;
  formats: string[];
}

interface RecipientFilter {
  fieldPath: string;
  filterValue: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(ReportTemplate.name)
    private templateModel: Model<ReportTemplateDocument>,
    @InjectModel(ReportRun.name)
    private runModel: Model<ReportRunDocument>,
    @InjectModel(ReportDeliveryLog.name)
    private deliveryLogModel: Model<ReportDeliveryLogDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private dataService: ReportDataService,
    private generator: ReportGeneratorService,
    private email: EmailService,
    // Optional — only injected when REDIS_URL is configured and BullModule is registered.
    // Falls back to setImmediate-based dispatch when absent.
    @Optional() @InjectQueue(REPORT_QUEUE) private readonly reportQueue: Queue | undefined,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async create(ownerId: string, dto: CreateReportTemplateDto) {
    const doc = await this.templateModel.create({
      ...dto,
      ownerId: new Types.ObjectId(ownerId),
    });
    return doc.toObject();
  }

  async list(userId: string) {
    const uid = new Types.ObjectId(userId);
    const user = await this.userModel.findById(uid).lean();
    const userRole = (user as any)?.role as string | undefined;
    const orClauses: object[] = [
      { ownerId: uid },
      { 'recipients.userId': uid },
      { 'grants.userId': uid },
    ];
    if (userRole) orClauses.push({ 'grants.role': userRole });
    return this.templateModel.find({ $or: orClauses }).lean();
  }

  async byId(userId: string, id: string) {
    const doc = await this.templateModel.findById(id).lean();
    if (!doc) throw new NotFoundException();
    const isOwner     = String(doc.ownerId) === userId;
    const isRecipient = (doc.recipients ?? []).some((r) => String(r.userId) === userId);
    const hasGrant    = ((doc as any).grants ?? []).some((g: ReportGrant) => String(g.userId) === userId);
    if (!isOwner && !isRecipient && !hasGrant) throw new ForbiddenException();
    return doc;
  }

  /** Clone a report. The copy belongs to the caller; schedule/recipients/grants are cleared. */
  async duplicate(userId: string, id: string) {
    const doc = await this.byId(userId, id); // enforces access
    const copy = await this.templateModel.create({
      ownerId:      new Types.ObjectId(userId),
      name:         `${doc.name} (Copy)`,
      description:  doc.description,
      thumbnail:    doc.thumbnail,
      pageSize:     doc.pageSize,
      orientation:  doc.orientation,
      background:   doc.background,
      elements:     doc.elements,
      pages:        doc.pages,
      groups:       doc.groups,
      margins:      doc.margins,
      header:       doc.header,
      footer:       doc.footer,
      schedule:     { enabled: false, frequency: 'monthly', hour: 8 },
      recipients:   [],
      dataRecipientsConfig:   { enabled: false, emailField: '', nameField: '', dataPath: '', url: '' },
      recipientDataFilter:    { enabled: false, fieldPath: '' },
      perRecipientUrlConfig:  { enabled: false, listUrl: '', listDataPath: '', idField: 'id', emailField: 'email', nameField: '', dataUrlTemplate: '' },
      blocklist:    [],
      permissions:  doc.permissions,
      isTemplate:   false,
      grants:       [],
    });
    return copy.toObject();
  }

  async update(ownerId: string, id: string, dto: UpdateReportTemplateDto) {
    const doc = await this.templateModel.findById(id).lean();
    if (!doc) throw new NotFoundException();
    if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();
    return this.templateModel.findByIdAndUpdate(id, { $set: dto }, { new: true }).lean();
  }

  async remove(ownerId: string, id: string) {
    const doc = await this.templateModel.findById(id).lean();
    if (!doc) throw new NotFoundException();
    if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();
    await this.templateModel.findByIdAndDelete(id);
    await this.runModel.deleteMany({ templateId: new Types.ObjectId(id) });
    await this.deliveryLogModel.deleteMany({ templateId: new Types.ObjectId(id) });
  }

  // ── Blocklist management ──────────────────────────────────────────────────

  async addBlocklistEntry(
    ownerId: string,
    templateId: string,
    dto: AddBlocklistEntryDto,
  ): Promise<ReportBlocklistEntry> {
    const doc = await this.templateModel.findById(templateId).lean();
    if (!doc) throw new NotFoundException();
    if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();

    const entry: ReportBlocklistEntry = {
      id: randomUUID(),
      email: dto.email,
      userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
      reason: dto.reason ?? '',
      addedAt: new Date().toISOString(),
    };

    await this.templateModel.findByIdAndUpdate(templateId, {
      $push: { blocklist: entry },
    });
    return entry;
  }

  async removeBlocklistEntry(ownerId: string, templateId: string, entryId: string) {
    const doc = await this.templateModel.findById(templateId).lean();
    if (!doc) throw new NotFoundException();
    if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();
    await this.templateModel.findByIdAndUpdate(templateId, {
      $pull: { blocklist: { id: entryId } },
    });
  }

  // ── Access grants ─────────────────────────────────────────────────────────

  async addGrant(ownerId: string, templateId: string, dto: AddGrantDto): Promise<ReportGrant> {
    const doc = await this.templateModel.findById(templateId).lean();
    if (!doc) throw new NotFoundException();
    if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();

    const grant: ReportGrant = {
      id: randomUUID(),
      userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
      role: dto.role,
      level: dto.level,
    };
    await this.templateModel.findByIdAndUpdate(templateId, { $push: { grants: grant } });
    return grant;
  }

  async removeGrant(ownerId: string, templateId: string, grantId: string) {
    const doc = await this.templateModel.findById(templateId).lean();
    if (!doc) throw new NotFoundException();
    if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();
    await this.templateModel.findByIdAndUpdate(templateId, { $pull: { grants: { id: grantId } } });
  }

  // ── Widget data ───────────────────────────────────────────────────────────

  async getAllWidgetData() {
    return this.dataService.getAllData();
  }

  // ── Run history ───────────────────────────────────────────────────────────

  async listRuns(userId: string, templateId: string) {
    await this.byId(userId, templateId);
    return this.runModel
      .find({ templateId: new Types.ObjectId(templateId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  }

  /**
   * Paginated delivery log for a single run.
   * GET /reports/:id/runs/:runId/deliveries?page=0&limit=50
   */
  async listDeliveries(
    userId: string,
    templateId: string,
    runId: string,
    page = 0,
    limit = 50,
  ) {
    await this.byId(userId, templateId);
    const skip = page * limit;
    const [items, total] = await Promise.all([
      this.deliveryLogModel
        .find({ runId: new Types.ObjectId(runId) })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.deliveryLogModel.countDocuments({ runId: new Types.ObjectId(runId) }),
    ]);
    return { items, total, page, limit };
  }

  // ── Trigger run (generate PDF only, no email) ─────────────────────────────

  async triggerRun(userId: string, templateId: string) {
    const template = await this.byId(userId, templateId);
    const run = await this.runModel.create({
      templateId: new Types.ObjectId(templateId),
      triggeredBy: 'manual',
      status: 'generating',
    });
    try {
      const [allData, refreshed] = await Promise.all([
        this.dataService.getAllData(),
        this.refreshDatasources(template as ReportTemplate),
      ]);
      await this.generator.generatePdf(refreshed, allData);
      await this.runModel.findByIdAndUpdate(run._id, { status: 'done' });
    } catch (err) {
      await this.runModel.findByIdAndUpdate(run._id, {
        status: 'error',
        error: String((err as Error).message),
      });
      throw err;
    }
    return this.runModel.findById(run._id).lean();
  }

  // ── MAIN: async send to all recipients ───────────────────────────────────

  /**
   * Creates a ReportRun immediately and returns it (HTTP 200).
   * Actual sending runs in the background — the caller polls GET :id/runs
   * to watch successCount / failedCount update in real time.
   *
   * This decouples the HTTP response from the send duration so a 1000-
   * recipient run never times out the request.
   */
  async sendToRecipients(userId: string, templateId: string) {
    const template             = await this.byId(userId, templateId);
    const recipients           = (template.recipients ?? []) as ReportRecipient[];
    const dataRecipientsCfg    = (template.dataRecipientsConfig ?? { enabled: false, emailField: '' }) as ReportDataRecipientsConfig;
    const perRecipientUrlCfg   = (template.perRecipientUrlConfig ?? { enabled: false }) as ReportPerRecipientUrlConfig;

    // Validate Mode C
    if (perRecipientUrlCfg.enabled) {
      if (!perRecipientUrlCfg.listUrl) {
        throw new BadRequestException('"Per-Recipient URL" is enabled but List URL is not set.');
      }
      if (!perRecipientUrlCfg.dataUrlTemplate || !perRecipientUrlCfg.dataUrlTemplate.includes('{id}')) {
        throw new BadRequestException('"Per-Recipient URL" Data URL Template must contain {id} placeholder.');
      }
    }

    // Validate Mode A
    if (!perRecipientUrlCfg.enabled && !dataRecipientsCfg.enabled && !recipients.length) {
      throw new BadRequestException(
        'No recipients configured. ' +
        'Either enable "Auto-recipients from API data" and set an email field, ' +
        'or enable "Per-CPO URL mode", or add manual recipients.',
      );
    }
    if (!perRecipientUrlCfg.enabled && dataRecipientsCfg.enabled && !dataRecipientsCfg.emailField) {
      throw new BadRequestException(
        '"Auto-recipients" is enabled but no emailField is configured. ' +
        'Set the field path (e.g. "email") that contains the recipient address in each row.',
      );
    }

    // Modes A and C discover the real recipient count at dispatch time; use 0 as placeholder.
    const estimatedTotal = (dataRecipientsCfg.enabled || perRecipientUrlCfg.enabled) ? 0 : recipients.length;

    const run = await this.runModel.create({
      templateId: new Types.ObjectId(templateId),
      triggeredBy: 'manual',
      status: 'generating',
      totalRecipients: estimatedTotal,
    });

    // Enqueue in Redis (persistent, retryable) when available; fall back to
    // setImmediate (in-process, lost on crash) when Redis is not configured.
    const jobData: ReportDispatchJobData = {
      runId: run._id.toString(),
      templateId,
      frequency: 'manual',
    };
    const queued = await this.enqueueDispatch(jobData);
    if (!queued) {
      setImmediate(() => {
        void this.runDispatchInBackground(
          run._id.toString(),
          template as ReportTemplate,
          recipients,
          'manual',
        );
      });
    }

    return run.toObject();
  }

  /**
   * Background dispatch: batches recipients, generates personalised PDFs,
   * sends emails, saves each delivery result incrementally.
   *
   * Called by sendToRecipients (manual trigger) and the scheduler (cron).
   */
  async runDispatchInBackground(
    runId: string,
    template: ReportTemplate,
    recipients: ReportRecipient[],
    frequency: string,
  ): Promise<void> {
    const runObjId    = new Types.ObjectId(runId);
    const rawId = (template as unknown as { _id?: unknown })._id;
    const templateObjId = rawId ? new Types.ObjectId(String(rawId)) : undefined;

    try {
      // On BullMQ retry the run may be in 'error' status — reset it so the UI
      // shows progress again. If it somehow completed already, bail out early.
      const currentRun = await this.runModel.findById(runId).lean();
      if (!currentRun) return;
      if (currentRun.status === 'done') {
        this.logger.warn(`[${template.name}] run ${runId} already done — skipping retry`);
        return;
      }
      if (currentRun.status !== 'generating') {
        await this.runModel.findByIdAndUpdate(runId, { status: 'generating' });
      }

      const blocklist            = (template.blocklist ?? []) as ReportBlocklistEntry[];
      const dataRecipientsCfg    = (template.dataRecipientsConfig ?? { enabled: false, emailField: '' }) as ReportDataRecipientsConfig;
      const manualDataFilter     = (template.recipientDataFilter ?? { enabled: false, fieldPath: '' }) as ReportRecipientDataFilter;
      const perRecipientUrlCfg   = (template.perRecipientUrlConfig ?? { enabled: false }) as ReportPerRecipientUrlConfig;

      // Step 1: pre-fetch all unique API URLs into memory ONCE (shared for all recipients).
      // Skipped in Mode C — each recipient fetches their own URL individually.
      const urlCache = perRecipientUrlCfg.enabled
        ? new Map<string, unknown>()
        : await this.prefetchUrlCache(template);

      // Step 2: load internal app data once
      const allData = await this.dataService.getAllData();

      // ── Resolve recipients ──────────────────────────────────────────────────
      // Mode A — Auto: extract email addresses directly from the API JSON data.
      //   Recipients = every row in the fetched array that has a valid email field.
      //   Filter     = automatic (row where emailField === recipient email).
      //
      // Mode B — Manual: use the template.recipients[] list as configured.
      //   Filter     = controlled by template.recipientDataFilter.
      //
      // Mode C — Per-Recipient URL: fetch a list of CPOs from listUrl, then build
      //   a per-CPO resolved URL (dataUrlTemplate with {id} substituted). Each
      //   recipient's PDF is generated from their own dedicated dataset.

      let resolved: ResolvedRecipient[];
      let effectiveDataFilter: ReportRecipientDataFilter;

      if (perRecipientUrlCfg.enabled && perRecipientUrlCfg.listUrl && perRecipientUrlCfg.dataUrlTemplate) {
        // ── MODE C: per-recipient URL ─────────────────────────────────────
        resolved = await this.resolvePerRecipientUrlRecipients(perRecipientUrlCfg);

        if (!resolved.length) {
          await this.runModel.findByIdAndUpdate(runId, {
            status: 'error',
            error:
              `No CPOs found at list URL. ` +
              `Check that listUrl is reachable and emailField="${perRecipientUrlCfg.emailField}" exists in each row.`,
          });
          return;
        }

        await this.runModel.findByIdAndUpdate(runId, { totalRecipients: resolved.length });
        effectiveDataFilter = { enabled: false, fieldPath: '' };

        this.logger.log(
          `[${template.name}] PER-RECIPIENT URL: found ${resolved.length} CPO(s)`,
        );
      } else if (dataRecipientsCfg.enabled && dataRecipientsCfg.emailField) {
        // ── MODE A: auto-recipients from API data ─────────────────────────
        resolved = await this.resolveDataRecipients(dataRecipientsCfg, urlCache, template);

        if (!resolved.length) {
          await this.runModel.findByIdAndUpdate(runId, {
            status: 'error',
            error:
              `No email addresses found in API data. ` +
              `Check that emailField="${dataRecipientsCfg.emailField}" exists in every row ` +
              `and the API URL is reachable.`,
          });
          return;
        }

        await this.runModel.findByIdAndUpdate(runId, { totalRecipients: resolved.length });
        effectiveDataFilter = { enabled: true, fieldPath: dataRecipientsCfg.emailField };

        this.logger.log(
          `[${template.name}] AUTO-recipients: found ${resolved.length} email(s) from API data`,
        );
      } else {
        // ── MODE B: manual recipients list ───────────────────────────────
        resolved = await this.resolveRecipientsWithDetails(recipients);
        effectiveDataFilter = manualDataFilter;
      }

      // Step 3: process in batches to cap RAM and respect SMTP rate limits
      const batches = chunkArray(resolved, BATCH_CONCURRENCY);

      for (const batch of batches) {
        // All recipients in one batch are processed in parallel
        await Promise.allSettled(
          batch.map((r) =>
            this.processOneRecipient(
              r,
              runId,
              runObjId,
              templateObjId,
              template,
              blocklist,
              effectiveDataFilter,
              urlCache,
              allData,
              frequency,
            ),
          ),
        );

        // Pause between batches to respect SMTP rate limits
        if (batches.indexOf(batch) < batches.length - 1) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      // Final summary counts from DB (source of truth)
      const [successCount, failedCount, blockedCount] = await Promise.all([
        this.deliveryLogModel.countDocuments({ runId: runObjId, status: 'success' }),
        this.deliveryLogModel.countDocuments({ runId: runObjId, status: 'failed'  }),
        this.deliveryLogModel.countDocuments({ runId: runObjId, status: 'blocked' }),
      ]);

      await this.runModel.findByIdAndUpdate(runId, {
        status: failedCount === resolved.length && resolved.length > 0 ? 'error' : 'done',
        successCount,
        failedCount,
        blockedCount,
        totalRecipients: resolved.length,
      });

      this.logger.log(
        `[${template.name}] dispatch complete — ` +
        `sent=${successCount} failed=${failedCount} blocked=${blockedCount}`,
      );
    } catch (err) {
      this.logger.error(`[${template.name}] dispatch crashed`, err as Error);
      await this.runModel.findByIdAndUpdate(runId, {
        status: 'error',
        error: String((err as Error).message),
      });
    }
  }

  /**
   * Process a single recipient:
   *   1. Check blocklist → save 'blocked' log and return
   *   2. Filter data for this recipient
   *   3. Generate PDF
   *   4. Send email
   *   5. Save delivery log (success or failed)
   *   6. Update run counters atomically
   *   7. Nullify PDF buffer immediately for GC
   */
  private async processOneRecipient(
    r: ResolvedRecipient,
    runId: string,
    runObjId: Types.ObjectId,
    templateObjId: Types.ObjectId | undefined,
    template: ReportTemplate,
    blocklist: ReportBlocklistEntry[],
    dataFilter: ReportRecipientDataFilter,
    urlCache: Map<string, unknown>,
    allData: unknown,
    frequency: string,
  ): Promise<void> {
    const sentAt = new Date().toISOString();
    const base = {
      runId:      runObjId,
      templateId: templateObjId,
      email:      r.email,
      userId:     r.userId ?? null,
      sentAt,
    };

    // ── Idempotency check (safe for BullMQ retries) ───────────────────────
    // If this recipient was already successfully delivered in a previous attempt,
    // skip silently so we never send the same email twice on retry.
    const alreadySent = await this.deliveryLogModel
      .findOne({ runId: runObjId, email: r.email, status: 'success' })
      .lean();
    if (alreadySent) {
      this.logger.debug(`[report] ${template.name} → skip (already delivered) ${r.email}`);
      return;
    }

    // ── Blocklist check ────────────────────────────────────────────────────
    if (this.isBlocked(r.email, r.userId, blocklist)) {
      await this.deliveryLogModel.create({ ...base, status: 'blocked', filteredRows: null });
      await this.runModel.findByIdAndUpdate(runId, { $inc: { blockedCount: 1 } });
      this.logger.log(`[report] ${template.name} → BLOCKED ${r.email}`);
      return;
    }

    // ── Per-recipient data filter ──────────────────────────────────────────
    const filter: RecipientFilter | null =
      dataFilter.enabled && r.filterValue
        ? { fieldPath: dataFilter.fieldPath, filterValue: r.filterValue }
        : null;

    let status: ReportDeliveryStatus = 'success';
    let errorMsg: string | null = null;
    let filteredRows: number | null = null;

    try {
      // Mode C: fetch this CPO's dedicated URL and inject as override data
      let overrideData: unknown | null = null;
      if (r.perRecipientDataUrl) {
        const normalizedUrl = normalizeLocalUrl(r.perRecipientDataUrl);
        try {
          validateExternalUrl(normalizedUrl);
          const res = await fetch(normalizedUrl, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            overrideData = await res.json();
          }
        } catch (err) {
          this.logger.warn(`[report] Failed to fetch per-recipient URL ${normalizedUrl}: ${(err as Error).message}`);
        }
      }

      const refreshed = await this.refreshDatasourcesWithCache(template, filter, urlCache, overrideData);

      // Count filtered rows for audit trail
      filteredRows = filter
        ? this.countFilteredRows(template, urlCache, filter) ?? null
        : null;

      // Generate PDF — buffer is local; gets GC'd as soon as we send
      let pdfBuffer: Buffer | null = await this.generator.generatePdf(
        refreshed,
        allData as Record<string, WidgetData>,
      );

      await this.email.sendReportEmail({
        templateName: template.name,
        frequency,
        pdfBuffer,
        recipientEmails: [r.email],
      });

      // Explicit null to help GC release the buffer memory
      pdfBuffer = null;

      this.logger.log(
        `[report] ${template.name} → OK ${r.email}` +
        (filteredRows != null ? ` (${filteredRows} rows)` : ''),
      );
    } catch (err) {
      status   = 'failed';
      errorMsg = (err as Error).message;
      this.logger.error(`[report] ${template.name} → FAIL ${r.email}: ${errorMsg}`);
    }

    // ── Persist result immediately (not at end of batch) ──────────────────
    await this.deliveryLogModel.create({
      ...base,
      status,
      error: errorMsg,
      filteredRows,
    });

    // Atomic increment — safe for concurrent workers
    await this.runModel.findByIdAndUpdate(runId, {
      $inc: { [status === 'success' ? 'successCount' : 'failedCount']: 1 },
    });
  }

  // ── Legacy test-email (still supported) ───────────────────────────────────

  async sendTestEmail(userId: string, templateId: string): Promise<{ sent: number; queued: boolean }> {
    const template          = await this.byId(userId, templateId);
    const recipients        = (template.recipients ?? []) as ReportRecipient[];
    const dataRecipientsCfg = (template.dataRecipientsConfig ?? { enabled: false, emailField: '' }) as ReportDataRecipientsConfig;

    if (!dataRecipientsCfg.enabled && !recipients.length) {
      throw new BadRequestException(
        'No recipients configured. Add recipients or enable Auto-recipients first.',
      );
    }

    const run = await this.runModel.create({
      templateId: new Types.ObjectId(templateId),
      triggeredBy: 'manual',
      status: 'generating',
      totalRecipients: dataRecipientsCfg.enabled ? 0 : recipients.length,
    });

    setImmediate(() => {
      void this.runDispatchInBackground(
        run._id.toString(),
        template as ReportTemplate,
        recipients,
        'test',
      );
    });

    return { sent: 0, queued: true };
  }

  // ── PDF preview / download ────────────────────────────────────────────────

  async generatePreview(
    userId: string,
    templateId: string,
    recipientFilter: RecipientFilter | null = null,
    cpoId: string | null = null,
  ): Promise<Buffer> {
    const template = await this.byId(userId, templateId);
    let tpl = template as ReportTemplate;
    const perRecipientUrlCfg = (tpl.perRecipientUrlConfig ?? { enabled: false }) as ReportPerRecipientUrlConfig;

    let overrideData: unknown | null = null;

    if (cpoId) {
      // Strategy 1: Per-CPO URL Mode — fetch dataUrlTemplate with {id} replaced
      if (perRecipientUrlCfg.enabled && perRecipientUrlCfg.dataUrlTemplate) {
        const concreteUrl = normalizeLocalUrl(
          perRecipientUrlCfg.dataUrlTemplate.replace('{id}', cpoId),
        );
        try {
          validateExternalUrl(concreteUrl);
          const res = await fetch(concreteUrl, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            overrideData = await res.json();
            this.logger.log(`[preview] Per-CPO Mode fetch OK: ${concreteUrl}`);
          }
        } catch (err) {
          this.logger.warn(`[preview] Per-CPO Mode fetch failed: ${(err as Error).message}`);
        }
      }

      // Strategy 2 (fallback): replace ?id=xxx in every element URL automatically.
      // Works even when Per-CPO URL Mode is not configured — the user just enters
      // the CPO ID and all element URLs have their id query param swapped.
      if (overrideData === null) {
        tpl = {
          ...tpl,
          elements: (tpl.elements ?? []).map((el) => {
            const p = el.props as Record<string, unknown>;
            const ds  = p.dataSource      as Record<string, unknown> | undefined;
            const tds = p.textDataSource  as Record<string, unknown> | undefined;
            const newProps = { ...p };
            if (ds?.url) {
              const newUrl = normalizeLocalUrl(replaceIdInUrl(ds.url as string, cpoId));
              newProps.dataSource = { ...ds, url: newUrl };
            }
            if (tds?.url) {
              const newUrl = normalizeLocalUrl(replaceIdInUrl(tds.url as string, cpoId));
              newProps.textDataSource = { ...tds, url: newUrl };
            }
            return { ...el, props: newProps };
          }),
        } as ReportTemplate;
        this.logger.log(`[preview] Fallback: replaced id in element URLs → cpoId=${cpoId}`);
      }
    }

    const [allData, refreshed] = await Promise.all([
      this.dataService.getAllData(),
      this.refreshDatasources(tpl, recipientFilter, new Map(), overrideData),
    ]);
    return this.generator.generatePdf(refreshed, allData as Record<string, WidgetData>);
  }

  // ── Stale run cleanup (called by scheduler) ───────────────────────────────

  /**
   * Mark runs stuck in 'generating' for more than STALE_RUN_MINUTES as 'error'.
   * Protects against crashes that leave runs in an indefinite state.
   */
  async cleanupStaleRuns(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000);
    const result = await this.runModel.updateMany(
      { status: 'generating', createdAt: { $lt: cutoff } },
      { $set: { status: 'error', error: 'Run timed out (server restart or crash)' } },
    );
    if (result.modifiedCount > 0) {
      this.logger.warn(`Cleaned up ${result.modifiedCount} stale run(s)`);
    }
    return result.modifiedCount;
  }

  // ── CPO list test fetch (public — used by recipients panel "Test" button) ──

  /**
   * Fetch the CPO list URL and return a count + preview of the first 5 rows.
   * Used by the frontend "Fetch CPO List" button so the user can verify their config.
   */
  async fetchCpoList(dto: {
    listUrl: string;
    listDataPath: string;
    idField: string;
    emailField: string;
    nameField?: string;
  }): Promise<{ count: number; preview: Record<string, unknown>[] }> {
    const listUrl = normalizeLocalUrl(dto.listUrl);
    validateExternalUrl(listUrl);
    let res: Response;
    try {
      res = await fetch(listUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      throw new BadRequestException(`Could not reach the URL: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new BadRequestException(`CPO list URL responded with status ${res.status}`);
    }
    let rawData: unknown;
    try { rawData = await res.json(); }
    catch { throw new BadRequestException('Response is not valid JSON'); }

    const rows = extractAtPath(rawData, dto.listDataPath ?? '');
    const preview = rows.slice(0, 5).map((row) => ({
      id:    getNestedValue(row, dto.idField    ?? 'id')    ?? null,
      email: getNestedValue(row, dto.emailField ?? 'email') ?? null,
      name:  dto.nameField ? getNestedValue(row, dto.nameField) ?? null : null,
    })) as Record<string, unknown>[];

    return { count: rows.length, preview };
  }

  // ── Datasource fetch (public — used by controller) ────────────────────────

  async fetchDatasource(dto: FetchDatasourceDto) {
    const { url, method, headers = {}, body } = dto;
    validateExternalUrl(url);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(method === 'POST' && body ? { body } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new BadRequestException(`Could not reach the URL: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new BadRequestException(`External API responded with status ${res.status}`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new BadRequestException('Response is not valid JSON');
    }
    return { data, detected: detectArrayPaths(data) };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async resolveRecipientsWithDetails(
    recipients: ReportRecipient[],
  ): Promise<ResolvedRecipient[]> {
    const resolved: ResolvedRecipient[] = [];

    for (const r of recipients) {
      if (r.email) {
        resolved.push({
          email: r.email,
          filterValue: r.filterValue,
          canDownload: r.canDownload,
          formats: r.formats,
        });
      }
    }

    const userRecipients = recipients.filter((r) => r.userId && !r.email);
    if (userRecipients.length) {
      const ids = userRecipients.map((r) => r.userId as Types.ObjectId);
      const users = await this.userModel
        .find({ _id: { $in: ids }, blocked: { $ne: true } })
        .select('_id email')
        .lean();

      for (const r of userRecipients) {
        const user = users.find((u) => String(u._id) === String(r.userId));
        if (user?.email) {
          resolved.push({
            email: user.email,
            userId: String(r.userId),
            filterValue: r.filterValue,
            canDownload: r.canDownload,
            formats: r.formats,
          });
        }
      }
    }

    // Deduplicate by email
    const seen = new Set<string>();
    return resolved.filter((r) => {
      const k = r.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * Auto-recipients mode: scan the API JSON array and build a recipient list
   * from every distinct, valid email found at `cfg.emailField`.
   *
   * For each email:  filterValue = the raw email string from that row
   *                  (used later to filter the array to that single row's data)
   *
   * Uses the pre-fetched urlCache so the API is not called again.
   */
  private async resolveDataRecipients(
    cfg: ReportDataRecipientsConfig,
    urlCache: Map<string, unknown>,
    template: ReportTemplate,
  ): Promise<ResolvedRecipient[]> {
    // Decide which URL to use for recipient extraction
    let rawData: unknown = null;
    const dataPath = cfg.dataPath ?? '';

    if (cfg.url) {
      // Dedicated recipient-list URL
      rawData = urlCache.get(cfg.url);
      if (!rawData) {
        try {
          validateExternalUrl(cfg.url);
          const res = await fetch(cfg.url, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            rawData = await res.json();
            urlCache.set(cfg.url, rawData);
          }
        } catch {
          rawData = null;
        }
      }
    } else {
      // Fall back to the first dataSource URL found in any element
      for (const el of template.elements ?? []) {
        const p  = el.props as Record<string, unknown>;
        const ds = p.dataSource as Record<string, unknown> | undefined;
        if (ds?.url) {
          rawData = urlCache.get(ds.url as string) ?? null;
          if (rawData) break;
        }
        const tds = p.textDataSource as Record<string, unknown> | undefined;
        if (tds?.url) {
          rawData = urlCache.get(tds.url as string) ?? null;
          if (rawData) break;
        }
      }
    }

    if (!rawData) return [];

    // Extract the array of rows
    const rows = extractAtPath(rawData, dataPath);
    if (!rows.length) return [];

    const seen = new Set<string>();
    const recipients: ResolvedRecipient[] = [];

    for (const row of rows) {
      const rawEmail = getNestedValue(row, cfg.emailField);
      if (rawEmail == null) continue;

      const email = String(rawEmail).trim().toLowerCase();
      if (!email || !email.includes('@') || !email.includes('.')) continue;
      if (seen.has(email)) continue;
      seen.add(email);

      recipients.push({
        email,
        // filterValue uses the original casing from the data (important for matching)
        filterValue: String(rawEmail).trim(),
        canDownload: true,
        formats: ['pdf'],
      });
    }

    return recipients;
  }

  /**
   * Mode C — Per-Recipient URL:
   * Fetch the CPO list from `cfg.listUrl`, extract id + email from every row,
   * then build a ResolvedRecipient with `perRecipientDataUrl` set to
   * `cfg.dataUrlTemplate.replace('{id}', cpoId)`.
   */
  private async resolvePerRecipientUrlRecipients(
    cfg: ReportPerRecipientUrlConfig,
  ): Promise<ResolvedRecipient[]> {
    let rawData: unknown = null;
    const listUrl = normalizeLocalUrl(cfg.listUrl);
    try {
      validateExternalUrl(listUrl);
      const res = await fetch(listUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) rawData = await res.json();
    } catch (err) {
      this.logger.warn(`[report] Failed to fetch CPO list URL ${listUrl}: ${(err as Error).message}`);
      return [];
    }

    if (!rawData) return [];
    const rows = extractAtPath(rawData, cfg.listDataPath ?? '');
    if (!rows.length) return [];

    const seen = new Set<string>();
    const recipients: ResolvedRecipient[] = [];

    for (const row of rows) {
      const rawEmail = getNestedValue(row, cfg.emailField);
      const rawId    = getNestedValue(row, cfg.idField ?? 'id');
      if (rawEmail == null || rawId == null) continue;

      const email = String(rawEmail).trim().toLowerCase();
      if (!email || !email.includes('@') || !email.includes('.')) continue;
      if (seen.has(email)) continue;
      seen.add(email);

      const cpoId = String(rawId).trim();
      const perRecipientDataUrl = cfg.dataUrlTemplate.replace('{id}', cpoId);

      recipients.push({
        email,
        filterValue: email,
        perRecipientDataUrl,
        canDownload: true,
        formats: ['pdf'],
      });
    }

    return recipients;
  }

  private isBlocked(
    email: string | undefined,
    userId: string | undefined,
    blocklist: ReportBlocklistEntry[],
  ): boolean {
    return blocklist.some(
      (b) =>
        (b.email && email && b.email.toLowerCase() === email.toLowerCase()) ||
        (b.userId && userId && String(b.userId) === userId),
    );
  }

  private async prefetchUrlCache(template: ReportTemplate): Promise<Map<string, unknown>> {
    const cache = new Map<string, unknown>();
    const urls  = new Set<string>();

    for (const el of template.elements ?? []) {
      const p = el.props as Record<string, unknown>;
      const dsUrl  = (p.dataSource  as Record<string, unknown> | undefined)?.url  as string | undefined;
      const tdsUrl = (p.textDataSource as Record<string, unknown> | undefined)?.url as string | undefined;
      if (dsUrl)  urls.add(dsUrl);
      if (tdsUrl) urls.add(tdsUrl);
    }

    await Promise.allSettled(
      [...urls].map(async (url) => {
        try {
          validateExternalUrl(url);
          const res = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'Content-Type': 'application/json' },
          });
          if (res.ok) cache.set(url, await res.json());
        } catch {
          // URL absent → element falls back to existing props
        }
      }),
    );

    return cache;
  }

  private countFilteredRows(
    template: ReportTemplate,
    urlCache: Map<string, unknown>,
    filter: RecipientFilter,
  ): number | undefined {
    for (const el of template.elements ?? []) {
      const p  = el.props as Record<string, unknown>;
      const ds = p.dataSource as Record<string, unknown> | undefined;
      if (!ds?.url) continue;
      const raw = urlCache.get(ds.url as string);
      if (!raw) continue;
      const rows = extractAtPath(raw, (ds.dataPath as string) ?? '');
      return rows.filter(
        (r) => String(getNestedValue(r, filter.fieldPath) ?? '') === filter.filterValue,
      ).length;
    }
    return undefined;
  }

  private async refreshDatasourcesWithCache(
    template: ReportTemplate,
    recipientFilter: RecipientFilter | null,
    urlCache: Map<string, unknown>,
    overrideData: unknown | null = null,
  ): Promise<ReportTemplate> {
    return this.refreshDatasources(template, recipientFilter, urlCache, overrideData);
  }

  private async refreshDatasources(
    template: ReportTemplate,
    recipientFilter: RecipientFilter | null = null,
    urlCache: Map<string, unknown> = new Map(),
    overrideData: unknown | null = null,
  ): Promise<ReportTemplate> {
    const elements = template.elements ?? [];
    const hasDs = elements.some((el) => {
      const p = el.props as Record<string, unknown>;
      return p?.dataSource || p?.textDataSource;
    });
    if (!hasDs) return template;

    const fetchRaw = async (
      url: string,
      method: 'GET' | 'POST' = 'GET',
      headers?: Record<string, string>,
      body?: string,
    ): Promise<unknown> => {
      // Mode C: override ALL element data sources with the per-recipient dataset
      if (overrideData !== null) return overrideData;
      if (urlCache.has(url)) return urlCache.get(url);
      const result = await this.fetchDatasource({ url, method, headers, body });
      urlCache.set(url, result.data);
      return result.data;
    };

    const refreshed = await Promise.all(
      elements.map(async (el) => {
        const p = el.props as Record<string, unknown>;

        // ── text / heading with textDataSource ────────────────────────────
        if ((el.type === 'text' || el.type === 'heading') && p.textDataSource) {
          const tds = p.textDataSource as Record<string, unknown>;
          if (!tds?.url) return el;
          try {
            const rawData = await fetchRaw(
              tds.url as string,
              (tds.method as 'GET' | 'POST') ?? 'GET',
              tds.headers as Record<string, string> | undefined,
            );
            const tmpl = (tds.template as string) ?? '{value}';
            let values: (string | number)[] = [];

            if (tds.sourceMode === 'root') {
              const rootObj  = rawData as Record<string, unknown>;
              const fieldKey = tds.rootField as string | undefined;
              if (fieldKey && typeof rootObj === 'object' && rootObj !== null) {
                const v = rootObj[fieldKey];
                if (typeof v === 'string' || typeof v === 'number') values = [v];
              }
            } else {
              const allRows = extractAtPath(rawData, (tds.dataPath as string) ?? '');
              const rows    = applyFilter(allRows, recipientFilter);
              type AggDefRaw = { fieldKey: string; aggregation: string };
              const aggDefs: AggDefRaw[] =
                (tds.aggDefs as AggDefRaw[] | undefined) ??
                (tds.fieldKey
                  ? [{ fieldKey: tds.fieldKey as string, aggregation: (tds.aggregation as string) ?? 'first' }]
                  : []);
              if (rows.length > 0) {
                values = aggDefs
                  .filter((d) => d.fieldKey)
                  .map((d) => this.applyAgg(rows, d.fieldKey, d.aggregation));
              }
            }

            if (values.length > 0) {
              let content = tmpl;
              values.forEach((v, i) => {
                content = content.replace(new RegExp(`\\{value${i}\\}`, 'g'), String(v));
              });
              content = content.replace(/\{value\}/g, String(values[0]));
              return { ...el, props: { ...p, content } };
            }
          } catch {
            // keep existing content
          }
          return el;
        }

        // ── table / data-widget / chart with dataSource ───────────────────
        const ds = p.dataSource as Record<string, unknown> | undefined;
        if (!ds?.url) return el;
        try {
          const rawData = await fetchRaw(
            ds.url as string,
            (ds.method as 'GET' | 'POST') ?? 'GET',
            ds.headers as Record<string, string> | undefined,
          );

          const allRows = extractAtPath(rawData, (ds.dataPath as string) ?? '');
          const rows    = ds.skipFilter ? allRows : applyFilter(allRows, recipientFilter);
          const newProps = { ...p };

          if (el.type === 'table') {
            const defs = (ds.columnDefs as { key: string; label: string }[]) ?? [];
            // Preserve user-configured p.columns (order / deleted columns) — only fall back
            // to columnDefs labels when no columns have been configured yet.
            if (!(p.columns as string[] | undefined)?.length) {
              newProps.columns = defs.map((c) => c.label);
            }
            newProps.rows    = rows.slice(0, 500).map((row) => {
              const mapped: Record<string, string> = {};
              defs.forEach(({ key, label }) => {
                const v = getNestedValue(row, key);
                mapped[label] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
              });
              return mapped;
            });
          } else if (el.type === 'data-widget') {
            if (ds.widgetMode === 'kpi') {
              const raw = Number(this.applyAgg(rows, ds.valueKey as string, ds.aggregation as string));
              newProps.kpiValue = this.fmtNum(raw, ds.numberFormat as string, (ds.currencySymbol as string) ?? '$');
              newProps.kpiLabel = p.kpiLabel;
            } else {
              const PALETTE = ['#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4', '#ec4899'];
              newProps.seriesData = rows.slice(0, 20).map((row, i) => ({
                name:  ds.nameKey ? String(getNestedValue(row, ds.nameKey as string) ?? '') : String(i),
                value: Number(getNestedValue(row, ds.valueKey as string) ?? 0),
                color: PALETTE[i % PALETTE.length],
              }));
            }
          } else if (el.type === 'chart') {
            const PALETTE = ['#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4', '#ec4899'];

            // expandNested: flatten a child array out of each filtered row.
            // e.g. expandNested="charger_locations" turns [{ cpo, charger_locations:[...] }]
            // into [loc1, loc2, loc3, ...] scoped to the filtered CPO.
            const chartRows = ds.expandNested
              ? rows.flatMap((row) => {
                  const nested = row[ds.expandNested as string];
                  return Array.isArray(nested) ? (nested as Record<string, unknown>[]) : [];
                })
              : rows;

            newProps.seriesData = chartRows.slice(0, 50).map((row, i) => ({
              name:   String(getNestedValue(row, ds.nameKey as string) ?? ''),
              value:  ds.valueExpr
                        ? evalSimpleExpr(row, ds.valueExpr as string)
                        : Number(getNestedValue(row, ds.valueKey as string) ?? 0),
              value2: ds.value2Key ? Number(getNestedValue(row, ds.value2Key as string) ?? 0) : undefined,
              color: ds.colorKey && getNestedValue(row, ds.colorKey as string)
                ? String(getNestedValue(row, ds.colorKey as string))
                : PALETTE[i % PALETTE.length],
            }));
          }

          return { ...el, props: newProps };
        } catch {
          return el;
        }
      }),
    );

    return { ...template, elements: refreshed } as ReportTemplate;
  }

  // ── Aggregation / formatting helpers ─────────────────────────────────────

  /**
   * Used by the scheduler — creates a run then awaits full dispatch
   * (synchronous for cron, so scheduled reports run one after another).
   * Supports both auto-recipients and manual-recipients modes.
   */
  async dispatchToRecipients(
    template: ReportTemplate,
    recipients: ReportRecipient[],
    frequency: string,
  ): Promise<void> {
    const dataRecipientsCfg = (template.dataRecipientsConfig ?? { enabled: false, emailField: '' }) as ReportDataRecipientsConfig;
    const estimatedTotal = dataRecipientsCfg.enabled ? 0 : recipients.length;

    const run = await this.runModel.create({
      templateId: new Types.ObjectId(String((template as any)._id)),
      triggeredBy: 'schedule',
      status: 'generating',
      totalRecipients: estimatedTotal,
    });

    // When Redis is available: enqueue (worker concurrency=1 ensures sequential runs).
    // When absent: await directly so the cron still runs one template at a time.
    const jobData: ReportDispatchJobData = {
      runId: run._id.toString(),
      templateId: String((template as any)._id),
      frequency,
    };
    const queued = await this.enqueueDispatch(jobData);
    if (!queued) {
      await this.runDispatchInBackground(run._id.toString(), template, recipients, frequency);
    }
  }

  /**
   * Pushes a dispatch job to the BullMQ queue with 3 retry attempts and
   * exponential back-off (30 s → 60 s → 120 s).
   * Returns true when queued, false when Redis is not configured (caller
   * should fall back to setImmediate).
   */
  private async enqueueDispatch(data: ReportDispatchJobData): Promise<boolean> {
    if (!this.reportQueue) return false;
    await this.reportQueue.add(REPORT_DISPATCH_JOB, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 50  },
    });
    this.logger.log(`[queue] enqueued run=${data.runId} template=${data.templateId}`);
    return true;
  }

  private applyAgg(rows: Record<string, unknown>[], valueKey: string, agg?: string): string | number {
    if (!rows.length) return 0;
    // 'first' and 'last' return the raw value — supports string fields like cpo_name, status
    if (!agg || agg === 'first') return (getNestedValue(rows[0], valueKey) as string | number | undefined) ?? 0;
    if (agg === 'last')          return (getNestedValue(rows[rows.length - 1], valueKey) as string | number | undefined) ?? 0;
    // Numeric aggregations
    const vals = rows
      .map((r) => { const v = getNestedValue(r, valueKey); return typeof v === 'number' ? v : parseFloat(String(v ?? '')); })
      .filter((v) => !isNaN(v));
    switch (agg) {
      case 'count': return rows.length;
      case 'sum':   return vals.reduce((a, b) => a + b, 0);
      case 'avg':   return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      case 'min':   return vals.length ? Math.min(...vals) : 0;
      case 'max':   return vals.length ? Math.max(...vals) : 0;
      default:      return vals[0] ?? 0;
    }
  }

  private fmtNum(value: number, format?: string, symbol = '$'): string {
    if (format === 'currency')
      return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (format === 'percent')
      return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    if (format === 'compact') {
      if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
      if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
      if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    }
    if (format === 'number') return value.toLocaleString('en-US');
    return String(value);
  }
}

// ── Module-level pure helpers ─────────────────────────────────────────────────

function applyFilter(
  rows: Record<string, unknown>[],
  filter: RecipientFilter | null,
): Record<string, unknown>[] {
  if (!filter) return rows;
  return rows.filter(
    (r) => String(getNestedValue(r, filter.fieldPath) ?? '') === filter.filterValue,
  );
}

/** Split an array into fixed-size sub-arrays. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Simple async sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Node.js fetch on Windows cannot connect to 0.0.0.0 as a client destination.
 * Replace it with 127.0.0.1 so local dev APIs are always reachable.
 */
function normalizeLocalUrl(rawUrl: string): string {
  return rawUrl.replace(/^(https?:\/\/)0\.0\.0\.0([:\/]|$)/, '$1127.0.0.1$2');
}

/**
 * Replace the value of an `id` query-param in a URL with a new CPO ID.
 * e.g. "http://api.com/cpo-reports?id=2" + "4" → "http://api.com/cpo-reports?id=4"
 * Also replaces path segments: "/api/operators/2" + "4" → "/api/operators/4"
 */
function replaceIdInUrl(url: string, newId: string): string {
  // Replace ?id=xxx or &id=xxx
  let result = url.replace(/([?&]id=)[^&#]*/g, `$1${encodeURIComponent(newId)}`);
  // If no query-param id found, try replacing last numeric/alphanumeric path segment
  if (result === url) {
    result = url.replace(/(\/)[^/?#]+([/?#]|$)(?!.*\/[^/?#]+[/?#])/, `$1${newId}$2`);
  }
  return result;
}

function validateExternalUrl(rawUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(rawUrl); }
  catch { throw new BadRequestException('Invalid URL format'); }

  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new BadRequestException('Only http and https URLs are allowed');

  // Allow localhost in development so devs can test against local API servers
  if (process.env.NODE_ENV === 'development') return;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const BLOCKED_HOSTS = ['localhost', '0.0.0.0', '::1', '0:0:0:0:0:0:0:1'];
  if (BLOCKED_HOSTS.includes(host))
    throw new BadRequestException('Requests to private or internal addresses are not allowed');

  const octs = host.split('.').map(Number);
  if (octs.length === 4 && octs.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    const [a, b] = octs;
    if (
      a === 127 || a === 10 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    ) throw new BadRequestException('Requests to private or internal addresses are not allowed');
  }
}

function extractAtPath(data: unknown, path: string): Record<string, unknown>[] {
  if (!path) return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const parts = path.split('.');
  let cur: unknown = data;
  for (let i = 0; i < parts.length; i++) {
    if (Array.isArray(cur)) {
      const unnestKey = parts[i];
      const remainingPath = parts.slice(i).join('.');
      return (cur as Record<string, unknown>[]).flatMap((item) => {
        const childRows = extractAtPath(item, remainingPath);
        // Carry non-array parent fields into every child row so location
        // fields appear alongside charger fields, etc.
        const parentFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (k !== unnestKey && !Array.isArray(v)) parentFields[k] = v;
        }
        return childRows.map((child) => ({ ...parentFields, ...child }));
      });
    }
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[parts[i]];
    } else return [];
  }
  return Array.isArray(cur) ? (cur as Record<string, unknown>[]) : [];
}

/**
 * Evaluate simple aggregate expressions on a single row object.
 * Supported forms:
 *   sumProduct(arrayKey, key1, key2)  → sum(item[key1] * item[key2]) for items in row[arrayKey]
 *   sum(arrayKey, key)                → sum(item[key]) for items in row[arrayKey]
 *   Any other string                  → Number(getNestedValue(row, expr))
 */
function evalSimpleExpr(row: Record<string, unknown>, expr: string): number {
  const spMatch = expr.match(/^sumProduct\((\w+),\s*([\w.]+),\s*([\w.]+)\)$/);
  if (spMatch) {
    const arr = (row[spMatch[1]] as Record<string, unknown>[]) ?? [];
    return arr.reduce((s, item) => s + Number(item[spMatch[2]] ?? 0) * Number(item[spMatch[3]] ?? 0), 0);
  }
  const sumMatch = expr.match(/^sum\((\w+),\s*([\w.]+)\)$/);
  if (sumMatch) {
    const arr = (row[sumMatch[1]] as Record<string, unknown>[]) ?? [];
    return arr.reduce((s, item) => s + Number(item[sumMatch[2]] ?? 0), 0);
  }
  return Number(getNestedValue(row, expr) ?? 0);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

type DetectedColumn = { key: string; type: string };
type DetectedArray  = { path: string; count: number; columns: DetectedColumn[] };

function flattenObjectKeys(
  obj: Record<string, unknown>,
  prefix = '',
  depth = 0,
  maxDepth = 6,
): DetectedColumn[] {
  if (depth > maxDepth) return [];
  const result: DetectedColumn[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && depth < maxDepth) {
      const nested = flattenObjectKeys(value as Record<string, unknown>, fullKey, depth + 1, maxDepth);
      if (nested.length > 0) { result.push(...nested); continue; }
    }
    result.push({ key: fullKey, type: Array.isArray(value) ? 'array' : typeof value });
  }
  return result;
}

function detectArrayPaths(
  node: unknown,
  path = '',
  depth = 0,
  inheritedCols: DetectedColumn[] = [],
): DetectedArray[] {
  if (depth > 5) return [];
  if (Array.isArray(node) && node.length > 0 && typeof node[0] === 'object' && node[0] !== null) {
    const merged: Record<string, unknown> = {};
    for (const item of node.slice(0, 5)) {
      if (item && typeof item === 'object' && !Array.isArray(item))
        Object.assign(merged, item as Record<string, unknown>);
    }
    const ownCols = flattenObjectKeys(merged);
    // Prepend inherited parent (non-array) columns; child keys take priority on collision
    const ownKeySet = new Set(ownCols.map((c) => c.key));
    const mergedCols = [
      ...inheritedCols.filter((c) => !ownKeySet.has(c.key)),
      ...ownCols,
    ].slice(0, 80);
    const results: DetectedArray[] = [{ path, count: node.length, columns: mergedCols }];
    // Pass non-array cols as inherited context for nested arrays at any depth
    const nextInherited = [...inheritedCols, ...ownCols.filter((c) => c.type !== 'array')];
    for (const [key, value] of Object.entries(merged)) {
      results.push(...detectArrayPaths(value, path ? `${path}.${key}` : key, depth + 1, nextInherited));
    }
    return results;
  }
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    const results: DetectedArray[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      results.push(...detectArrayPaths(value, path ? `${path}.${key}` : key, depth + 1, inheritedCols));
    }
    return results;
  }
  return [];
}
