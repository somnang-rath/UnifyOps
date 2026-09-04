import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Link } from '@/i18n/navigation';
import { checkResetToken, type ResetOutcome } from '../../actions';

/**
 * Where a password reset link lands.
 *
 * The token is checked but **not consumed** here — see
 * `inspectVerificationToken`. A GET that spent the link would hand a working
 * reset to whichever mail scanner opened the message first and leave the
 * person a dead one, which is the single most common way this flow is got
 * wrong.
 *
 * The three failures are three sentences, rendered here rather than redirected
 * into a query flag, for the reason the verify screen gives: a redirect
 * flattens "expired" and "not valid" into one message that answers neither.
 */

const MESSAGE: Record<ResetOutcome, string> = {
  expired: 'auth.resetPassword.expired',
  already_used: 'auth.resetPassword.alreadyUsed',
  unknown: 'auth.resetPassword.unknown',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.resetPassword' });
  return { title: t('title') };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const failure = await checkResetToken(token);
  const t = await getTranslations();

  if (failure) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('auth.resetPassword.title')}
        </h1>

        {/* Expired and already-used are recoverable in one click and read as
            warnings; a token that names nothing is the one that suggests a
            mangled link or a forgery, so it is the only danger. */}
        <Alert tone={failure === 'unknown' ? 'danger' : 'warning'}>{t(MESSAGE[failure])}</Alert>

        <Link
          href="/forgot-password"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
        >
          {t('auth.resetPassword.requestAnother')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('auth.resetPassword.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('auth.resetPassword.subtitle')}</p>
      </header>

      <ResetPasswordForm token={token} />
    </div>
  );
}
