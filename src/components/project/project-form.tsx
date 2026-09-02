'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { IDLE, type FormState } from '@/lib/form-state';
import { deriveProjectKey, normalizeProjectKey } from '@/lib/project-key';
import { displayName } from '@/lib/seeded-name';
import { slugify } from '@/lib/slug';
import { createProjectAction } from '@/app/[locale]/[workspaceSlug]/projects/actions';

/**
 * §7.1's last step before the board: "Create project — name entered; prefix
 * auto-suggested".
 *
 * Both derivations run here as the user types, using the same pure functions
 * the server validates with, so the preview cannot promise something the save
 * does not do. And both stop the moment the person edits the field themselves:
 * a field that keeps overwriting what someone typed is worse than no suggestion
 * at all.
 *
 * The prefix is the one value on this form that cannot be changed afterwards —
 * it is printed on every item identifier that will ever be pasted into a chat
 * message — so it is shown, explained, and editable here rather than derived
 * silently.
 */

export type TeamOption = {
  id: string;
  name: string;
  nameKey: string | null;
};

export function ProjectForm({
  workspaceSlug,
  teams,
}: {
  workspaceSlug: string;
  teams: TeamOption[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, IDLE);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);

  const derivedSlug = slugEdited ? slug : slugify(name);
  const derivedKey = keyEdited ? key : name ? deriveProjectKey(name) : '';

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <InputField
        label={t('projects.name')}
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
        error={state.fields?.name && t(state.fields.name)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label={t('projects.key')}
          name="key"
          value={derivedKey}
          onChange={(e) => {
            setKeyEdited(true);
            setKey(normalizeProjectKey(e.target.value));
          }}
          // The example is built from the live value, so the consequence of the
          // field is visible while it is being typed rather than after the
          // first item is created.
          help={t('projects.keyHint', { example: `${derivedKey || 'ENG'}-142` })}
          error={state.fields?.key && t(state.fields.key)}
          spellCheck={false}
          className="uppercase"
        />

        <InputField
          label={t('projects.slug')}
          name="slug"
          value={derivedSlug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(slugify(e.target.value));
          }}
          help={t('projects.slugHint')}
          error={state.fields?.slug && t(state.fields.slug)}
          inputMode="url"
          spellCheck={false}
        />
      </div>

      {/* One team is the seeded default, and offering a choice of one is a step
          that exists to be clicked past (§6: settings are never on the critical
          path). The value still posts, so the server reads one shape either way. */}
      {teams.length > 1 ? (
        <SelectField label={t('projects.team')} name="teamId" defaultValue={teams[0]?.id}>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {displayName(team, t)}
            </option>
          ))}
        </SelectField>
      ) : (
        teams[0] && <input type="hidden" name="teamId" value={teams[0].id} />
      )}

      <SelectField
        label={t('projects.visibility')}
        name="visibility"
        defaultValue="workspace"
      >
        <option value="workspace">{t('projects.visibilityWorkspace')}</option>
        <option value="private">{t('projects.visibilityPrivate')}</option>
      </SelectField>

      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        {pending ? t('projects.creating') : t('projects.submit')}
      </Button>
    </form>
  );
}
