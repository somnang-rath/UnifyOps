import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { LabelsEditor } from '@/components/work-item/labels-editor';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listLabels } from '@/server/services/labels';

/**
 * The workspace's labels (§4, §9).
 *
 * Under workspace settings rather than project settings because a label is
 * workspace vocabulary: a company's "client" means the same thing in every
 * project, and per-project labels would make §7.4's cross-project manager view
 * filter on a set of near-duplicate ids.
 *
 * Read by anyone who can see the workspace, written by Owner and Admin —
 * `workspace.settings`, which is §10's row for exactly this kind of company
 * configuration. A Member landing here sees the list and is told why they
 * cannot change it, rather than seeing a page with the controls quietly
 * missing.
 */
export default async function LabelSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, labels] = await Promise.all([getTranslations(), listLabels(resolved.context)]);

  const canManage = can(resolved.actor, 'workspace.settings');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-semibold tracking-tight">{t('labels.title')}</h1>
        <p className="text-sm text-text-muted">{t('labels.subtitle')}</p>
      </header>

      {canManage ? (
        <LabelsEditor workspaceSlug={workspaceSlug} locale={locale} labels={labels} />
      ) : (
        <>
          <Alert>{t('labels.readOnly')}</Alert>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {labels.map((label) => (
              <li key={label.id} className="px-3 py-2 text-sm">
                {label.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
