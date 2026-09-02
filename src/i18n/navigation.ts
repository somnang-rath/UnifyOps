import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

/**
 * Re-exported with an explicit type annotation, which is load-bearing.
 *
 * `redirect` returns `never` — it throws to unwind. TypeScript only lets a
 * `never`-returning call end a code path when the thing being called is a
 * dotted name or identifier **whose declaration carries an explicit type
 * annotation**, and a value destructured out of `createNavigation(...)` has
 * none. Without this line every caller has to write an unreachable `return`
 * after redirecting, and the compiler stops being able to narrow anything the
 * redirect was guarding — `if (!user) redirect(...)` would leave `user`
 * nullable on the line below.
 */
export const redirect: typeof navigation.redirect = navigation.redirect;
