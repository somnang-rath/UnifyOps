import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notifs: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: { id: string }) {
    return this.notifs.list(u.id);
  }

  @Get('history')
  history(
    @CurrentUser() u: { id: string },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Math.max(1, Math.min(100, Number(limit))) : 50;
    return this.notifs.history(u.id, cursor, Number.isFinite(n) ? n : 50);
  }

  @Patch('read-all')
  readAll(@CurrentUser() u: { id: string }) {
    return this.notifs.markAllRead(u.id);
  }

  @Patch(':id/read')
  read(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.notifs.markRead(u.id, id);
  }

  @Patch(':id/unread')
  unread(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.notifs.markUnread(u.id, id);
  }

  @Delete('read')
  clearRead(@CurrentUser() u: { id: string }) {
    return this.notifs.clearRead(u.id);
  }

  @Delete(':id')
  remove(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.notifs.remove(u.id, id);
  }
}
