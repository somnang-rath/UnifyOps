'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { IDLE, type FormState } from '@/lib/form-state';
import { signIn } from '@/app/[locale]/(auth)/actions';

/**
 * §7.1's sign-in half.
 *
 * The action returns message *keys*; this looks them up. That is what keeps a
 * failed sign-in identical in both languages — a server that returned "That
 * email and password do not match" would be an English sentence with no Khmer
 * counterpart, which §13 calls the most expensive mistake available here.
 */
export function SignInForm({ inviteToken }: { inviteToken?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, IDLE);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {/* Carried from the invite link, so signing in lands in the workspace
          that invited them rather than wherever they were last (§7.10). */}
      {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <InputField
        label={t('auth.signIn.email')}
        name="email"
        type="email"
        autoComplete="email"
        // §7.1 asks the form to be retained on error, so the browser's own
        // autofill is left to do it rather than mirroring every field into
        // state that then has to be kept correct.
        required
        error={state.fields?.email && t(state.fields.email)}
      />

      <InputField
        label={t('auth.signIn.password')}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fields?.password && t(state.fields.password)}
      />

      {/* Below the password field and above the submit, which is where a
          person looks the moment the one they typed did not work. It carries
          no invite token: a reset lands them signed in and `destinationFor`
          would have nothing to accept, and dragging an invitation through an
          email round trip is how a two-week token gets spent on the wrong
          journey. Following the invite link again still works. */}
      <p className="text-right text-xs">
        <Link
          href="/forgot-password"
          className="text-text-muted underline underline-offset-2 hover:text-text"
        >
          {t('auth.signIn.forgotPassword')}
        </Link>
      </p>

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {t('auth.signIn.submit')}
      </Button>

      <p className="text-center text-xs text-text-muted">
        {t('auth.signIn.noAccount')}{' '}
        <Link
          href={inviteToken ? `/sign-up?invite=${encodeURIComponent(inviteToken)}` : '/sign-up'}
          className="text-accent underline underline-offset-2"
        >
          {t('auth.signIn.createOne')}
        </Link>
      </p>
    </form>
  );
}
