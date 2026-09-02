'use client';

import { useActionState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';
import { IDLE, type FormState } from '@/lib/form-state';
import { signUp } from '@/app/[locale]/(auth)/actions';

/** §7.1's signup: three fields, no configuration step, straight into the product. */
export function SignUpForm({ inviteToken }: { inviteToken?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(signUp, IDLE);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {inviteToken && <input type="hidden" name="inviteToken" value={inviteToken} />}

      <InputField
        label={t('auth.signUp.name')}
        name="name"
        autoComplete="name"
        required
        error={state.fields?.name && t(state.fields.name)}
      />

      <InputField
        label={t('auth.signUp.email')}
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fields?.email && t(state.fields.email)}
      />

      <InputField
        label={t('auth.signUp.password')}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        // Help text rather than a placeholder: the rule has to still be
        // readable while they are typing, which is exactly when a placeholder
        // is gone (§12).
        help={t('auth.signUp.passwordHint')}
        error={state.fields?.password && t(state.fields.password)}
      />

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {t('auth.signUp.submit')}
      </Button>

      <p className="text-center text-xs text-text-muted">
        {t('auth.signUp.haveAccount')}{' '}
        <Link
          href={inviteToken ? `/sign-in?invite=${encodeURIComponent(inviteToken)}` : '/sign-in'}
          className="text-accent underline underline-offset-2"
        >
          {t('auth.signUp.signIn')}
        </Link>
      </p>
    </form>
  );
}
