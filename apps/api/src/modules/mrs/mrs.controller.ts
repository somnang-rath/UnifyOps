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
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MrsService } from './mrs.service';
import {
  AddMRCommentDto,
  AddMRCommentSchema,
  CreateMRDto,
  CreateMRSchema,
  ListMRQuery,
  ListMRQuerySchema,
} from './dto/mr.dto';

@Controller('mrs')
export class MrsController {
  constructor(private mrs: MrsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListMRQuerySchema)) q: ListMRQuery,
  ) {
    return this.mrs.list(q);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.mrs.byId(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateMRSchema))
  create(
    @CurrentUser() u: { id: string },
    @Body() dto: CreateMRDto,
  ) {
    return this.mrs.create(u.id, dto);
  }

  @Patch(':id/approve')
  approve(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.mrs.approve(u.id, id);
  }

  @Patch(':id/reject')
  reject(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.mrs.reject(u.id, id);
  }

  @Post(':id/comments')
  @UsePipes(new ZodValidationPipe(AddMRCommentSchema))
  addComment(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Body() dto: AddMRCommentDto,
  ) {
    return this.mrs.addComment(id, u.id, dto.body);
  }

  @Delete(':id')
  remove(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.mrs.remove(u.id, id);
  }
}
