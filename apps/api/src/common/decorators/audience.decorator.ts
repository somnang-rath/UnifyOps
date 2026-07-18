import { SetMetadata } from '@nestjs/common';
import type { RestAudience } from '../auth/audience';

export const AUDIENCE_KEY = 'requiredAudience';

/**
 * Restrict a route to one token audience (docs/plan/01-security-model.md §2).
 * Without it a route accepts any REST audience (`web` or `admin`).
 * Enforced by the global AudienceGuard.
 */
export const RequireAudience = (aud: RestAudience) => SetMetadata(AUDIENCE_KEY, aud);

export const STEP_UP_KEY = 'requiresStepUp';

/**
 * Require a recent password re-entry (STEP_UP_MAX_AGE_MS) on top of a valid
 * session. Put it on instance mutations — SMTP, AI keys, auth toggles.
 */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);
