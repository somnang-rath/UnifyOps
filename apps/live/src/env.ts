import { z } from 'zod';

/**
 * Env validation for the live (Hocuspocus) server.
 *
 * Three secrets MUST match apps/api exactly (see ADR 0001 §6):
 *   JWT_ACCESS_SECRET, MONGODB_URI, LIVE_INTERNAL_TOKEN.
 */
const envSchema = z.object({
  // ADR uses PORT=3100; LIVE_PORT accepted as an alias for compose overrides.
  PORT: z.coerce.number().default(3100),

  // Shared with apps/api — used to locally verify the client-supplied JWT.
  JWT_ACCESS_SECRET: z.string().min(32),

  // Shared Mongo (separate connection). YjsDocument collection lives here.
  MONGODB_URI: z.string().min(1),

  // Base for the internal PUT (snapshot-back) + access GET, e.g.
  // http://localhost:4000/api/v1
  INTERNAL_API_URL: z.string().url(),

  // Shared server-to-server secret sent as `x-internal-token` to the API.
  LIVE_INTERNAL_TOKEN: z.string().min(32),

  // Comma-separated WS Origin allowlist, e.g.
  // http://localhost:3000,http://localhost:3002
  LIVE_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3002'),
});

export type Env = z.infer<typeof envSchema> & {
  /** Parsed, trimmed set of allowed WS origins. */
  allowedOrigins: Set<string>;
};

export function loadEnv(): Env {
  // LIVE_PORT alias: prefer LIVE_PORT when present, else PORT.
  const raw = { ...process.env };
  if (raw.LIVE_PORT && !raw.PORT) raw.PORT = raw.LIVE_PORT;

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    throw new Error(
      `Invalid live-server environment: ${JSON.stringify(flat.fieldErrors)}`,
    );
  }

  const allowedOrigins = new Set(
    parsed.data.LIVE_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );

  return { ...parsed.data, allowedOrigins };
}
