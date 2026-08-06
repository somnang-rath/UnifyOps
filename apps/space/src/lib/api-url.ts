/**
 * The API origin the **browser** talks to.
 *
 * Its own module, and not a constant inside `public-api.ts`, for two reasons:
 * that file pulls in `sanitize-html` (server-only, and far too large to ship to
 * a client bundle), and `middleware.ts` runs on the Edge runtime where it can
 * import neither. The value is needed in all three places — the client form
 * that posts, the CSP that must allow the post, and nothing else — and a
 * `connect-src` that disagrees with the fetch URL by a single character blocks
 * the request, so there is exactly one definition of it.
 */
export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
