import { describe, expect, it, vi } from 'vitest';
import { createPool } from './pool';

/**
 * The regression this pins is not a failing query — it is a dead process.
 *
 * `pg` emits `'error'` on the Pool when a client that is idle in it loses its
 * backend, and Node rethrows an unhandled `'error'` event as an uncaughtException.
 * Under `next dev` that kills the render worker, and what reaches the browser is
 * "Jest worker encountered 2 child process exceptions, exceeding retry limit" —
 * a message with no stack, no route and no mention of Postgres.
 *
 * No database here on purpose: a Pool opens no socket until something asks for a
 * client, so emitting the event directly tests the one thing that matters.
 */
describe('createPool', () => {
  it('survives an error on an idle client instead of crashing the process', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('test', {});

    // Without a listener this call throws, and in a real process it is fatal.
    expect(() => pool.emit('error', new Error('boom'), null as never)).not.toThrow();

    log.mockRestore();
  });

  it('logs the message and SQLSTATE, and never the client', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('app', {});

    const error = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      // A pg error carries the Client, whose connectionParameters hold the
      // password. Logging the object rather than the message leaks it.
      client: { connectionParameters: { password: 'hunter2' } },
    });
    pool.emit('error', error, null as never);

    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0]?.join(' ') ?? '';
    expect(line).toContain('[db:app]');
    expect(line).toContain('terminating connection due to administrator command');
    expect(line).toContain('57P01');
    expect(line).not.toContain('hunter2');

    log.mockRestore();
  });
});
