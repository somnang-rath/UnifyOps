import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Instance, InstanceSchema } from './schemas/instance.schema';
import {
  InstanceConfiguration,
  InstanceConfigurationSchema,
} from './schemas/instance-configuration.schema';
import {
  InstanceAdmin,
  InstanceAdminSchema,
} from './schemas/instance-admin.schema';
import { InstanceService } from './instance.service';
import { InstanceController } from './instance.controller';
import { InstanceAdminGuard } from './instance-admin.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Instance.name, schema: InstanceSchema },
      { name: InstanceConfiguration.name, schema: InstanceConfigurationSchema },
      { name: InstanceAdmin.name, schema: InstanceAdminSchema },
    ]),
    UsersModule,
  ],
  controllers: [InstanceController],
  providers: [InstanceService, InstanceAdminGuard],
  exports: [InstanceService, MongooseModule],
})
export class InstanceModule {}
