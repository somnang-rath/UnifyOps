import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const CONFIG_CATEGORIES = [
  'auth',
  'smtp',
  'ai',
  'images',
  'general',
] as const;
export type ConfigCategory = (typeof CONFIG_CATEGORIES)[number];

/**
 * Config keys whose (non-secret) values are safe to expose on the public
 * `GET /instance` endpoint — the frontends read these to render login options.
 */
export const PUBLIC_CONFIG_KEYS = [
  'ENABLE_SIGNUP',
  'ENABLE_EMAIL_PASSWORD_LOGIN',
  'ENABLE_MAGIC_LINK_LOGIN',
  'GOOGLE_OAUTH_ENABLED',
  'GITHUB_OAUTH_ENABLED',
  // Whether the in-app AI Assistant is turned on (drives the web assistant UI).
  // Non-secret: the provider keys stay server-side, only this toggle is exposed.
  'ASSISTANT_ENABLED',
] as const;

/**
 * Config keys whose value is a secret: never returned to any client, only ever
 * reported as set/unset.
 *
 * Secrecy is a property of the *key*, decided here on the server. It used to be
 * taken from the request body, which meant a client could write an API key with
 * `isEncrypted: false` and then read it straight back out of GET /instance/config.
 * docs/plan/01-security-model.md §1 S10.
 */
export const SECRET_CONFIG_KEYS = [
  'SMTP_PASSWORD',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'GITLAB_CLIENT_SECRET',
  'UNSPLASH_ACCESS_KEY',
] as const;

export const isSecretConfigKey = (key: string): boolean =>
  (SECRET_CONFIG_KEYS as readonly string[]).includes(key) ||
  /(_SECRET|_API_KEY|_PASSWORD|_TOKEN)$/.test(key);

export const UpdateInstanceSchema = z.object({
  instanceName: z.string().min(1).max(120).trim().optional(),
});
export type UpdateInstanceDto = z.infer<typeof UpdateInstanceSchema>;

export const ConfigEntrySchema = z.object({
  key: z.string().min(1).max(120).trim(),
  value: z.string().max(5000).nullable(),
  category: z.enum(CONFIG_CATEGORIES).default('general'),
  // `isEncrypted` is intentionally absent: the server decides secrecy from the
  // key via isSecretConfigKey(). See SECRET_CONFIG_KEYS above.
});
export type ConfigEntryDto = z.infer<typeof ConfigEntrySchema>;

export const UpdateConfigSchema = z.object({
  entries: z.array(ConfigEntrySchema).min(1).max(100),
});
export type UpdateConfigDto = z.infer<typeof UpdateConfigSchema>;

export const AddAdminSchema = z
  .object({
    email: z.string().email().optional(),
    userId: objectId.optional(),
  })
  .refine((d) => Boolean(d.email || d.userId), {
    message: 'Provide email or userId',
  });
export type AddAdminDto = z.infer<typeof AddAdminSchema>;

export const TestEmailSchema = z.object({
  to: z.string().email(),
});
export type TestEmailDto = z.infer<typeof TestEmailSchema>;
