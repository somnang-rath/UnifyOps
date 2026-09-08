'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import {
  SPACE_EXPORT_IDLE,
  SPACE_IMPORT_IDLE,
  type SpaceExportState,
  type SpaceImportState,
} from '@/lib/form-state';
import { MAX_IMPORT_BYTES } from '@/lib/wiki';

/**
 * §21.8, at the foot of the space it acts on.
 *
 * **The argument for the feature is a sales argument and the screen should read
 * like one.** §18-7's pilot customer will ask what happens to their handbook if
 * they leave, and the answer is on this panel in one sentence: a folder of
 * Markdown files you can open in any editor. "A product that is easy to leave is
 * easier to adopt."
 *
 * Both halves live in one component because they are one idea and because the
 * import half must not be findable *only* by somebody who already knows it
 * exists — an import control on a settings screen three clicks away is an import
 * nobody uses, and the whole point of it is the first hour of a new workspace.
 *
 * Below `DeletedPages` for the same reason that is below the tree: neither is
 * what anybody came to this screen for, and a destructive-looking pair of
 * controls above the page list would be one mis-click from a surprise.
 */
export function SpaceTransfer({
  workspaceSlug,
  locale,
  spaceSlug,
  canWrite,
  exportSpace,
  importSpace,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  spaceSlug: string;
  canWrite: boolean;
  exportSpace: (previous: SpaceExportState, formData: FormData) => Promise<SpaceExportState>;
  importSpace: (previous: SpaceImportState, formData: FormData) => Promise<SpaceImportState>;
}) {
  const t = useTranslations('wiki');
  const toast = useToast();

  const [exported, exportAction, exporting] = useActionState(exportSpace, SPACE_EXPORT_IDLE);
  const [imported, importAction, importing] = useActionState(importSpace, SPACE_IMPORT_IDLE);

  /**
   * The archive arrives in the action's result and becomes a file here.
   *
   * §21's impact table says "§8's five exceptions stay five", so there is no
   * download route to navigate to — see `SpaceExportState`. What the browser
   * gets is base64 in an RSC payload, and turning that into a saved file is a
   * Blob, an object URL and a click on an anchor nobody sees.
   *
   * **Keyed on `at`, not on the presence of `base64`.** A state object is stable
   * across re-renders, so an effect watching the payload would fire again on
   * every unrelated render of this panel and save the same file twice. `at` is
   * the same device `postedAt` and `savedAt` are, and the ref is what makes it a
   * once-per-export effect rather than a once-per-value one.
   *
   * The ref is written in the effect and never during render, which is what
   * `react-hooks/refs` requires — the rule that shaped `NoteComposer` in slice
   * 17 and `PageEditor` in slice 18.
   */
  const savedAt = useRef<number | null>(null);

  useEffect(() => {
    const { at, base64, filename } = exported;
    if (at === undefined || base64 === undefined || filename === undefined) return;
    if (savedAt.current === at) return;
    savedAt.current = at;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Released on the next turn rather than immediately: revoking before the
    // browser has started reading the URL cancels the save in Safari, and the
    // click above is synchronous only in the sense that it dispatches.
    setTimeout(() => URL.revokeObjectURL(url), 0);

    /*
      `info`, because §12's Toast has three tones and no `success` one — slice 13
      added `warning` and stopped there. A saved file is not a warning and not a
      failure, and inventing a fourth tone so one confirmation can be green is
      how a design system acquires a colour nothing else uses.
    */
    toast({ message: t('transfer.exported', { count: exported.pages ?? 0 }) });
  }, [exported, t, toast]);

  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-text-muted">
        {t('transfer.title')}
      </h2>
      <p className="text-2xs text-text-subtle">{t('transfer.explain')}</p>

      <div className="flex flex-wrap items-start gap-4">
        <form action={exportAction}>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="spaceSlug" value={spaceSlug} />

          <Button type="submit" variant="secondary" size="sm" disabled={exporting}>
            <Download size={14} strokeWidth={1.5} className="me-1.5" aria-hidden />
            {exporting ? t('transfer.exporting') : t('transfer.export')}
          </Button>

          {exported.error && (
            <p role="alert" className="mt-1 text-2xs text-danger">
              {t(exported.error.replace(/^wiki\./, ''), { max: MAX_IMPORT_BYTES / (1024 * 1024) })}
            </p>
          )}
        </form>

        {/*
          The import half is offered only to somebody who can write in the space.
          §7.11's rule about the disabled select, applied to a control rather
          than to a screen: the alternative is a file picker that accepts a
          upload and then refuses it, which is the product wasting somebody's
          time to be tidy about symmetry.
        */}
        {canWrite && (
          <form action={importAction} className="space-y-2">
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="spaceSlug" value={spaceSlug} />

            <div className="flex flex-wrap items-center gap-2">
              {/*
                A real, visible file input rather than slice 15's `sr-only` input
                behind a Button. That pattern exists for the workspace logo
                because the picker sits inside a form of other fields and needed
                to look like one of them; here the file *is* the form, and the
                native control is the one thing on the panel that says, without a
                word, what shape of thing this expects.

                `accept` is a hint the browser uses to filter its own dialog and
                is not a check — `importSpace` decides, on the bytes.
              */}
              <input
                type="file"
                name="file"
                required
                accept=".zip,.md,.markdown,.txt"
                aria-label={t('transfer.fileLabel')}
                className="max-w-full text-xs file:me-2 file:rounded-sm file:border file:border-border file:bg-surface-raised file:px-2 file:py-1 file:text-xs file:text-text"
              />

              <Button type="submit" variant="secondary" size="sm" disabled={importing}>
                <Upload size={14} strokeWidth={1.5} className="me-1.5" aria-hidden />
                {importing ? t('transfer.importing') : t('transfer.import')}
              </Button>
            </div>

            {imported.error && (
              <Alert tone="danger">
                {t(imported.error.replace(/^wiki\./, ''), {
                  max: MAX_IMPORT_BYTES / (1024 * 1024),
                })}
              </Alert>
            )}

            {/*
              §7.10's rule, which §21.8's importer inherits: "part of a batch
              fails → no rollback; the result lists sent and not-sent". A file
              nested five deep must not throw away the ninety-nine that were
              fine, and the person needs to know *which* file so they can fix it
              and run the import again.
            */}
            {imported.created !== undefined && (
              <div className="space-y-1 text-2xs">
                <p className="text-text-muted">
                  {t('transfer.imported', { count: imported.created })}
                </p>

                {imported.skipped && imported.skipped.length > 0 && (
                  <ul className="space-y-0.5 text-text-subtle">
                    {imported.skipped.map((file) => (
                      <li key={file.path}>
                        {/*
                          The path is a filename from somebody's own archive, so
                          it is user text and is rendered as text — never
                          interpolated into a message with markup. The reason is
                          a key (§13).
                        */}
                        <span className="font-mono">{file.path}</span>
                        {' — '}
                        {t(file.reason.replace(/^wiki\./, ''))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
