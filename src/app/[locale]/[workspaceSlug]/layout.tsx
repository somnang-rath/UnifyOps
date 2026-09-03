import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { VerifyEmailBanner } from '@/components/auth/verify-email-banner';
import { ToastProvider } from '@/components/ui/toast';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { Link } from '@/i18n/navigation';

/**
 * The shell every workspace screen sits inside.
 *
 * The membership check is here rather than on each page, so a route added in a
 * later slice is inside the boundary by default rather than by remembering.
 *
 * `notFound()` covers both "no such workspace" and "you are not a member" —
 * §15 asks a pasted URL from another workspace to 404 rather than show an empty
 * page, and distinguishing the two would tell an outsider which company slugs
 * exist. RLS makes the same query return zero rows anyway; this is the second
 * layer, not the first.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const t = await getTranslations();
  const canManage = can(resolved.actor, 'workspace.manage_members');

  return (
    // The toast region belongs to the shell rather than to any one screen: it is
    // one live region for the whole workspace, mounted before anything can need
    // it (§12), and a per-view provider would announce nothing on the first
    // toast of each navigation.
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5 sm:px-6">
          <Link
            href={`/${resolved.workspace.slug}`}
            className="font-[family-name:var(--font-display)] text-base font-semibold tracking-tight"
          >
            {resolved.workspace.name}
          </Link>

          <nav aria-label={t('nav.settings')} className="flex items-center gap-3 text-sm">
            <Link
              href={`/${resolved.workspace.slug}/projects`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('nav.projects')}
            </Link>

            {canManage && (
              <Link
                href={`/${resolved.workspace.slug}/settings/members`}
                className="text-text-muted transition-colors duration-120 hover:text-text"
              >
                {t('members.title')}
              </Link>
            )}
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <span className="hidden text-xs text-text-subtle sm:inline">{resolved.user.name}</span>
            <ThemeToggle />
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </header>

        {!resolved.user.emailVerifiedAt && <VerifyEmailBanner email={resolved.user.email} />}

        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
