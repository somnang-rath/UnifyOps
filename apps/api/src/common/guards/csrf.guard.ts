import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { CSRF_COOKIE, CSRF_HEADER } from '../auth/cookies';

/**
 * Double-submit CSRF check for cookie-authenticated routes (`/auth/refresh`,
 * `/auth/logout`). SameSite=Lax already blocks the cross-site POST; this is the
 * second lock, covering same-site subdomain takeover and lax edge cases.
 * docs/plan/01-security-model.md §1 S2.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const cookie: string | undefined = req.cookies?.[CSRF_COOKIE];
    const header = req.headers?.[CSRF_HEADER];
    const sent = Array.isArray(header) ? header[0] : header;

    if (!cookie || !sent) {
      throw new ForbiddenException('Missing CSRF token');
    }

    const a = Buffer.from(cookie);
    const b = Buffer.from(String(sent));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    return true;
  }
}
