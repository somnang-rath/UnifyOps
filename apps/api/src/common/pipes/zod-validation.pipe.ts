import {
  ArgumentMetadata,
  BadRequestException,
  PipeTransform,
} from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

/**
 * Accepts schemas whose parsed output differs from their input — anything using
 * `.default()`, `.coerce`, or `.transform()`. `ZodSchema<T>` pins input === output,
 * which query schemas (coerced numbers, defaulted limits) can never satisfy.
 */
type AnyZodSchema<TOut> = ZodType<TOut, ZodTypeDef, any>;

/**
 * Validates the request body against a Zod schema.
 *
 * Body-only by design: bound via `@UsePipes()` at method level, NestJS runs a
 * pipe over *every* argument — `@CurrentUser()`, `@Param()`, `@Res()` — and
 * those must pass through untouched. For query strings use {@link ZodQueryPipe},
 * which is bound to one argument and so can safely validate it.
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private schema: AnyZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    if (metadata.type !== 'body') return value as T;
    return parseOrThrow(this.schema, value, 'request body');
  }
}

/**
 * Validates a query string: `@Query(new ZodQueryPipe(Schema)) q: Query`.
 *
 * ZodValidationPipe used to be bound here too, but its body-only guard made it
 * a silent no-op on `@Query()` — the schema never ran, so defaults were never
 * applied and unbounded values (limits, regex sources) reached the services.
 */
export class ZodQueryPipe<T> implements PipeTransform {
  constructor(private schema: AnyZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    // Guard against an accidental @UsePipes() binding, which would hand us
    // every argument.
    if (metadata.type !== 'query') return value as T;
    return parseOrThrow(this.schema, value, 'query string');
  }
}

function parseOrThrow<T>(
  schema: AnyZodSchema<T>,
  value: unknown,
  what: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const message = r.error.issues
      .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
      .join('; ');
    throw new BadRequestException({
      message: message || `Invalid ${what}`,
      errors: r.error.flatten(),
    });
  }
  return r.data;
}
