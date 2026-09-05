'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { normalizePageIcon } from '@/lib/wiki';

/**
 * The page icon (§21.2 — slice 20).
 *
 * **Its own form, calling `setPageIcon`, and deliberately not a field on the
 * editor.** Folding it into `saveWikiPage` would give it two behaviours it must
 * not have: it would ride the conditional update, so changing an icon while a
 * colleague was typing would be refused as a stale save (§20.3.3) — a refusal
 * with real weight, spent on a decoration; and it would clear §21.3's
 * verification, because that clear is unconditional on every body save. A
 * verified page whose icon changed is still a page somebody read and vouched
 * for.
 *
 * **A text input rather than an emoji picker.** A picker is a grid of two
 * thousand images, a search box that needs a name per emoji per language, and a
 * dependency — for a field whose value every keyboard on earth can already
 * produce (`⌘⌃Space`, `Win+.`, and a long-press on a phone). §12's inventory has
 * no picker, and inventing one here is how a design system ends up with a
 * component nobody else can use.
 *
 * **Normalised as you type, with the same function the server runs.** It is in
 * `src/lib` because both sides run it — the rule `slug.ts`, `mentions.ts` and
 * `editor-commands.ts` already follow — so the preview cannot promise an icon
 * the save will crop. Two graphemes pasted becomes one, in the box, before
 * anybody presses anything.
 */
export function PageIconForm({
  workspaceSlug,
  locale,
  pageId,
  icon,
  save,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  icon: string | null;
  save: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(save, ROW_IDLE);

  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={pageId} />

      <InputField
        label={t('icon.label')}
        name="icon"
        defaultValue={icon ?? ''}
        /*
          Uncontrolled, and the normalisation runs on the input event rather than
          through state: the field holds at most one grapheme, so there is no
          draft here worth protecting the way §7.7 protects a comment — and a
          controlled field would make every keystroke a render of the panel this
          sits in.
        */
        onInput={(event) => {
          const element = event.currentTarget;
          const normalized = normalizePageIcon(element.value) ?? '';
          if (normalized !== element.value) element.value = normalized;
        }}
        // An emoji is not text a spellchecker or an autocapitaliser should touch.
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-16 text-center"
        help={t('icon.help')}
      />

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t('icon.saving') : t('icon.save')}
      </Button>

      {/*
        The refusal, in the row that caused it — §11's rule, and the same one the
        list follows. There is no success message: the icon appears beside the
        title, which is the result being visible on screen.
      */}
      {state.error && (
        <p role="alert" className="text-2xs text-danger">
          {t(state.error.replace(/^wiki\./, ''))}
        </p>
      )}
    </form>
  );
}
