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
import { RolesService } from './roles.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateRoleDto,
  CreateRoleSchema,
  UpdateRoleDto,
  UpdateRoleSchema,
} from './dto/role.dto';

@Controller('roles')
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get()
  list() {
    return this.roles.list();
  }

  @Roles('admin')
  @Post()
  @UsePipes(new ZodValidationPipe(CreateRoleSchema))
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Roles('admin')
  @Patch(':key')
  @UsePipes(new ZodValidationPipe(UpdateRoleSchema))
  update(@Param('key') key: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(key, dto);
  }

  @Roles('admin')
  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.roles.remove(key);
  }
}
