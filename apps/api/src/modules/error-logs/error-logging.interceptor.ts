import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, catchError, throwError } from 'rxjs';
import { ErrorLogsService } from './error-logs.service';

interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  constructor(private errorLogs: ErrorLogsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        try {
          const req = ctx.switchToHttp().getRequest<AuthRequest>();
          const status =
            err instanceof HttpException
              ? err.getStatus()
              : 500;

          const logType =
            status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info';

          const message =
            err instanceof HttpException
              ? JSON.stringify(err.getResponse())
              : err instanceof Error
                ? err.message
                : String(err);

          const stack = err instanceof Error ? err.stack : undefined;

          this.errorLogs
            .create(
              {
                source: 'backend',
                logType,
                statusCode: status,
                errorTitle:
                  err instanceof Error ? err.constructor.name : 'ServerError',
                errorMessage: message.slice(0, 10000),
                stackTrace: stack?.slice(0, 50000),
                endpointUrl: `${req.method} ${req.url}`,
                userEmail: req.user?.email,
              },
              req.user?.id,
            )
            .catch(() => {
              /* never let logging break the response */
            });
        } catch {
          /* swallow logging errors unconditionally */
        }

        return throwError(() => err);
      }),
    );
  }
}
