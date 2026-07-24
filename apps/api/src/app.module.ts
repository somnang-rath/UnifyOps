import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { validateEnv } from './config/env.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AudienceGuard } from './common/guards/audience.guard';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { IssuesModule } from './modules/issues/issues.module';
import { ViewsModule } from './modules/views/views.module';
import { TemplatesModule } from './modules/templates/templates.module';
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
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { IntakeModule } from './modules/intake/intake.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ChatModule } from './modules/chat/chat.module';
import { PublicModule } from './modules/public/public.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { UnsplashModule } from './modules/unsplash/unsplash.module';

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
    ViewsModule,
    TemplatesModule,
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
    AuditModule,
    WorkspacesModule,

    // Integrations (personal access tokens live in UsersModule)
    WebhooksModule,
    IntakeModule,

    // Team chat (channels + DMs, optional per-channel Telegram bridge — ADR 0007)
    ChatModule,

    // AI Assistant (in-app chat; configured from God Mode → AI)
    AssistantModule,

    // Public Space (anonymous read-only published content)
    PublicModule,

    // Unsplash cover-image proxy (ADR 0010)
    UnsplashModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Order matters: AudienceGuard reads req.user, so it must run after
    // JwtAuthGuard has populated it.
    { provide: APP_GUARD, useClass: AudienceGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Records every route marked @Audit(); a no-op on all others.
    // useExisting, not useClass: the instance must come from AuditModule, which
    // owns the AuditLog model. useClass would build a second one here, where
    // that model is not registered.
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
  ],
})
export class AppModule {}
