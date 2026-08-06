import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IntakeService } from './intake.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  CreateIntakeFormDto,
  CreateIntakeFormSchema,
  ListFormsQuery,
  ListFormsQuerySchema,
  SubmitIntakeDto,
  SubmitIntakeSchema,
  TriageDto,
  TriageSchema,
  UpdateIntakeFormDto,
  UpdateIntakeFormSchema,
} from './dto/intake.dto';

@Controller('intake')
export class IntakeController {
  constructor(private intake: IntakeService) {}

  // ── Public (anonymous) ────────────────────────────────────────────
  // These are the only unauthenticated routes here. Throttled per-IP because
  // anyone on the internet can hit them.
  @Public()
  @Get('forms/:anchor')
  publicForm(@Param('anchor') anchor: string) {
    return this.intake.publicForm(anchor);
  }

  @Public()
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @Post('forms/:anchor/submit')
  @UsePipes(new ZodValidationPipe(SubmitIntakeSchema))
  submit(@Param('anchor') anchor: string, @Body() dto: SubmitIntakeDto) {
    return this.intake.submit(anchor, dto);
  }

  // ── Authenticated (project members) ───────────────────────────────
  @Get('forms')
  listForms(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListFormsQuerySchema)) q: ListFormsQuery,
  ) {
    return this.intake.listForms(user.id, q.projectId);
  }

  @Post('forms')
  @UsePipes(new ZodValidationPipe(CreateIntakeFormSchema))
  createForm(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateIntakeFormDto,
  ) {
    return this.intake.createForm(user.id, dto);
  }

  @Patch('forms/:id')
  @UsePipes(new ZodValidationPipe(UpdateIntakeFormSchema))
  updateForm(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateIntakeFormDto,
  ) {
    return this.intake.updateForm(user.id, id, dto);
  }

  @Get('forms/:id/submissions')
  submissions(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.intake.submissions(user.id, id);
  }

  @Post('submissions/:id/triage')
  @UsePipes(new ZodValidationPipe(TriageSchema))
  triage(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: TriageDto,
  ) {
    return this.intake.triage(user.id, id, dto);
  }

  /**
   * Re-run the AI triage suggestion for one submission. Same gate as triaging
   * it. Exists because the suggestion at submit time is fire-and-forget: if
   * the provider was down, or the assistant was configured afterwards, the
   * queue would otherwise be stuck with no proposal.
   */
  @Post('submissions/:id/suggest')
  suggest(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.intake.resuggest(user.id, id);
  }
}
