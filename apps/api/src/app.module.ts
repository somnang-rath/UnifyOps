import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { validateEnv } from './config/env.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IssuesModule } from './modules/issues/issues.module';
import { KanbanModule } from './modules/kanban/kanban.module';
import { MrsModule } from './modules/mrs/mrs.module';
import { FilesModule } from './modules/files/files.module';
import { NotesModule } from './modules/notes/notes.module';
import { WikiModule } from './modules/wiki/wiki.module';
import { WorkbooksModule } from './modules/workbooks/workbooks.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ActivityModule } from './modules/activity/activity.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { SearchModule } from './modules/search/search.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: process.env.MONGODB_URI }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },   // 20 req/s per IP
      { name: 'medium', ttl: 60_000, limit: 300 }, // 300 req/min per IP
    ]),

    // Core
    AuthModule,
    UsersModule,
    RolesModule,

    // Plan & Track
    ProjectsModule,
    IssuesModule,
    KanbanModule,
    MrsModule,

    // Knowledge
    FilesModule,
    NotesModule,
    WikiModule,
    WorkbooksModule,

    // Automation + signals
    AutomationsModule,
    NotificationsModule,
    ActivityModule,

    // Aggregated views
    DashboardModule,
    HealthModule,
    SearchModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
