import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'auditAction';

/**
 * Record this route in the audit log, e.g. `@Audit('instance.config.update')`.
 * Applied by AuditInterceptor; see docs/plan/01-security-model.md §1 S6.
 */
export const Audit = (action: string) => SetMetadata(AUDIT_KEY, action);
