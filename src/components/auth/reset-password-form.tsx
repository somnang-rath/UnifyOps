'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { IDLE, type FormState } from '@/lib/form-state';
import { resetPassword } from '@/app/[locale]/(auth)/actions';

/**
 * §4's "forgot password", the choosing half.
 *
 * `autoComplete="new-password"` on both fields, not `current-password`: it is
 * what stops a password manager filling the old value into the box asking for
 * the new one, and what makes it offer to generate and then *save* the new one
 * — on the single screen in the product where a saved credential is about to
 * stop working.
 *
 * Both fields carry it, including the confirmation. A manager that fills the
 * first and not the second leaves the person retyping a generated password by
 * hand, which is how a reset ends in a mismatch error on a password nobody
 * chose.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(resetPassword, IDLE);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {/* The credential itself. It is in the URL already — putting it in the
          form is what lets the POST consume it, since the action has no
          request to read the path from. */}
      <input type="hidden" name="token" value={token} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <InputField
        label={t('auth.resetPassword.password')}
        name="password"
        type="password"
        autoComplete="new-password"
        help={t('auth.resetPassword.passwordHint')}
        required
        error={state.fields?.password && t(state.fields.password)}
      />

      <InputField
        label={t('auth.resetPassword.confirm')}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={state.fields?.confirm && t(state.fields.confirm)}
      />

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {t('auth.resetPassword.submit')}
      </Button>
    </form>
  );
}
