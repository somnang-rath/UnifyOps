import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArchiveProject } from '@/components/project/archive-project';
import { CustomFieldsEditor } from '@/components/project/custom-fields-editor';
import { ProjectMembers } from '@/components/project/project-members';
import { StatesEditor } from '@/components/project/states-editor';
import { Alert } from '@/components/ui/feedback';
import { resolveActorContext } from '@/server/auth/context';
import { listMembers } from '@/server/services/members';
import { listCustomFieldsWithUsage } from '@/server/services/custom-fields';
import { getProjectBySlug, listProjectMembers } from '@/server/services/projects';
import { Link } from '@/i18n/navigation';

/**
 * §6-3's workflow configuration, §6-4's custom fields, and §4's archive.
 *
 * §10 gives "Project settings, states, custom fields" to Owner, Admin and a
 * project Lead. Anyone else gets a 404 rather than a read-only copy of this
 * screen — there is nothing here for them to do, and a form full of disabled
 * controls reads as a fault rather than as a permission.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; projectSlug: string }>;
}) {
  const { locale, workspaceSlug, projectSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const project = await getProjectBySlug(resolved, projectSlug);
  if (!project) notFound();
  if (!project.canEditSettings) notFound();

  const [projectMembers, workspaceMembers, customFields, t] = await Promise.all([
    listProjectMembers(resolved.context, project.id),
    listMembers(resolved.context),
    // Null only when the actor may not configure this project, which the
    // `canEditSettings` check above has already turned into a 404 — so it is a
    // second opinion from the service rather than a case this screen renders.
    listCustomFieldsWithUsage(resolved, project.id),
    getTranslations(),
  ]);

  const onProject = new Set(projectMembers.map((m) => m.memberId));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('projects.settings')}
        </h1>
        <p className="text-sm text-text-muted">
          <Link
            href={`/${workspaceSlug}/projects/${projectSlug}`}
            className="transition-colors duration-120 hover:text-text"
          >
            {project.name}
          </Link>
        </p>
      </header>

      {project.archivedAt && <Alert tone="warning">{t('projects.archivedNotice')}</Alert>}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            {t('states.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('states.subtitle')}</p>
        </div>

        <StatesEditor
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={project.id}
          states={project.states.map((state) => ({
            id: state.id,
            name: state.name,
            nameKey: state.nameKey,
            group: state.group,
            color: state.color,
          }))}
          // An archived project is read-only, and that is enforced in the
          // service as well — this only stops the screen from offering an action
          // it already knows will be refused.
          canEdit={project.archivedAt === null}
        />
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <div className="space-y-1">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            {t('customFields.title')}
          </h2>
          <p className="text-sm text-text-muted">{t('customFields.subtitle')}</p>
        </div>

        <CustomFieldsEditor
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={project.id}
          fields={(customFields ?? []).map((field) => ({
            id: field.id,
            name: field.name,
            kind: field.kind,
            options: field.options.map((option) => ({ id: option.id, name: option.name })),
            valueCount: field.valueCount,
          }))}
          // §4 again: an archived project is read-only, and the service refuses
          // this too — the screen only stops offering what it knows is refused.
          canEdit={project.archivedAt === null}
        />
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <div className="space-y-1">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            {t('projects.members')}
          </h2>
          <p className="text-sm text-text-muted">
            {project.visibility === 'private'
              ? t('projects.visibilityPrivate')
              : t('projects.visibilityWorkspace')}
          </p>
        </div>

        <ProjectMembers
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={project.id}
          members={projectMembers.map((m) => ({
            memberId: m.memberId,
            name: m.name,
            role: m.role,
          }))}
          // Everyone in the workspace who is not already on it. §10's implicit
          // roles are not memberships, so an Admin who has never been added
          // still appears here — adding them is a real row, and a private
          // project is exactly where that matters.
          candidates={workspaceMembers
            .filter((m) => !onProject.has(m.memberId))
            .map((m) => ({ memberId: m.memberId, name: m.name, email: m.email }))}
          disabled={project.archivedAt !== null}
        />
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          {t('action.archive')}
        </h2>
        <ArchiveProject
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={project.id}
          archived={project.archivedAt !== null}
        />
      </section>
    </div>
  );
}
