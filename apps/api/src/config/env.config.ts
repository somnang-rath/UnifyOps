import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // Parent domain for the refresh cookie so a single session is shared across
  // sibling frontends (web / admin / space) on different subdomains. Set it to
  // the registrable parent with a leading dot, e.g. `.example.com`, so the
  // cookie set by app.example.com is also sent to admin.example.com. Leave
  // unset on localhost (ports already share the cookie for the same host).
  COOKIE_DOMAIN: z.string().optional(),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL: z.string().default('7d'),
  // Shared secret for the server-to-server internal wiki endpoints called by
  // the live collaboration server (apps/live). Must match apps/live's value.
  // See ADR 0001 §6.
  LIVE_INTERNAL_TOKEN: z.string().min(32),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().transform(v => v.toLowerCase() === 'true').optional(),
  SMTP_FROM: z.string().optional(),
  ALLOW_PUBLIC_REGISTER: z.coerce.boolean().default(false),
  API_URL: z.string().url().optional(),
  // OAuth login (ADR 0008). All optional: instance config takes precedence and
  // with neither set the provider is simply "effectively disabled". Missing = fine.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Redis — optional. When set, report dispatch uses BullMQ (persistent, retryable).
  // When absent, dispatch falls back to in-process setImmediate (no retry on crash).
  REDIS_URL: z.string().url().optional(),
  // Hours to add to UTC when interpreting a report's scheduled `hour` as local
  // wall-clock time. Default 7 (Cambodia / ICT, UTC+7). The hourly cron compares
  // the template hour against this shifted time, so "send at 08:00" means 08:00 local.
  REPORT_TZ_OFFSET_HOURS: z.coerce.number().default(7),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (cfg: Record<string, unknown>): Env => {
  const result = envSchema.safeParse(cfg);
  if (!result.success) {
    const flat = result.error.flatten();
    throw new Error(`Invalid environment: ${JSON.stringify(flat.fieldErrors)}`);
  }
  return result.data;
};
