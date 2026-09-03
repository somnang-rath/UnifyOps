import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

/**
 * The only place a `pg.Pool` is constructed.
 *
 * A pool is an EventEmitter, and `pg` emits `'error'` on it when a client that
 * is sitting IDLE in the pool loses its backend — Postgres restarted, an admin
 * terminated the session, a firewall dropped a long-lived socket, `tcp_keepalive`
 * gave up. An `'error'` event with no listener is rethrown by EventEmitter as an
 * uncaughtException, so a dropped idle connection does not fail a query: it kills
 * the process.
 *
 * In production that is a container restart. In `next dev` it is worse and much
 * more confusing, because the process it kills is the render worker child, and
 * what the browser is shown is jest-worker's own message about the corpse:
 *
 *     Jest worker encountered 2 child process exceptions, exceeding retry limit
 *
 * — with no stack, no route and no mention of Postgres. The parent then writes to
 * the dead child's stdin and reports `write EPIPE` on top of it.
 *
 * Errors on a CHECKED-OUT client are unaffected by any of this: they reject the
 * query promise and surface at the call site as normal. This listener exists only
 * for the idle ones, which have no call site to reject. Handling it is the whole
 * fix — `pg` has already removed the broken client from the pool and will open a
 * fresh one on the next checkout, so there is nothing to retry and nothing to
 * rethrow. Logging it is the correct and complete response.
 */
export function createPool(label: string, config: PoolConfig): Pool {
  const pool = new Pool(config);

  pool.on('error', (error: Error) => {
    // Not fatal: the client was idle, the pool has already discarded it, and the
    // next checkout reconnects. Logged rather than swallowed because a pool that
    // sheds connections steadily is a real symptom of something else.
    //
    // Message and SQLSTATE only. A `pg` error carries the whole `Client` on it,
    // and passing the object to console.error prints the connection parameters
    // — including, on a URL that carries one, the password.
    const code = (error as { code?: string }).code;
    console.error(
      `[db:${label}] idle client dropped; the pool will reconnect. ` +
        `${error.message}${code ? ` (${code})` : ''}`,
    );
  });

  return pool;
}
