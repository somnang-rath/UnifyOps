import {
  ArgumentMetadata,
  BadRequestException,
  PipeTransform,
} from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private schema: ZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    // When bound via @UsePipes() at method level, NestJS runs this pipe on
    // every argument — including @CurrentUser(), @Param(), @Query(), @Res().
    // We only want to validate the request body.
    if (metadata.type !== 'body') return value as T;

    const r = this.schema.safeParse(value);
    if (!r.success) {
      const message = r.error.issues
        .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
        .join('; ');
      throw new BadRequestException({
        message: message || 'Invalid request body',
        errors: r.error.flatten(),
      });
    }
    return r.data;
  }
}
