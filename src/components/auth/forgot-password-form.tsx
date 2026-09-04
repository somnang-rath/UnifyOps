'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import {
  PASSWORD_RESET_REQUEST_IDLE,
  type PasswordResetRequestState,
} from '@/lib/form-state';
import { requestPasswordReset } from '@/app/[locale]/(auth)/actions';

/**
 * §4's "forgot password", the asking half.
 *
 * The confirmation replaces the form rather than sitting above it. Leaving the
 * form on screen invites a second submit, and a second submit invalidates the
 * link the first one sent (`issueVerificationToken` revokes the previous
 * unused token by design) — so somebody clicking twice would be sent a live
 * link and then quietly have it killed while the dead one is the one in their
 * inbox. "Send it again" is offered explicitly instead, which makes the
 * re-issue a choice rather than an accident.
 */
export function ForgotPasswordForm() {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<PasswordResetRequestState, FormData>(
    requestPasswordReset,
    PASSWORD_RESET_REQUEST_IDLE,
  );

  if (state.sent) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{t('auth.forgotPassword.sent')}</Alert>

        <Link
          href="/sign-in"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
        >
          {t('auth.forgotPassword.backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <InputField
        label={t('auth.forgotPassword.email')}
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fields?.email && t(state.fields.email)}
      />

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {t('auth.forgotPassword.submit')}
      </Button>

      <p className="text-center text-xs text-text-muted">
        <Link href="/sign-in" className="text-accent underline underline-offset-2">
          {t('auth.forgotPassword.backToSignIn')}
        </Link>
      </p>
    </form>
  );
}
