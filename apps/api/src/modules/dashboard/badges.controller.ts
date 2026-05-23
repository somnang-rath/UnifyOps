import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('badges')
export class BadgesController {
  constructor(private dashboard: DashboardService) {}

  @Get()
  badges(@CurrentUser() u: { id: string }) {
    return this.dashboard.badges(u.id);
  }
}
