/**
 * Run database work that shares one transaction, one query at a time.
 *
 * A `withActor` transaction is one checked-out `pg.Client`, and a client speaks
 * one query at a time on one socket. `Promise.all` over a shared `tx` therefore
 * never made two queries concurrent: `pg` queued the second and sent it once
 * the first had come back, so the round trips were serial either way and the
 * only thing gained was the appearance of parallelism.
 *
 * As of `pg` 8.23 that queue is deprecated and warns once per process —
 *
 *     Calling client.query() when the client is already executing a query is
 *     deprecated and will be removed in pg@9.0.
 *
 * — and in `pg` 9 it is removed, which turns today's cosmetic warning into a
 * real failure on a screen that reads four things about one project. Under
 * `next dev` the warning arrives with a stack naming only the React component
 * that rendered the page, which is why it is worth naming the rule here rather
 * than rediscovering it from a call site.
 *
 * Genuinely concurrent queries need genuinely separate connections, and inside
 * `withActor` that is not on offer: the transaction is what carries the tenancy
 * GUCs the RLS policies read, and a second connection would be a second
 * transaction with a different snapshot. Serial is the correct shape, so this
 * says so out loud — a call site that reads `inSequence` cannot be turned back
 * into `Promise.all` by somebody tidying up.
 *
 * Thunks rather than promises, because an array of already-started promises is
 * concurrent before this function ever sees it.
 */
export async function inSequence<T extends readonly unknown[]>(
  ...steps: readonly [...{ [K in keyof T]: () => Promise<T[K]> }]
): Promise<T> {
  const results: unknown[] = [];
  for (const step of steps) results.push(await step());
  return results as unknown as T;
}

/** `Promise.all(xs.map(f))` for work on a shared transaction. See `inSequence`. */
export async function mapInSequence<T, R>(
  values: readonly T[],
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (const [index, value] of values.entries()) results.push(await fn(value, index));
  return results;
}
