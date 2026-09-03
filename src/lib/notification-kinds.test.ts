import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_KINDS,
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
