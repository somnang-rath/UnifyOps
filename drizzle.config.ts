import { defineConfig } from 'drizzle-kit';

// Migrations run as the OWNER role. The app never uses this connection —
// see src/server/db/client.ts for the runtime (RLS-forced) connection.
//
// No fallback. A default here would silently point migrations at a guessable
// superuser on an unconfigured machine, which is the wrong failure mode for
// the one credential that bypasses RLS.
const url = process.env.DATABASE_URL_OWNER;

if (!url) {
  throw new Error(
    'DATABASE_URL_OWNER is not set. Migrations run as the owner role — copy .env.example to .env and fill it in.',
  );
}

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
