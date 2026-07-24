import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { InstanceAdminGuard } from '../instance/instance-admin.guard';
import {
  InstanceAdmin,
  InstanceAdminSchema,
} from '../instance/schemas/instance-admin.schema';

/**
 * Global so any module can put @Audit() on a route without importing this one;
 * the interceptor itself is registered app-wide in app.module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      // Schema only, not InstanceModule — the guard needs the model, and
      // importing the module here would couple audit to instance.
      { name: InstanceAdmin.name, schema: InstanceAdminSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor, InstanceAdminGuard],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
