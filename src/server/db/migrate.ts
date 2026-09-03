import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ownerDatabaseUrl } from '@/env';
import { createPool } from './pool';

/**
 * Applies migrations as the OWNER role.
 *
 * The owner is the only role that may create objects, and the only one exempt
 * from nothing — it owns the tables, which is exactly why every tenant table
 * is FORCE ROW LEVEL SECURITY (drizzle/0002). Run with `pnpm db:migrate`.
 */
async function main(): Promise<void> {
  const pool = createPool('migrate', { connectionString: ownerDatabaseUrl(), max: 1 });

  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
