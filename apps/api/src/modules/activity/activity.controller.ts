import { Controller, Get, Query } from '@nestjs/common';
import { ZodQueryPipe, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivityService } from './activity.service';
import { ListActivityDto, ListActivitySchema } from './dto/activity.dto';

@Controller('activity')
export class ActivityController {
  constructor(private activity: ActivityService) {}

  @Get()
  list(
    @Query(new ZodQueryPipe(ListActivitySchema)) q: ListActivityDto,
    @CurrentUser() me: { id: string; role: string },
  ) {
    // Non-admins can only view their own activity
    const forceUserId = me.role !== 'admin' ? me.id : undefined;
    return this.activity.list(q, forceUserId);
  }
}
