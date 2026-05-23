import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AutomationsService } from './automations.service';
import {
  FireDto,
  FireSchema,
  SaveAutomationDto,
  SaveAutomationSchema,
  UpdateAutomationDto,
  UpdateAutomationSchema,
} from './dto/automation.dto';

@Controller('automations')
export class AutomationsController {
  constructor(private autos: AutomationsService) {}

  @Get()
  list(@CurrentUser() u: { id: string }) {
    return this.autos.list(u.id);
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

  @Post('fire')
  @UsePipes(new ZodValidationPipe(FireSchema))
  async fire(@Body() dto: FireDto) {
    await this.autos.fire(dto.trigger, dto.payload);
    return { ok: true };
  }
}
