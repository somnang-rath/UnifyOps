import 'server-only';

import { pathToFileURL } from 'node:url';
import type { PgBoss } from 'pg-boss';
import { closePool } from '@/server/db/client';
import {
  DIGEST_TICK_QUEUE,
  DIGEST_WORKSPACE_QUEUE,
  sendWorkspaceDigest,
  tickDigests,
} from './digest';
import type { DigestJob } from './digest';
import { closePlatformDb, startBoss, stopBoss } from './client';
import { NOTIFY_QUEUE, deliverNotification, drainOutbox } from './notify';
import type { NotifyJob } from './notify';
import { SWEEP_QUEUE, sweepAbandonedUploads } from './sweep';

/**
 * The job worker — §8's second process type, from the same image as the web
 * process and with a different entry point (`pnpm jobs`).
 *
 * Not serverless and not a cron container: "the worker and the pg pool both
 * want a persistent process". Everything it does is one of three things.
 *
 * **The outbox sweep** is a plain interval, not a pg-boss job. Cron's finest
 * granularity is one minute, and a mention that takes a minute to reach an
 * inbox is a product that feels broken; the sweep is also the one piece of work
 * that must never itself be queued, because the queue is what it feeds.
 *
 * **Delivery** is a pg-boss job per outbox message, which is where pg-boss
 * earns its place: retries with backoff, a dead-letter queue, and concurrency
 * that does not need a second table. A failed email retries on its own; a
 * failed sweep just runs again in seconds.
 *
 * **The digest tick** is a pg-boss cron schedule, because hourly is exactly
 * what cron is good at and a missed hour should not be replayed — §7.8's digest
 * belongs to an evening, and an evening that has passed is not worth sending.
 *
 * **The upload sweep** (§20.9, slice 18) is the fourth thing, and it is a cron
 * schedule for the opposite reason the outbox sweep is an interval: nothing is
 * waiting on it. An abandoned upload occupying storage for an extra fifty-nine
 * minutes costs a fraction of a cent; a mention taking a minute to arrive is a
 * product that feels broken. Latency budgets are what decide between these two
 * mechanisms, not consistency.
 */

/**
 * How often the sweep looks for undelivered outbox rows.
 *
 * Five seconds is the latency budget for "somebody mentioned you", not a tuning
 * knob. It is one indexed query against a partial index over rows that are
 * almost always zero in number, which is cheap enough that the interval can be
 * chosen for how the product feels rather than for what the database can take.
 */
const SWEEP_MS = 5_000;

/** Hourly, on the hour. Each workspace decides whether it is evening there. */
const DIGEST_CRON = '0 * * * *';

/**
 * §20.9's sweeper, hourly and deliberately off the hour.
 *
 * Twenty past, so it does not contend with the digest tick for the pool at the
 * exact moment every workspace in an evening timezone is being asked whether it
 * is 18:00 there. Both are cheap; sharing an instant is a habit worth not
 * forming.
 */
const SWEEP_CRON = '20 * * * *';

export async function startWorker(): Promise<{ stop: () => Promise<void> }> {
  const boss = await startBoss();

  await boss.createQueue(NOTIFY_QUEUE);
  await boss.createQueue(DIGEST_WORKSPACE_QUEUE);
  await boss.createQueue(DIGEST_TICK_QUEUE);
  await boss.createQueue(SWEEP_QUEUE);

  await boss.work<NotifyJob>(NOTIFY_QUEUE, async ([job]) => {
    if (job) await deliverNotification(job.data);
  });

  await boss.work<DigestJob>(DIGEST_WORKSPACE_QUEUE, async ([job]) => {
    if (job) await sendWorkspaceDigest(job.data);
  });

  await boss.work(DIGEST_TICK_QUEUE, async () => {
    await tickDigests(boss);
  });

  /**
   * §20.9's sweeper. One handler and one cron line, exactly as §20.9 says —
   * "the worker and the schedule both already exist".
   *
   * A pg-boss job rather than a bare interval, because unlike the outbox sweep
   * this one deletes things: a failure deserves the retry, the backoff and the
   * dead-letter queue pg-boss already provides, and a partial pass is safe to
   * repeat because `sweepAbandonedUploads` is idempotent by construction.
   */
  await boss.work(SWEEP_QUEUE, async () => {
    const result = await sweepAbandonedUploads();
    if (result.scanned > 0) {
      console.log(
        `[jobs] swept ${result.deleted}/${result.scanned} abandoned uploads` +
          (result.failed > 0 ? ` (${result.failed} failed)` : ''),
      );
    }
  });

  /**
   * Idempotent by name: re-scheduling on every boot is how the schedule stays
   * correct across a deploy that changes the cron expression, and how a fresh
   * database gets one at all.
   */
  await boss.schedule(DIGEST_TICK_QUEUE, DIGEST_CRON);
  await boss.schedule(SWEEP_QUEUE, SWEEP_CRON);

  const sweep = setInterval(() => {
    void runSweep(boss);
  }, SWEEP_MS);

  // The interval must not be what keeps the process alive: a worker whose only
  // remaining reason to run is its own timer should still exit on a signal.
  sweep.unref();

  // One immediately, so a restart does not leave whatever arrived during the
  // downtime waiting another five seconds.
  void runSweep(boss);

  return {
    stop: async () => {
      clearInterval(sweep);
      await stopBoss();
      await closePlatformDb();
      await closePool();
    },
  };
}

/**
 * A sweep that throws must not take the worker down with it.
 *
 * The failure that matters here is transient — a connection dropped, a database
 * restarted — and the correct response to all of them is to try again in five
 * seconds. Logging the message and the interval carrying on *is* the retry.
 */
async function runSweep(boss: PgBoss): Promise<void> {
  try {
    await drainOutbox(boss);
  } catch (error) {
    console.error('[jobs] outbox sweep failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * True when this file is the process's entry point rather than an import.
 *
 * Compared against `argv[1]` rather than gated on an environment variable,
 * because `VAR=1 tsx …` in a package script is a POSIX-shell construction and
 * this repo is developed on Windows, where npm scripts run under cmd.exe and it
 * silently is not a variable assignment at all.
 */
const isEntryPoint =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

/**
 * `pnpm jobs`. Behind the guard so the module can be imported by tests, which
 * drive `startWorker` — or the handlers directly — without a process that
 * installs signal handlers and never returns.
 */
if (isEntryPoint) {
  startWorker()
    .then(({ stop }) => {
      console.log('[jobs] worker started');

      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
          console.log(`[jobs] ${signal} — stopping`);
          void stop().then(() => process.exit(0));
        });
      }
    })
    .catch((error: unknown) => {
      console.error('[jobs] worker failed to start:', error);
      process.exit(1);
    });
}
