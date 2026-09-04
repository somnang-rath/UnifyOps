'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { setAvailabilityAction } from '@/app/[locale]/[workspaceSlug]/actions';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { IDLE } from '@/lib/form-state';
import {
  MAX_REASON_GRAPHEMES,
  MAX_UNAVAILABLE_DAYS,
  validateAvailability,
} from '@/lib/availability';
import { addDays } from '@/lib/workspace-date';

/**
 * §4's availability flag, as a control (§7.4, §17-25).
 *
 * "A member can be marked *unavailable until* a date, with an optional reason.
 * Workload and Needs Attention read it; nothing else does. **It is one date — no
 * hours, no balances, no approval flow** — because time tracking is a §3
 * non-goal."
 *
 * The shape of this form is that sentence. A date, a reason, and a button that
 * clears both. There is deliberately no range picker, no half-day, and no
 * "request leave" — each of them is the first step towards the feature §3 rules
 * out, and each would need a screen for whoever approves it.
 *
 * **One component, two callers.** A member setting their own on the settings
 * page, and an Admin setting somebody else's from the member list — the same
 * form and the same action, because the rule about who may do it lives in the
 * service (`setAvailability`) rather than in two copies of a permission check.
 *
 * §11's five states:
 *
 *   `[L]` The button carries its own pending label; the fields stay live, so a
 *         slow save never eats a keystroke.
 *   `[E]` Nothing to be empty — the empty value *is* "available", and the form
 *         says so above the date.
 *   `[S]` The page revalidates and the badge appears beside the name. No toast:
 *         the result is on the screen already (§11).
 *   `[X]` A refusal replaces the help text under the field that caused it,
 *         translated from a key (§13) — never a sentence from the server.
 *   `[!]` A past date is refused rather than silently cleared (that is a typo
 *         every time); a reason without a date is refused rather than dropped;
 *         the reason is capped by **grapheme**, so a Khmer sentence gets the
 *         same room an English one does (§13).
 */

export function AvailabilityForm({
  workspaceSlug,
  locale,
  memberId,
  today,
  unavailableUntil,
  unavailableReason,
  /** Somebody else's flag, so the wording says whose. */
  memberName,
  compact = false,
}: {
  workspaceSlug: string;
  locale: string;
  memberId: string;
  /** Today in the **workspace's** zone (§17-13) — the min the date input accepts. */
  today: string;
  unavailableUntil: string | null;
  unavailableReason: string | null;
  memberName?: string;
  compact?: boolean;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(setAvailabilityAction, IDLE);

  // Controlled, so the client can refuse what the server would refuse — the
  // same bargain `parseRecipients` makes between the invite form's chips and the
  // send. One implementation of the rule, in `src/lib/availability.ts`.
  const [until, setUntil] = useState(unavailableUntil ?? '');
  const [reason, setReason] = useState(unavailableReason ?? '');

  const checked = validateAvailability(
    { until: until === '' ? null : until, reason: reason === '' ? null : reason },
    today,
  );

  // The server's refusal wins where there is one — it saw the state the write
  // actually met — and the client's stands in before a submit.
  const problem = state.error ?? (checked.ok ? null : `availability.errors.${camel(checked.problem)}`);

  return (
    // A fragment, because the "I'm back" control below is its own form and a
    // form inside a form is not valid HTML — the browser drops the inner one and
    // the button silently stops submitting anything.
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
    <form action={action} className={compact ? 'space-y-2' : 'space-y-4'}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="memberId" value={memberId} />

      <div className={compact ? 'flex flex-wrap items-end gap-2' : 'space-y-3'}>
        <InputField
          type="date"
          name="until"
          label={memberName ? t('availability.untilFor', { name: memberName }) : t('availability.until')}
          help={t('availability.untilHelp')}
          value={until}
          onChange={(event) => setUntil(event.target.value)}
          // The browser refuses the same dates the service does, which is a
          // courtesy rather than the enforcement — `validateAvailability` and
          // migration 0024 are the two layers that actually hold.
          min={addDays(today, 1)}
          max={addDays(today, MAX_UNAVAILABLE_DAYS)}
          className={compact ? 'w-40' : undefined}
        />

        <InputField
          name="reason"
          label={t('availability.reason')}
          help={t('availability.reasonHelp')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          // Not `maxLength`: the attribute counts UTF-16 code units, which gives
          // a Khmer sentence a third of the room an English one gets and cuts it
          // mid-syllable. The cap is by grapheme, checked above (§13).
          placeholder={t('availability.reasonPlaceholder')}
          disabled={until === ''}
          error={problem ? t(problem) : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!checked.ok}>
          {until === '' ? t('availability.clear') : t('availability.save')}
        </Button>

        {!compact && (
          <p className="text-xs text-text-subtle">
            {t('availability.limits', { days: MAX_UNAVAILABLE_DAYS, chars: MAX_REASON_GRAPHEMES })}
          </p>
        )}
      </div>
    </form>

      {unavailableUntil !== null && (
        <ReturnNowForm workspaceSlug={workspaceSlug} locale={locale} memberId={memberId} />
      )}
    </div>
  );
}

/**
 * "I'm back" — one click, its own form.
 *
 * Its own `<form>` rather than a second submit button inside the one above,
 * because that button would have to beat a *controlled* date input to the
 * FormData: clearing the field in `onClick` schedules a React state update that
 * has not been applied by the time the submission is serialised, so the form
 * would post the old date and the flag would not clear. A separate form posting
 * an empty hidden field cannot get that wrong.
 *
 * §6's safety rule is "no setting can put a workspace in an unrecoverable
 * state", and the shape of it matters here: coming back early must never be
 * harder than going away.
 */
function ReturnNowForm({
  workspaceSlug,
  locale,
  memberId,
}: {
  workspaceSlug: string;
  locale: string;
  memberId: string;
}) {
  const t = useTranslations();
  const [, action, pending] = useActionState(setAvailabilityAction, IDLE);

  return (
    <form action={action}>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="until" value="" />
      <input type="hidden" name="reason" value="" />
      <Button type="submit" size="sm" loading={pending}>
        {t('availability.back')}
      </Button>
    </form>
  );
}

/** `past_date` → `pastDate`. The problems are snake_case; the message keys are not. */
function camel(problem: string): string {
  return problem.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
