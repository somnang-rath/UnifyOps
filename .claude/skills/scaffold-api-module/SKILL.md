---
name: scaffold-api-module
description: Scaffold a new NestJS module in apps/api that matches Prism's exact conventions (Mongoose schema, Zod DTOs, ZodValidationPipe controller, injectable service, module wiring, app.module registration). Use when creating a new backend module such as `instance` or `public`, or when adding a fully-structured feature to apps/api.
---

# Scaffold an apps/api NestJS module

Create a new module under `apps/api/src/modules/<name>/` that is indistinguishable in style from existing modules (study `modules/issues/` as the reference).

## Steps

1. **Create the folder:** `apps/api/src/modules/<name>/` with `schemas/`, `dto/`.
2. Write the five files below (replace `Thing`/`<name>`).
3. **Register** the module class in `apps/api/src/app.module.ts` `imports` array.
4. Build/typecheck (`pnpm --filter api build`) and confirm no errors.

## 1. `schemas/<name>.schema.ts`

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ThingDocument = HydratedDocument<Thing>;

@Schema({ timestamps: true })
export class Thing {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', index: true })
  workspaceId?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;
}

export const ThingSchema = SchemaFactory.createForClass(Thing);
```

Sub-documents: use `@Schema({ _id: false })` + `SchemaFactory.createForClass` and reference the sub-schema in the parent `@Prop`.

## 2. `dto/<name>.dto.ts` (Zod)

```ts
import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const CreateThingSchema = z.object({
  workspaceId: objectId.optional().nullable(),
  name: z.string().min(1).max(200).trim(),
});
export type CreateThingDto = z.infer<typeof CreateThingSchema>;

export const UpdateThingSchema = CreateThingSchema.partial();
export type UpdateThingDto = z.infer<typeof UpdateThingSchema>;

export const ListThingQuerySchema = z.object({
  workspaceId: objectId.optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListThingQuery = z.infer<typeof ListThingQuerySchema>;
```

## 3. `<name>.controller.ts`

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ThingsService } from './things.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateThingDto, CreateThingSchema,
  UpdateThingDto, UpdateThingSchema,
  ListThingQuery, ListThingQuerySchema,
} from './dto/thing.dto';

@Controller('things')
export class ThingsController {
  constructor(private things: ThingsService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(ListThingQuerySchema)) q: ListThingQuery,
  ) {
    return this.things.list(user.id, q);
  }

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateThingSchema)) dto: CreateThingDto,
  ) {
    return this.things.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateThingSchema)) dto: UpdateThingDto,
  ) {
    return this.things.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.things.remove(user.id, id);
  }
}
```

## 4. `<name>.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Thing, ThingDocument } from './schemas/thing.schema';
import { CreateThingDto, UpdateThingDto, ListThingQuery } from './dto/thing.dto';

const oid = (v?: string | null) => (v ? new Types.ObjectId(v) : undefined);

@Injectable()
export class ThingsService {
  constructor(@InjectModel(Thing.name) private model: Model<ThingDocument>) {}

  async list(userId: string, q: ListThingQuery) {
    const filter: Record<string, unknown> = {};
    if (q.workspaceId) filter.workspaceId = oid(q.workspaceId);
    if (q.q) filter.name = { $regex: q.q, $options: 'i' };
    return this.model.find(filter).sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit).limit(q.limit).lean();
  }

  create(userId: string, dto: CreateThingDto) {
    return this.model.create({ ...dto, workspaceId: oid(dto.workspaceId) });
  }

  async update(userId: string, id: string, dto: UpdateThingDto) {
    const doc = await this.model.findByIdAndUpdate(id, dto, { new: true });
    if (!doc) throw new NotFoundException('Thing not found');
    return doc;
  }

  async remove(userId: string, id: string) {
    const doc = await this.model.findByIdAndDelete(id);
    if (!doc) throw new NotFoundException('Thing not found');
    return { ok: true };
  }
}
```

## 5. `<name>.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Thing, ThingSchema } from './schemas/thing.schema';
import { ThingsService } from './things.service';
import { ThingsController } from './things.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Thing.name, schema: ThingSchema }])],
  controllers: [ThingsController],
  providers: [ThingsService],
  exports: [MongooseModule], // export so other modules can inject this model
})
export class ThingsModule {}
```

## Notes for special modules

- **Guarded endpoints** (e.g. `instance`): create a guard in the module (or `common/guards/`) and apply with `@UseGuards(InstanceAdminGuard)`. Instance admin is server-wide — a **separate** collection from workspace roles.
- **Public/anonymous endpoints** (`public`): skip the auth guard, strip private fields before returning, and rely on ThrottlerModule for rate limiting.
- Cross-module dependencies: import the other module in `imports` and inject its service.
