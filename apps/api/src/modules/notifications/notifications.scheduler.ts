import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { AutomationsService } from '../automations/automations.service';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private notifs: NotificationsService,
    @Inject(forwardRef(() => AutomationsService))
    private autos: AutomationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async dailyDueSoonSweep() {
    try {
      const { sent, dueIssues } = await this.notifs.runDueSoonSweep();
      if (sent > 0) {
        this.logger.log(`Due-soon sweep: sent ${sent} notification(s)`);
      }
      for (const issue of dueIssues) {
        this.autos.fire('issue.due_soon', {
          issueId: issue.id,
          issueTitle: issue.title,
        }).catch(() => {});
      }
    } catch (err) {
      this.logger.error('Due-soon sweep failed', err as Error);
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async weeklyReadCleanup() {
    try {
      const removed = await this.notifs.cleanupOldRead(30);
      if (removed > 0) {
        this.logger.log(`Cleanup: removed ${removed} read notif(s) > 30d old`);
      }
    } catch (err) {
      this.logger.error('Cleanup failed', err as Error);
    }
  }
}
