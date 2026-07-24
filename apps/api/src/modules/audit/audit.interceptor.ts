import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Observable, tap } from 'rxjs';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { AUDIT_KEY } from './audit.decorator';

/** Never let a request body put a credential into the audit trail. */
const SECRET_FIELD = /(password|secret|token|apikey|api_key)/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 3 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Config entries name their key in `key` and carry the secret in `value`.
    if (SECRET_FIELD.test(k)) {
      out[k] = '[redacted]';
    } else if (k === 'value' && typeof v === 'string' && v.length > 0) {
      out[k] = '[set]';
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    @InjectModel(AuditLog.name) private model: Model<AuditLogDocument>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!action) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as
      | { id?: string; email?: string; aud?: string }
      | undefined;

    const write = (success: boolean, error?: string) => {
      if (!user?.id) return;
      // Fire-and-forget: an audit write must never fail the request it records,
      // but it must also never be silently lost.
      this.model
        .create({
          actorId: new Types.ObjectId(user.id),
          actorEmail: user.email ?? null,
          action,
          audience: user.aud ?? null,
          detail: {
            params: scrub(req.params),
            query: scrub(req.query),
            body: scrub(req.body),
          },
          ip: req.ip ?? null,
          userAgent: req.headers?.['user-agent']?.slice(0, 300) ?? null,
          success,
          error: error ?? null,
        })
        .catch((err: unknown) =>
          console.error('[audit] failed to write entry', action, err),
        );
    };

    return next.handle().pipe(
      tap({
        next: () => write(true),
        error: (err: Error) => write(false, err?.message ?? 'error'),
      }),
    );
  }
}
