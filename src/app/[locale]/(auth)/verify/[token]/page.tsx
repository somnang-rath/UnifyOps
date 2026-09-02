import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { readCurrentUser } from '@/server/auth/session';
import { verifyEmail, type VerifyOutcome } from '../../actions';

/**
 * Where a verification link lands.
 *
 * All four outcomes are rendered here rather than redirected away with a query
 * flag, because three of them are failures that have to *say something* — §11's
 * error state. "That link has expired" and "that link is not valid" are
 * different sentences, and a redirect flattens them into one.
 */

const TONE: Record<VerifyOutcome, 'success' | 'warning' | 'danger'> = {
  verified: 'success',
  expired: 'warning',
  already_used: 'warning',
  unknown: 'danger',
};

const MESSAGE: Record<VerifyOutcome, string> = {
  verified: 'auth.verify.success',
  expired: 'auth.verify.expired',
  already_used: 'auth.verify.alreadyUsed',
  unknown: 'auth.verify.unknown',
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const outcome = await verifyEmail(token);
  const t = await getTranslations();
  const user = await readCurrentUser();

  return (
    <div className="space-y-6">
      <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
        {t('auth.verify.title')}
      </h1>

      <Alert tone={TONE[outcome]}>{t(MESSAGE[outcome])}</Alert>

      {/* A link, styled to read as the primary action — not a Button wrapping
          a link. The destination differs by whether they are signed in, and
          this is navigation either way; making it a <button> would take the
          middle-click and the open-in-new-tab away for no gain. */}
      <Link
        href={user ? '/' : '/sign-in'}
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
      >
        {t('auth.verify.continue')}
      </Link>
    </div>
  );
}
