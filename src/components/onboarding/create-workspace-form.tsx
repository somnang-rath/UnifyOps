'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { slugify } from '@/lib/slug';
import { WORKSPACE_IDLE, type WorkspaceFormState } from '@/lib/form-state';
import { createWorkspaceAction } from '@/app/[locale]/(onboarding)/actions';

/**
 * §7.1: "name only; slug auto-derived and editable".
 *
 * The derivation runs on the client as the user types so the address is visible
 * before they submit — which is the whole reason §7.1 calls out the Khmer case
 * (`[!]` company name is Khmer → slug transliterates to Latin, editable). It
 * imports the same pure `slugify` the server validates with, so the preview
 * cannot disagree with the result.
 *
 * Once the user edits the address themselves, the derivation stops. A field
 * that keeps overwriting what someone typed is worse than no suggestion at all.
 */
export function CreateWorkspaceForm() {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    createWorkspaceAction,
    WORKSPACE_IDLE,
  );

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  const derived = slugEdited ? slug : slugify(name);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <InputField
        label={t('onboarding.workspace.name')}
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="organization"
        autoFocus
        required
        error={state.fields?.name && t(state.fields.name)}
      />

      <InputField
        label={t('onboarding.workspace.slug')}
        name="slug"
        value={derived}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(slugify(e.target.value));
        }}
        help={t('onboarding.workspace.slugHint')}
        error={state.fields?.slug && t(state.fields.slug)}
        // Latin-only by construction — the value is always the output of
        // `slugify`, so an IME can be used in the name field above and this one
        // still holds a URL-safe string.
        inputMode="url"
        spellCheck={false}
      />

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {t('onboarding.workspace.submit')}
      </Button>
    </form>
  );
}
