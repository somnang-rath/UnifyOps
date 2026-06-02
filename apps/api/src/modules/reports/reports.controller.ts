import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UsePipes,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AddBlocklistEntrySchema,
  AddBlocklistEntryDto,
  CreateReportTemplateSchema,
  UpdateReportTemplateSchema,
  FetchDatasourceSchema,
  CreateReportTemplateDto,
  UpdateReportTemplateDto,
  FetchDatasourceDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  // ── Widget / datasource ────────────────────────────────────────────────────

  @Get('widget-data')
  getWidgetData() {
    return this.svc.getAllWidgetData();
  }

  @Post('fetch-datasource')
  @UsePipes(new ZodValidationPipe(FetchDatasourceSchema))
  fetchDatasource(@Body() dto: FetchDatasourceDto) {
    return this.svc.fetchDatasource(dto);
  }

  // ── Template CRUD ─────────────────────────────────────────────────────────

  @Post()
  @UsePipes(new ZodValidationPipe(CreateReportTemplateSchema))
  create(@CurrentUser() u: { id: string }, @Body() dto: CreateReportTemplateDto) {
    return this.svc.create(u.id, dto);
  }

  @Get()
  list(@CurrentUser() u: { id: string }) {
    return this.svc.list(u.id);
  }

  @Get(':id')
  byId(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.byId(u.id, id);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateReportTemplateSchema))
  update(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateReportTemplateDto,
  ) {
    return this.svc.update(u.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.remove(u.id, id);
  }

  // ── Run / generate ────────────────────────────────────────────────────────

  /** Generate PDF (no email send). */
  @Post(':id/run')
  triggerRun(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.triggerRun(u.id, id);
  }

  /**
   * Send personalised filtered PDFs to every non-blocked recipient.
   * Records per-delivery results in ReportRun.deliveries.
   */
  @Post(':id/send')
  sendToRecipients(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.sendToRecipients(u.id, id);
  }

  /**
   * Legacy test-send — same filtering logic as /send but marks run as 'test'.
   * Returns { sent, deliveries } for quick UI feedback.
   */
  @Post(':id/send-test')
  sendTestEmail(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.sendTestEmail(u.id, id);
  }

  @Get(':id/runs')
  listRuns(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.listRuns(u.id, id);
  }

  /**
   * Paginated delivery log for one run.
   * GET /reports/:id/runs/:runId/deliveries?page=0&limit=50
   * Uses a separate collection — safe for 10,000+ recipients.
   */
  @Get(':id/runs/:runId/deliveries')
  listDeliveries(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Param('runId') runId: string,
    @Query('page') page = '0',
    @Query('limit') limit = '50',
  ) {
    return this.svc.listDeliveries(u.id, id, runId, Number(page), Number(limit));
  }

  // ── PDF preview / download ────────────────────────────────────────────────

  @Get(':id/preview')
  async preview(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Res() res: Response,
    /** Optional: filter data to a single recipient's rows for a personalised preview. */
    @Query('filterField') filterField?: string,
    @Query('filterValue') filterValue?: string,
    /** Mode C: preview a specific CPO's data by their ID. */
    @Query('cpoId') cpoId?: string,
  ) {
    const filter = filterField && filterValue ? { fieldPath: filterField, filterValue } : null;
    const pdf = await this.svc.generatePreview(u.id, id, filter, cpoId ?? null);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="preview.pdf"',
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const [pdf, template] = await Promise.all([
      this.svc.generatePreview(u.id, id),
      this.svc.byId(u.id, id),
    ]);
    const safeName = (template.name ?? 'report').replace(/[^a-z0-9\-_ ]/gi, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  // ── Per-Recipient URL helpers ─────────────────────────────────────────────

  /**
   * Fetch the CPO list URL and return count + first-5 preview.
   * Used by the "Fetch CPO List" test button in the recipients panel.
   * POST /reports/:id/fetch-cpo-list
   * Body: { listUrl, listDataPath?, idField?, emailField?, nameField? }
   */
  @Post(':id/fetch-cpo-list')
  fetchCpoList(
    @CurrentUser() _u: { id: string },
    @Body() dto: {
      listUrl: string;
      listDataPath?: string;
      idField?: string;
      emailField?: string;
      nameField?: string;
    },
  ) {
    return this.svc.fetchCpoList({
      listUrl:      dto.listUrl,
      listDataPath: dto.listDataPath ?? '',
      idField:      dto.idField      ?? 'id',
      emailField:   dto.emailField   ?? 'email',
      nameField:    dto.nameField,
    });
  }

  // ── Blocklist management ──────────────────────────────────────────────────

  /**
   * Add a user or email address to this report's send blocklist.
   * POST /reports/:id/blocklist
   * Body: { email?: string, userId?: string, reason?: string }
   */
  @Post(':id/blocklist')
  @UsePipes(new ZodValidationPipe(AddBlocklistEntrySchema))
  addBlocklistEntry(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Body() dto: AddBlocklistEntryDto,
  ) {
    return this.svc.addBlocklistEntry(u.id, id, dto);
  }

  /**
   * Remove an entry from the blocklist by its UUID.
   * DELETE /reports/:id/blocklist/:entryId
   */
  @Delete(':id/blocklist/:entryId')
  removeBlocklistEntry(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    return this.svc.removeBlocklistEntry(u.id, id, entryId);
  }
}
