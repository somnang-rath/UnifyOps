import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from './schemas/role.schema';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersModule } from '../users/users.module';
import { EmailService } from '../notifications/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }]),
    UsersModule,
  ],
  controllers: [RolesController, AdminUsersController],
  providers: [RolesService, EmailService],
  exports: [RolesService, MongooseModule],
})
export class RolesModule {}
