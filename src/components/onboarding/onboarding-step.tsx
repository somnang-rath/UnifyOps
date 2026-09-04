import { getTranslations } from 'next-intl/server';

/**
 * The one-line position marker on §7.1's three screens.
 *
 * §7.1's rule is that "no configuration step exists anywhere in this path", and
 * a counter does not add one — it says the path is finite. §15-1 measures this
 * flow with "someone who has never seen it", and the failure that measurement
 * catches is not confusion about a field, it is abandonment three screens in by
 * somebody who has no idea how many more there are. Two words of type buy that
 * back for nothing.
 *
 * It is a marker and never a nav: the steps are not clickable, because going
 * back to a company you have already created is not a thing this path can do.
 */
export async function OnboardingStep({ current }: { current: 1 | 2 | 3 }) {
  const t = await getTranslations('onboarding');

  return (
    <p className="text-2xs font-medium uppercase tracking-wide text-text-subtle">
      {t('step', { current, total: 3 })}
    </p>
  );
}
