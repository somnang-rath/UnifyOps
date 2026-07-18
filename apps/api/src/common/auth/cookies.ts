import * as crypto from 'crypto';
import type { Response, Request } from 'express';
import { AUD_WEB, type RestAudience } from './audience';

/**
 * Refresh cookies are named per audience. On localhost every app shares the
 * same cookie host (ports do not isolate cookies), so one name would let an
 * admin login clobber the web session and vice versa.
 */
export const refreshCookieName = (aud: RestAudience) => `prism_rt_${aud}`;

/** Readable by JS on purpose — the client echoes it back as a header. */
export const CSRF_COOKIE = 'prism_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_PATH = '/api/v1/auth';

// Scope cookies to a parent domain (e.g. `.example.com`) so apps on sibling
// subdomains share one session. Unset on localhost.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const SECURE = process.env.NODE_ENV === 'production';

export function setRefreshCookie(
  res: Response,
  token: string,
  aud: RestAudience = AUD_WEB,
) {
  res.cookie(refreshCookieName(aud), token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: 'lax',
    path: REFRESH_PATH,
    domain: COOKIE_DOMAIN,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response, aud: RestAudience = AUD_WEB) {
  // Must mirror the set attributes (path + domain) or the browser keeps it.
  res.clearCookie(refreshCookieName(aud), {
    path: REFRESH_PATH,
    domain: COOKIE_DOMAIN,
  });
}

export function readRefreshCookie(
  req: Request,
  aud: RestAudience = AUD_WEB,
): string | undefined {
  return req.cookies?.[refreshCookieName(aud)];
}

/**
 * Issue the double-submit CSRF token. Not httpOnly: the client must read it to
 * echo it in the header, which is exactly what a cross-site page cannot do.
 */
export function setCsrfCookie(res: Response): string {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: SECURE,
    sameSite: 'lax',
    path: '/',
    domain: COOKIE_DOMAIN,
    maxAge: REFRESH_TTL_MS,
  });
  return token;
}

export function clearCsrfCookie(res: Response) {
  res.clearCookie(CSRF_COOKIE, { path: '/', domain: COOKIE_DOMAIN });
}
