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

  // --- Abuse limits (docs/plan/01 §3.3) ---
  // An authenticated client is still an untrusted one: without these, one
  // session can send an unbounded frame or hold unbounded sockets on one doc.

  /**
   * Largest inbound WS frame, in bytes. Sized for Yjs sync — the biggest legit
   * message is a client's full document state on reconnect, and the editor
   * stores images as URLs (uploaded via the API), never base64, so documents
   * stay text-sized. Raise this only if real docs start hitting it; `ws` closes
   * an oversized frame with 1009 rather than buffering it.
   */
  LIVE_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(64 * 1024).default(1024 * 1024),

  /**
   * Concurrent connections allowed on a single document. Generous for real
   * co-editing (a person with three tabs open is three connections), tight
   * enough that one account cannot pin a document's memory on its own.
   */
  LIVE_MAX_CONNECTIONS_PER_DOC: z.coerce.number().int().min(1).default(30),

  /** Concurrent connections across the whole server; refused at upgrade time. */
  LIVE_MAX_CONNECTIONS: z.coerce.number().int().min(1).default(500),
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
