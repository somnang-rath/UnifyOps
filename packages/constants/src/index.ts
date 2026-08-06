/**
 * @prism/constants — enums, route paths, feature flags, and port/URL config
 * shared across web, admin, and space.
 */

// CSP + security headers for the authenticated apps (docs/plan/01 §3.5).
export * from './security-headers';

/** App ports (see PLANE-CONVERSION-PLAN.md §2 Port map). */
export const PORTS = {
  web: 3000,
  admin: 3001,
  space: 3002,
  api: 4000,
  live: 3100,
} as const;

/** Base paths for the new apps. */
export const BASE_PATHS = {
  admin: '/god-mode',
  space: '/spaces',
} as const;

/** Instance-config keys managed by the admin app (Phase 1). */
export const INSTANCE_CONFIG_KEYS = {
  ENABLE_SIGNUP: 'ENABLE_SIGNUP',
  ENABLE_EMAIL_PASSWORD_LOGIN: 'ENABLE_EMAIL_PASSWORD_LOGIN',
  ENABLE_MAGIC_LINK_LOGIN: 'ENABLE_MAGIC_LINK_LOGIN',
  GOOGLE_OAUTH_ENABLED: 'GOOGLE_OAUTH_ENABLED',
  GITHUB_OAUTH_ENABLED: 'GITHUB_OAUTH_ENABLED',
  SMTP_HOST: 'SMTP_HOST',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
} as const;

export type InstanceConfigKey =
  (typeof INSTANCE_CONFIG_KEYS)[keyof typeof INSTANCE_CONFIG_KEYS];
