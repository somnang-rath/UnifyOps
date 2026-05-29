import { Controller, Get } from '@nestjs/common';
import {
  CurrentUser,
  AuthUserPayload,
} from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get()
  overview(@CurrentUser() u: AuthUserPayload) {
    return this.dashboard.overview(u.id, u.role);
  }
}
