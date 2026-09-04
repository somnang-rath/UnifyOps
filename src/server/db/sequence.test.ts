import { describe, expect, it } from 'vitest';
import { inSequence, mapInSequence } from './sequence';

/**
 * What is pinned here is the absence of overlap, not the results.
 *
 * `Promise.all` over a shared `withActor` transaction was never concurrent —
 * `pg` queued the second query behind the first, on the one client the
 * transaction holds — and in `pg` 9 the queue is gone, so what is deprecated
 * today fails outright then. These two helpers are the shape that survives it,
 * and a test that only checked the returned tuple would still pass if somebody
 * put `Promise.all` back inside them.
 */
describe('inSequence', () => {
  it('starts nothing until the step before it has resolved', async () => {
    const events: string[] = [];
    const step = (name: string) => async () => {
      events.push(`start ${name}`);
      await Promise.resolve();
      await Promise.resolve();
      events.push(`end ${name}`);
      return name;
    };

    const result = await inSequence(step('a'), step('b'), step('c'));

    expect(result).toEqual(['a', 'b', 'c']);
    expect(events).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ]);
  });

  it('keeps each step to its own type rather than widening to one union', async () => {
    const [rows, count, missing] = await inSequence(
      async () => [{ id: 'x' }],
      async () => 2,
      async () => undefined,
    );

    // Type-level assertions: these would not compile if the tuple collapsed.
    expect(rows[0]?.id).toBe('x');
    expect(count + 1).toBe(3);
    expect(missing).toBeUndefined();
  });

  it('rejects on the first failure and runs nothing after it', async () => {
    const ran: string[] = [];

    await expect(
      inSequence(
        async () => {
          ran.push('first');
        },
        async () => {
          throw new Error('boom');
        },
        async () => {
          ran.push('third');
        },
      ),
    ).rejects.toThrow('boom');

    expect(ran).toEqual(['first']);
  });
});

describe('mapInSequence', () => {
  it('never has two callbacks in flight at once', async () => {
    let inFlight = 0;
    let peak = 0;

    const result = await mapInSequence([1, 2, 3, 4], async (value, index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return value * 10 + index;
    });

    expect(peak).toBe(1);
    expect(result).toEqual([10, 21, 32, 43]);
  });
});
