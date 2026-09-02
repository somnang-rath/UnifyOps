/**
 * Postgres error codes the application actually branches on.
 *
 * Drizzle wraps driver errors, so `error.code` is not on the object that was
 * thrown — it is somewhere down the `cause` chain. Checking it in one place
 * stops that walk from being re-written slightly differently at each call site,
 * where the version that forgets to walk silently never matches.
 */

const SQLSTATE = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  /** Both "permission denied for table" and "violates row-level security policy". */
  insufficientPrivilege: '42501',
} as const;

function hasCode(error: unknown, code: string): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === code) return true;
  }
  return false;
}

export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, SQLSTATE.uniqueViolation);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, SQLSTATE.foreignKeyViolation);
}

/**
 * An RLS policy or a missing grant refused the statement.
 *
 * Worth naming: this is what a tenancy bug looks like at runtime, and it should
 * surface as itself rather than as a generic 500.
 */
export function isInsufficientPrivilege(error: unknown): boolean {
  return hasCode(error, SQLSTATE.insufficientPrivilege);
}
