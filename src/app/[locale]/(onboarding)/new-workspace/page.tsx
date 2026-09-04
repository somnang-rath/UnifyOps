import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CreateWorkspaceForm } from '@/components/onboarding/create-workspace-form';
import { OnboardingStep } from '@/components/onboarding/onboarding-step';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { readCurrentUser } from '@/server/auth/session';
import { redirect } from '@/i18n/navigation';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'onboarding.workspace' });
  return { title: t('title') };
}

export default async function NewWorkspacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await readCurrentUser();
  if (!user) redirect({ href: '/sign-in', locale });

  const t = await getTranslations('onboarding.workspace');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 px-6 py-4">
        <ThemeToggle />
        <LocaleSwitcher />
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-6 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm space-y-6">
          <header className="space-y-1">
            <OnboardingStep current={1} />
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              {t('title')}
            </h1>
            <p className="text-sm text-text-muted">{t('subtitle')}</p>
          </header>

          <CreateWorkspaceForm />
        </div>
      </main>
    </div>
  );
}
