import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

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
import { BackupsModule } from './modules/backups/backup.module';
import { ErrorLogsModule } from './modules/error-logs/error-logs.module';
import { InstanceModule } from './modules/instance/instance.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { PublicModule } from './modules/public/public.module';
import { AssistantModule } from './modules/assistant/assistant.module';

// Register BullMQ globally only when REDIS_URL is configured.
// Individual modules (ReportsModule) conditionally register their queues
// using the same flag so everything is consistent.
const bullRootImport = process.env.REDIS_URL
  ? [BullModule.forRoot({ connection: { url: process.env.REDIS_URL } })]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: process.env.MONGODB_URI }),
    }),
    ScheduleModule.forRoot(),
    ...bullRootImport,
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
    BackupsModule,
    ErrorLogsModule,

    // Instance / God Mode (server-wide admin)
    InstanceModule,
    WorkspacesModule,

    // AI Assistant (in-app chat; configured from God Mode → AI)
    AssistantModule,

    // Public Space (anonymous read-only published content)
    PublicModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
