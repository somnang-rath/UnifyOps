import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignUpForm } from '@/components/auth/sign-up-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.signUp' });
  return { title: t('title') };
}

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { invite } = await searchParams;
  const t = await getTranslations('auth.signUp');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('title')}
        </h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <SignUpForm inviteToken={invite} />
    </div>
  );
}
