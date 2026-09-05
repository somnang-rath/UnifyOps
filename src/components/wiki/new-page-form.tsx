'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { InputField, SelectField, TextareaField } from '@/components/ui/field';
import { WIKI_PAGE_IDLE, type WikiPageFormState } from '@/lib/form-state';
import { hasKhmer } from '@/lib/search';
import { graphemeLength, MAX_PAGE_BODY_LENGTH, MAX_PAGE_TITLE_LENGTH } from '@/lib/wiki';

/**
 * §20.3.2's create form.
 *
 * Deliberately not the editor: a new page has no revision to be stale against,
 * no history and nothing to preview until something is typed, and reusing
 * `PageEditor` would mean threading "is this a create" through every branch of a
 * component whose whole job is §20.3.3's refusal. Two small forms beat one form
 * with a mode.
 *
 * **A title and nothing else is a complete page** (§20.11: "an empty page reads
 * as empty, not as broken"). The body is optional here where a note's is
 * required, because a page created as a placeholder for something somebody will
 * write next week is a real thing a wiki holds and is reachable in the sidebar
 * by its title.
 */
export function NewPageForm({
  workspaceSlug,
  locale,
  spaceId,
  parents,
  create,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  spaceId: string;
  parents: { id: string; title: string; depth: number }[];
  create: (previous: WikiPageFormState, formData: FormData) => Promise<WikiPageFormState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(create, WIKI_PAGE_IDLE);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const overLength = graphemeLength(body) > MAX_PAGE_BODY_LENGTH;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="spaceId" value={spaceId} />

      {state.error && (
        <Alert tone="danger">
          {t(state.error.replace(/^wiki\./, ''), {
            names: (state.names ?? []).join(', '),
          })}
        </Alert>
      )}

      <InputField
        label={t('editor.titleLabel')}
        name="title"
        required
        autoFocus
        maxLength={MAX_PAGE_TITLE_LENGTH * 4}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        lang={hasKhmer(title) ? 'km' : undefined}
      />

      {parents.length > 0 && (
        <SelectField label={t('new.parentLabel')} name="parentId" defaultValue="">
          <option value="">{t('new.parentNone')}</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {/*
                Indented by depth with figure spaces rather than nbsp, so the
                nesting is legible in a native select — which cannot take markup
                and is the right control for a list this short (§12 has no
                tree-select and inventing one for this screen is how a design
                system ends up with two).
              */}
              {' '.repeat((parent.depth - 1) * 2)}
              {parent.title}
            </option>
          ))}
        </SelectField>
      )}

      <TextareaField
        label={t('editor.bodyLabel')}
        name="body"
        rows={14}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        lang={hasKhmer(body) ? 'km' : undefined}
        help={t('editor.bodyHelp')}
        error={overLength ? t('editor.tooLong', { max: MAX_PAGE_BODY_LENGTH }) : undefined}
        className="font-mono"
      />

      <Button type="submit" disabled={pending || overLength}>
        {pending ? t('new.creating') : t('new.create')}
      </Button>
    </form>
  );
}
