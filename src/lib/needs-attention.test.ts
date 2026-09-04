import { describe, expect, it } from 'vitest';
import {
  ATTENTION_ROWS,
  OPEN_STATE_GROUPS,
  STALE_WORKING_DAYS,
  attentionFilters,
} from './needs-attention';
import { NONE, emptyQuery, isAnchored, workItemQuerySchema } from './work-item-query';
import { summaryMarkdown } from './status-summary';

/**
 * §7.4's Needs Attention rows, and the summary that leaves the screen.
 *
 * The rows are data, so the test that matters is that each one still parses as a
 * §9 filter — a row whose override the DSL rejects would render as an empty
 * section with no error anywhere.
 */

describe('the five rows', () => {
  it('is exactly what §7.4 lists, in that order', () => {
    expect([...ATTENTION_ROWS]).toEqual([
      'overdue',
      'blocked',
      'unassigned',
      'no_due_date',
      'stale',
    ]);
  });

  it('produces a filter the DSL accepts, for every row', () => {
    const base = emptyQuery();
    for (const row of ATTENTION_ROWS) {
      const merged = {
        ...base,
        filters: { ...base.filters, ...attentionFilters(row, STALE_WORKING_DAYS) },
      };
      expect(() => workItemQuerySchema.parse(merged)).not.toThrow();
    }
  });

  it('spells unassigned with the same sentinel the assignee filter uses', () => {
    expect(attentionFilters('unassigned', 5)).toEqual({ assignees: [NONE] });
  });

  it('carries the staleness threshold and never a resolved date', () => {
    /**
     * The split that matters most in this slice. "Five working days" means the
     * same thing next Tuesday; the instant it resolves to does not — which is
     * why the service asks `stale_before` for the cutoff and the URL carries
     * only N. The same bargain `soon` makes with its horizon.
     */
    expect(attentionFilters('stale', 7)).toEqual({ stale: 7 });
  });

  it('leaves an unassigned row unanchored on its own', () => {
    /**
     * §16, and the reason every caller supplies a project set. "Everything
     * unassigned in the whole workspace" is precisely the scan the invariant
     * refuses — the `none` sentinel bounds nothing, exactly as a cycle's `none`
     * does not (slice 11).
     */
    const base = emptyQuery();
    const unanchored = {
      ...base,
      filters: { ...base.filters, ...attentionFilters('unassigned', 5) },
    };
    expect(isAnchored(workItemQuerySchema.parse(unanchored))).toBe(false);

    const anchored = {
      ...unanchored,
      filters: { ...unanchored.filters, projectIds: ['11111111-1111-4111-8111-111111111111'] },
    };
    expect(isAnchored(workItemQuerySchema.parse(anchored))).toBe(true);
  });
});

describe('open work', () => {
  it('excludes both completed and cancelled', () => {
    /**
     * §4 gives `cancelled` its own state group precisely so it can be a third
     * answer. Counted as outstanding, Needs Attention fills with work somebody
     * decided not to do and people learn to scroll past it.
     */
    expect([...OPEN_STATE_GROUPS]).toEqual(['backlog', 'unstarted', 'started']);
  });
});

describe('summaryMarkdown', () => {
  const labels = {
    title: 'Team',
    scope: 'Engineering',
    unassignedLabel: 'Unassigned',
    awayLabel: (date: string) => `away until ${date}`,
    overdueLabel: (count: number) => `${count} overdue`,
    emptyLabel: 'Nothing needs your attention.',
  };

  it('lists people with work, with their overdue count', () => {
    const markdown = summaryMarkdown({
      ...labels,
      columns: [
        { key: 'm1', name: 'Sophea', open: 4, overdue: 1, away: false, unavailableUntil: null },
        { key: 'm2', name: 'Dara', open: 2, overdue: 0, away: false, unavailableUntil: null },
      ],
    });

    expect(markdown).toContain('## Team — Engineering');
    expect(markdown).toContain('- **Sophea** — 4 · 1 overdue');
    expect(markdown).toContain('- **Dara** — 2');
  });

  it('keeps an away member with an empty queue, and drops an idle one', () => {
    /**
     * §17-25, in one assertion. Somebody free with nothing assigned adds
     * nothing to a chat message; somebody *away* with nothing assigned is the
     * one fact the reader cannot work out for themselves, and leaving it out is
     * how the picture became confidently wrong.
     */
    const markdown = summaryMarkdown({
      ...labels,
      columns: [
        { key: 'm1', name: 'Sophea', open: 0, overdue: 0, away: true, unavailableUntil: '2026-09-20' },
        { key: 'm2', name: 'Dara', open: 0, overdue: 0, away: false, unavailableUntil: null },
      ],
    });

    expect(markdown).toContain('- **Sophea** — 0 · away until 2026-09-20');
    expect(markdown).not.toContain('Dara');
  });

  it('names the unassigned column rather than printing the sentinel', () => {
    const markdown = summaryMarkdown({
      ...labels,
      columns: [{ key: 'none', name: 'none', open: 3, overdue: 0, away: false, unavailableUntil: null }],
    });

    expect(markdown).toContain('- **Unassigned** — 3');
  });

  it('says something when there is nothing, rather than pasting a blank', () => {
    // §11: never a bare absence. An empty message pasted into a chat reads as a
    // broken button.
    const markdown = summaryMarkdown({ ...labels, columns: [] });
    expect(markdown.trim().endsWith('- Nothing needs your attention.')).toBe(true);
  });

  it('carries no item titles', () => {
    /**
     * A status summary is pasted into a group chat, which is not the product's
     * access-control boundary — a line naming every task would leak a private
     * project's contents to whoever is in that channel.
     */
    const markdown = summaryMarkdown({
      ...labels,
      columns: [{ key: 'm1', name: 'Sophea', open: 1, overdue: 0, away: false, unavailableUntil: null }],
    });

    expect(markdown).not.toMatch(/ENG-\d+/);
  });
});
