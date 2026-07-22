import { z } from 'zod';

/**
 * Callback query from the provider redirect (ADR 0008 §3). Deliberately
 * forgiving: a malformed or missing value must surface as a
 * `?error=oauth_failed` redirect from the flow, never as a 400 from the
 * pipe — the user lands here from a top-level navigation, not an XHR.
 * `.catch(undefined)` folds non-string values (e.g. duplicated params)
 * into "absent".
 */
const qs = (max: number) => z.string().max(max).optional().catch(undefined);

export const OAuthCallbackSchema = z.object({
  code: qs(2000),
  state: qs(500),
  // Providers report user denials etc. here; we never echo it anywhere.
  error: qs(200),
});
export type OAuthCallbackDto = z.infer<typeof OAuthCallbackSchema>;
