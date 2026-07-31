import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import { AutomationsService } from './automations.service';
import {
  ListAutomationsQuery,
  ListAutomationsQuerySchema,
  SaveAutomationDto,
  SaveAutomationSchema,
  UpdateAutomationDto,
  UpdateAutomationSchema,
} from './dto/automation.dto';

/**
 * Rule CRUD only. The engine (`AutomationsService.fire`) is service-to-service
 * and deliberately has no route: the `POST /automations/fire` that used to sit
 * here took an arbitrary trigger + payload from any authenticated user, which
 * meant anyone could drive every matching rule in the instance — re-assigning
 * issues they could not read and firing outbound webhooks under our name.
 */
@Controller('automations')
export class AutomationsController {
  constructor(private autos: AutomationsService) {}

  @Get()
  list(
    @CurrentUser() u: { id: string },
    @Query(new ZodQueryPipe(ListAutomationsQuerySchema))
    q: ListAutomationsQuery,
  ) {
    return this.autos.list(u.id, q.workspaceId);
  }

  @Get(':id')
  byId(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.autos.byId(u.id, id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(SaveAutomationSchema))
  create(
    @CurrentUser() u: { id: string },
    @Body() dto: SaveAutomationDto,
  ) {
    return this.autos.create(u.id, dto);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateAutomationSchema))
  update(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    return this.autos.update(u.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.autos.remove(u.id, id);
  }
}
