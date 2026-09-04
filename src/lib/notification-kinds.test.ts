import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_KINDS,
  effectiveDefaults,
  isNotificationChannel,
  isNotificationKind,
  wants,
} from './notification-kinds';

describe('notification kinds', () => {
  it('gives every kind a channel list and a default', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(CHANNELS[kind], kind).toBeDefined();
      expect(DEFAULT_PREFERENCES[kind], kind).toBeDefined();
    }
  });

  it('never defaults a kind to a channel it cannot use', () => {
    for (const kind of NOTIFICATION_KINDS) {
      for (const channel of DEFAULT_PREFERENCES[kind]) {
        expect(CHANNELS[kind], `${kind} defaults to ${channel}`).toContain(channel);
      }
    }
  });

  it('keeps the digest to email', () => {
    // Not a default anybody can change: an in-app digest would be a list of
    // items one click from the list of items it summarises.
    expect(CHANNELS.digest).toEqual(['email']);
  });

  it('emails about being named and being given work, and not about everything else', () => {
    // §7.8's stated failure mode is a product whose mail a team learns to
    // filter. Mentions and assignment are somebody asking for you by name;
    // ordinary item traffic is not.
    expect(DEFAULT_PREFERENCES.mention).toContain('email');
    expect(DEFAULT_PREFERENCES.assignment).toContain('email');
    expect(DEFAULT_PREFERENCES.item_activity).not.toContain('email');
    expect(DEFAULT_PREFERENCES.comment).not.toContain('email');
  });
});

describe('wants', () => {
  it('falls back to the default when nothing has been saved', () => {
    expect(wants({}, 'mention', 'email')).toBe(true);
    expect(wants({}, 'comment', 'email')).toBe(false);
  });

  it('lets a saved choice override the default in both directions', () => {
    expect(wants({ mention: [] }, 'mention', 'email')).toBe(false);
    expect(wants({ comment: ['in_app', 'email'] }, 'comment', 'email')).toBe(true);
  });

  it('treats an empty saved list as off, not as absent', () => {
    // The distinction the schema comment rests on: a row exists only where
    // somebody made a choice, so an empty array is a choice and a missing row
    // is not.
    expect(wants({ mention: [] }, 'mention', 'in_app')).toBe(false);
    expect(wants({}, 'mention', 'in_app')).toBe(true);
  });

  it('refuses a channel the kind cannot use, whatever was saved', () => {
    expect(wants({ digest: ['in_app'] }, 'digest', 'in_app')).toBe(false);
  });
});

describe('the guards', () => {
  it('accept what is in the closed sets and nothing else', () => {
    expect(isNotificationKind('mention')).toBe(true);
    expect(isNotificationKind('Mention')).toBe(false);
    expect(isNotificationKind('work_item.updated')).toBe(false);
    expect(isNotificationChannel('email')).toBe(true);
    expect(isNotificationChannel('telegram')).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* §6-6's three layers (slice 15)                                            */
/* ------------------------------------------------------------------------- */

describe('workspace notification defaults', () => {
  /**
   * The order is the decision, and it is what these cases pin: **a member's own
   * row, then the company's default, then the product's.**
   *
   * §6-6 puts per-user preferences in v1 and the rules engine that could
   * overrule them in Phase 2 — so a company default is a *default*. A company
   * able to force email on somebody has built the thing §7.8 says teaches a team
   * to filter the product's mail, and the second case below is the one that
   * would catch that being built by accident.
   */
  it('falls through to the company when the member has no row', () => {
    expect(wants({}, 'comment', 'email')).toBe(false);
    expect(wants({}, 'comment', 'email', { comment: ['in_app', 'email'] })).toBe(true);
  });

  it('lets the member override the company, in both directions', () => {
    // On, where the company said off.
    expect(wants({ comment: ['email'] }, 'comment', 'email', { comment: [] })).toBe(true);
    // Off, where the company said on — the direction that must keep working.
    expect(wants({ mention: [] }, 'mention', 'email', { mention: ['in_app', 'email'] })).toBe(
      false,
    );
  });

  it('treats an empty company row as "off", not as "absent"', () => {
    // Absent means the layer below; an empty array is a row that exists and
    // says so. Collapsing the two would make turning a kind off impossible.
    expect(wants({}, 'mention', 'email', { mention: [] })).toBe(false);
    expect(wants({}, 'mention', 'email', {})).toBe(true);
  });

  it('still refuses a channel the kind cannot use', () => {
    // The digest is email-only by construction (§7.8): an in-app digest is a
    // list of items one click from the list of items it summarises. A company
    // default cannot conjure the channel into existence.
    expect(wants({}, 'digest', 'in_app', { digest: ['in_app', 'email'] })).toBe(false);
  });

  it('reports what a member with no choices would get', () => {
    const effective = effectiveDefaults({ comment: ['in_app', 'email'] });
    // The company's override where there is one...
    expect(effective.comment).toEqual(['in_app', 'email']);
    // ...and the product's everywhere else, so the word "default" on the
    // preference screen is honest.
    expect(effective.mention).toEqual(DEFAULT_PREFERENCES.mention);
    expect(Object.keys(effective).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
