import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

// Next 16 renamed the `middleware` file convention to `proxy`. The next-intl
// factory keeps its old name; only the file and the convention changed.
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, and anything with a file extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
