import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { EmptyState } from '@/components/ui/feedback';
import { listMyWorkspaces } from '@/server/auth/context';
import { readCurrentUser } from '@/server/auth/session';
import { Link, redirect } from '@/i18n/navigation';

/**
 * The workspace switcher, for someone who belongs to more than one company
 * (§7.10: "invited while already in other workspaces → switcher highlights the
 * new one").
 *
 * Only reachable when there is a choice to make: signing in with exactly one
 * workspace goes straight there, and with none goes to onboarding. A picker
 * containing one item is a step that exists to be clicked past.
 */
export default async function WorkspacesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await readCurrentUser();
  if (!user) redirect({ href: '/sign-in', locale });

  const workspaces = await listMyWorkspaces(user.id);
  const t = await getTranslations();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 px-6 py-4">
        <ThemeToggle />
        <LocaleSwitcher />
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-6 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm space-y-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {t('workspace.switcher')}
          </h1>

          {workspaces.length === 0 ? (
            <EmptyState
              title={t('workspace.none')}
              action={
                <Link
                  href="/new-workspace"
                  className="inline-flex h-8 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
                >
                  {t('workspace.create')}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <Link
                    href={`/${workspace.slug}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-120 hover:bg-surface-hover"
                  >
                    <span className="font-medium">{workspace.name}</span>
                    <span className="ms-auto text-xs text-text-subtle">
                      {t(`role.${workspace.role}`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
