'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { IDLE, type FormState } from '@/lib/form-state';
import { slugify } from '@/lib/slug';
import {
  WEEK_DAYS,
  isWorkingWeekDay,
  toggleWorkingDay,
  type WeekDay,
} from '@/lib/workspace-date';
import { locales, localeNames } from '@/i18n/routing';
import { saveCompanySettingsAction } from '@/app/[locale]/[workspaceSlug]/settings/general/actions';

/**
 * §6-1 — everything about the company except its branding.
 *
 * **One form and one save**, because this is a screen somebody visits once,
 * changes two things on, and leaves. Six independent controls would be six
 * audit rows for one visit and six chances to leave the page half-saved.
 *
 * Two of the six fields silently change what the whole product says about time,
 * so both say so on screen rather than in a release note: the timezone decides
 * what "overdue" means for everybody (§17-13), and the working week decides
 * what "stale" and "due tomorrow" mean (§4, §17-14). A settings screen that
 * lets somebody change those without a word is how a team wakes up on Monday to
 * a Needs Attention list nobody recognises.
 */

export type CompanySettings = {
  name: string;
  slug: string;
  timezone: string;
  weekStart: number;
  workingDays: number;
  defaultLocale: string;
};

/**
 * The zone list, from the platform rather than from a bundled table.
 *
 * `Intl.supportedValuesOf` is what the service validates against, so the picker
 * cannot offer a zone the save would refuse. It is a long list and this is a
 * plain `<select>` on purpose: §12's Combobox is not built, and a one-off
 * searchable select for one screen is how a design system ends up with two of
 * them (the same call slice 9 made about the Switch).
 */
function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    // Older engines, and the one case where a short list beats an empty one:
    // the field still saves whatever is currently set, because the current
    // value is always rendered as an option below.
    return ['Asia/Phnom_Penh', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'UTC'];
  }
}

export function CompanyForm({
  workspaceSlug,
  settings,
}: {
  workspaceSlug: string;
  settings: CompanySettings;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveCompanySettingsAction,
    IDLE,
  );

  const [name, setName] = useState(settings.name);
  const [slug, setSlug] = useState(settings.slug);
  const [slugEdited, setSlugEdited] = useState(false);
  const [workingDays, setWorkingDays] = useState(settings.workingDays);

  // The same derivation the onboarding form makes, from the same pure module, so
  // the preview cannot promise something the save does not do. It stops the
  // moment somebody edits the slug themselves — a field that keeps overwriting
  // what a person typed is worse than no suggestion at all.
  const derivedSlug = slugEdited ? slug : slugify(name);

  const zones = timeZones();
  const knownZone = zones.includes(settings.timezone);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="workingDays" value={String(workingDays)} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <section className="space-y-4">
        <InputField
          label={t('settings.company.name')}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          error={state.fields?.name && t(state.fields.name)}
        />

        <InputField
          label={t('settings.company.slug')}
          name="slug"
          value={derivedSlug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          required
          // The one field on this form whose change breaks links somebody else
          // already has. Said before the click, not after it.
          help={t('settings.company.slugHelp')}
          error={state.fields?.slug && t(state.fields.slug)}
        />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          {t('settings.company.timeHeading')}
        </h2>

        <SelectField
          label={t('settings.company.timezone')}
          name="timezone"
          defaultValue={settings.timezone}
          help={t('settings.company.timezoneHelp')}
          error={state.fields?.timezone && t(state.fields.timezone)}
        >
          {/* A zone the platform no longer lists is still this company's zone,
              and a select that silently dropped it would change their setting
              the next time anybody saved anything else on this form. */}
          {!knownZone && <option value={settings.timezone}>{settings.timezone}</option>}
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={t('settings.company.weekStart')}
          name="weekStart"
          defaultValue={String(settings.weekStart)}
          help={t('settings.company.weekStartHelp')}
        >
          {WEEK_DAYS.map((day) => (
            <option key={day} value={String(day)}>
              {t(`settings.company.days.${day}`)}
            </option>
          ))}
        </SelectField>

        <WorkingDays
          value={workingDays}
          onChange={setWorkingDays}
          error={state.fields?.workingDays && t(state.fields.workingDays)}
        />
      </section>

      <section className="space-y-4">
        <SelectField
          label={t('settings.company.defaultLocale')}
          name="defaultLocale"
          defaultValue={settings.defaultLocale}
          help={t('settings.company.defaultLocaleHelp')}
        >
          {locales.map((code) => (
            <option key={code} value={code}>
              {/* The language's own name, never translated: §13's rule that a
                  language picker is unreadable to the person who needs it if it
                  is written in the language they cannot read. */}
              {localeNames[code]}
            </option>
          ))}
        </SelectField>
      </section>

      <Button type="submit" variant="primary" loading={pending}>
        {t('action.save')}
      </Button>
    </form>
  );
}

/**
 * §6-1's working week, as seven checkboxes over one integer mask.
 *
 * Native checkboxes rather than §12's Switch, which is still not built — the
 * same call slice 9 made for the notification grid, and for the same reason: a
 * checkbox already carries the role, the keyboard behaviour and the label
 * association a Switch would have to be given by hand.
 *
 * A `fieldset` with a `legend`, because seven controls that only mean something
 * together is exactly what a fieldset is for; seven labelled checkboxes with no
 * grouping read to a screen reader as seven unrelated questions.
 */
function WorkingDays({
  value,
  onChange,
  error,
}: {
  value: number;
  onChange: (next: number) => void;
  error?: string;
}) {
  const t = useTranslations('settings.company');

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-text-muted">{t('workingDays')}</legend>

      <div className="flex flex-wrap gap-1.5">
        {WEEK_DAYS.map((day) => {
          const on = isWorkingWeekDay(value, day as WeekDay);
          return (
            <label
              key={day}
              className="flex cursor-pointer items-center gap-1.5 rounded-xs border border-border bg-surface px-2.5 py-1.5 text-sm transition-colors duration-120 ease-[var(--ease-out-soft)] hover:border-border-strong has-checked:border-accent has-checked:bg-accent-subtle"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(event) => onChange(toggleWorkingDay(value, day as WeekDay, event.target.checked))}
                className="accent-accent"
              />
              {t(`days.${day}`)}
            </label>
          );
        })}
      </div>

      <p className={error ? 'text-xs text-danger' : 'text-xs text-text-subtle'}>
        {error ?? t('workingDaysHelp')}
      </p>
    </fieldset>
  );
}
