import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ListAuditQuery, ListAuditQuerySchema } from './dto/audit.dto';
import { ZodQueryPipe, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InstanceAdminGuard } from '../instance/instance-admin.guard';
import { RequireAudience } from '../../common/decorators/audience.decorator';
import { AUD_ADMIN } from '../../common/auth/audience';

/**
 * The audit trail is itself privileged: God Mode only, and read-only — there is
 * no endpoint that edits or deletes an entry.
 */
@RequireAudience(AUD_ADMIN)
@UseGuards(InstanceAdminGuard)
@Controller('audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(@Query(new ZodQueryPipe(ListAuditQuerySchema)) q: ListAuditQuery) {
    return this.audit.list(q);
  }
}
