'use client';

import { useOptimistic, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { NotificationChannel, NotificationKind } from '@/lib/notification-kinds';
import { useToast } from '@/components/ui/toast';

/**
 * §6-6's per-user notification preferences.
 *
 * A grid of independent switches rather than a form with a Save button, because
 * every cell is a complete decision on its own: there is nothing to validate
 * across rows, nothing to submit as a unit, and no state where half the grid is
 * meaningful. Each toggle saves itself, optimistically, and §11's rule holds —
 * no toast when the result is visible on screen, one when it fails.
 *
 * **The control is a native checkbox, not §12's Switch.** Switch is in the §12
 * inventory and is not built yet; building it here, for this screen, is how a
 * design system ends up with two of them. A checkbox already carries the role,
 * the keyboard behaviour and the label association that a Switch would have to
 * be given by hand, and when Switch is built this screen changes one element
 * name. What it must not do is be a `div` with an `onClick`.
 */

export type PreferenceRow = {
  kind: NotificationKind;
  available: readonly NotificationChannel[];
  enabled: readonly NotificationChannel[];
  customised: boolean;
};

const CHANNEL_ORDER: readonly NotificationChannel[] = ['in_app', 'email'];

export function PreferencesGrid({
  rows,
  onSave,
}: {
  rows: PreferenceRow[];
  onSave: (kind: NotificationKind, channels: NotificationChannel[]) => Promise<boolean>;
}) {
  const t = useTranslations('notificationSettings');
  const toast = useToast();
  const [, startSaving] = useTransition();

  const [optimistic, apply] = useOptimistic(
    rows,
    (current: PreferenceRow[], change: { kind: NotificationKind; channels: NotificationChannel[] }) =>
      current.map((row) =>
        row.kind === change.kind ? { ...row, enabled: change.channels, customised: true } : row,
      ),
  );

  const toggle = (row: PreferenceRow, channel: NotificationChannel, on: boolean) => {
    const channels = on
      ? [...new Set([...row.enabled, channel])]
      : row.enabled.filter((value) => value !== channel);

    startSaving(async () => {
      apply({ kind: row.kind, channels });
      const ok = await onSave(row.kind, channels);
      if (!ok) toast({ tone: 'danger', message: t('errors.failed') });
    });
  };

  return (
    /*
     * `relative` is load-bearing, not decoration — it is what makes the
     * scroller a **containing block**.
     *
     * `overflow-x: auto` does not clip an absolutely-positioned descendant
     * whose containing block is outside the scroller, and every checkbox in
     * this grid carries an `sr-only` label, which is `position: absolute`. On
     * a static wrapper those labels resolve against the initial containing
     * block at their static position — 430px into a 512px table — so the
     * *document* grew to 432px at a 390px viewport while the table itself
     * scrolled correctly. §15-6's check found it; nothing on screen showed it,
     * because a 1×1 clipped label is invisible in every sense but this one.
     */
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-start">
            <th scope="col" className="py-2 pe-4 text-start font-medium text-text-muted">
              {t('title')}
            </th>
            {CHANNEL_ORDER.map((channel) => (
              <th
                key={channel}
                scope="col"
                className="w-24 py-2 text-start font-medium text-text-muted"
              >
                {t(`channel.${channel}`)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {optimistic.map((row) => (
            <tr key={row.kind}>
              <th scope="row" className="py-3 pe-4 text-start font-normal">
                <span className="block text-text">{t(`kind.${row.kind}`)}</span>
                <span className="block text-2xs text-text-subtle">{t(`hint.${row.kind}`)}</span>
              </th>

              {CHANNEL_ORDER.map((channel) => {
                const available = row.available.includes(channel);
                const checked = row.enabled.includes(channel);
                const id = `pref-${row.kind}-${channel}`;

                return (
                  <td key={channel} className="py-3 align-top">
                    {available ? (
                      <span className="inline-flex items-center gap-2">
                        <input
                          id={id}
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggle(row, channel, event.target.checked)}
                          className="h-4 w-4 rounded-xs border border-border accent-accent"
                        />
                        {/*
                          The visible column header is the label for sighted
                          readers; this one names the pair for everybody else, so
                          a screen reader hears "Mentions, Email" rather than an
                          unlabelled checkbox in a grid of nine.
                        */}
                        <label htmlFor={id} className="sr-only">
                          {t(`kind.${row.kind}`)} — {t(`channel.${channel}`)}
                        </label>
                      </span>
                    ) : (
                      <span className="text-2xs text-text-subtle">{t('unavailable')}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
