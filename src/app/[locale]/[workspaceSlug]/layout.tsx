import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { CommandBar } from '@/components/search/command-bar';
import { InboxBell } from '@/components/notifications/inbox-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { VerifyEmailBanner } from '@/components/auth/verify-email-banner';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { ToastProvider } from '@/components/ui/toast';
import { ViewAsBar } from '@/components/settings/view-as-bar';
import { WorkspaceLogo } from '@/components/settings/workspace-logo';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { logoUrl } from '@/server/services/workspace-logo';
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

  // Signed and short-lived like every download in the product, so it is re-signed
  // on each render — a hash, not a round trip.
  const logoSrc = resolved.workspace.logoKey ? logoUrl(resolved.workspace.logoKey) : null;

  return (
    // The toast region belongs to the shell rather than to any one screen: it is
    // one live region for the whole workspace, mounted before anything can need
    // it (§12), and a per-view provider would announce nothing on the first
    // toast of each navigation.
    <ToastProvider>
      {/*
        §6-7's accent, as a token name on a wrapper (see `[data-accent]` in
        globals.css). Not on `<html>`, because the root layout does not know
        which workspace is being rendered — and it does not need to be: the five
        `--accent-*` aliases are custom properties, so everything inside this
        element inherits them, including the portalled Toast region and the
        native `<dialog>` in the top layer, which are both rendered from within
        this tree.
      */}
      <div
        data-accent={resolved.workspace.accent ?? undefined}
        className="app-ambient flex min-h-dvh flex-col"
      >
        {/*
          §7.13's persistent bar, above everything including the header. It
          renders on *every* workspace screen rather than on the one that
          started the session, because the failure it prevents is an owner
          forgetting where they are three navigations later.
        */}
        {(resolved.viewAs || resolved.viewAsEnded) && (
          <ViewAsBar
            workspaceSlug={resolved.workspace.slug}
            name={resolved.viewAs?.name ?? null}
            ended={resolved.viewAsEnded}
          />
        )}

        {/*
          The header is the one chrome that sits *on* the ambient field rather
          than beside it, so it is translucent and blurred rather than the flat
          `bg-surface` it was: an opaque bar across the top of a washed page
          reads as a bar bolted onto a screenshot. `supports-` guards it —
          where `backdrop-filter` is unavailable the surface goes fully opaque
          instead of leaving text over an unblurred background, which is the one
          way this fails as a contrast problem rather than as a visual one.
        */}
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5 supports-[backdrop-filter]:bg-surface/80 supports-[backdrop-filter]:backdrop-blur-xl sm:px-6">
          <Link
            href={`/${resolved.workspace.slug}`}
            className="flex items-center gap-2 font-[family-name:var(--font-display)] text-base font-semibold tracking-tight"
          >
            {/* §6-7. The company's own mark, never ours — CLAUDE.md records
                that the parent Unify logo is not in the repo and that nothing
                may be substituted for it. This is a different asset: a logo the
                company uploaded, and its absence is simply no image. */}
            {logoSrc && <WorkspaceLogo src={logoSrc} name={resolved.workspace.name} />}
            {resolved.workspace.name}
          </Link>

          <nav aria-label={t('nav.settings')} className="flex items-center gap-3 text-sm">
            {/* §7.3: the app opens on My Work, never a project list. The link is
                the workspace root, which is that screen. */}
            <Link
              href={`/${resolved.workspace.slug}`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('myWork.title')}
            </Link>

            {/* §7.4's manager loop. Not behind `canManage`: a workload view is a
                read of work everybody can already see, and §10 has no row that
                would gate it — the sixth time this decision has gone this way. */}
            <Link
              href={`/${resolved.workspace.slug}/team`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('dashboards.teamTitle')}
            </Link>

            <Link
              href={`/${resolved.workspace.slug}/projects`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('nav.projects')}
            </Link>

            {/* §20.3.1's notes. In the header for the same reason Search is:
                `⌘K` reaches it faster, and a surface people can only reach with
                a keystroke is a surface half of them never find. No permission
                behind it — a notes screen shows one person their own rows, and
                §10 has no row that could gate that (§20.5). */}
            <Link
              href={`/${resolved.workspace.slug}/notes`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('nav.notes')}
            </Link>

            {/* §20's other noun. Beside Notes rather than under a project,
                because the company space is not one project's — §20.1: "a page
                is the company's record, a note is one person's thinking", and
                the header is where the two nouns sit side by side. No permission
                behind the link: `listSpaces` returns what this actor may read,
                and a hidden link is not a permission (§6's rule for the settings
                nav, and the reason every page re-asks §10 for itself). */}
            <Link
              href={`/${resolved.workspace.slug}/wiki`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('nav.wiki')}
            </Link>

            {/* §7.9's full results screen. The palette reaches it too, but a
                search people can only start with a keystroke is a search half of
                them never find. */}
            <Link
              href={`/${resolved.workspace.slug}/search`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('nav.search')}
            </Link>

            {/*
              **One Settings link, where slice 14 left four.**

              Notifications, availability and members each had their own link in
              the header, which worked while there were three of them and stops
              working at nine — slice 15 completes §6's seven areas, and a
              header that lists every settings screen is a header nobody reads.
              The settings layout's own sub-navigation is the index now.

              Not behind `canManage`, and that is deliberate: two of the nine
              sections are the member's own rather than the company's (their
              notification preferences and their availability), and a Settings
              link an Admin has to unlock is a preference page nobody finds. The
              sections inside it are individually gated.
            */}
            <Link
              href={`/${resolved.workspace.slug}/settings`}
              className="text-text-muted transition-colors duration-120 hover:text-text"
            >
              {t('settings.title')}
            </Link>
          </nav>

          <div className="ms-auto flex items-center gap-2">
            {/*
              §7.9's palette lives in the shell, which is what makes ⌘K mean the
              same thing on every screen — and is why the one component that
              needs to know which item is on screen reads it from a store
              (`current-item.tsx`) rather than from a prop the layout cannot
              have.
            */}
            <CommandBar
              workspaceSlug={resolved.workspace.slug}
              canCreateProject={can(resolved.actor, 'project.create')}
            />
            <span className="hidden text-xs text-text-subtle sm:inline">{resolved.user.name}</span>
            <InboxBell workspaceSlug={resolved.workspace.slug} unread={resolved.unread} />
            <ThemeToggle />
            <LocaleSwitcher />
            <SignOutButton />
          </div>
        </header>

        {/* §11's edge row. Above the verify banner because a lost connection is
            the more urgent of the two and the shorter-lived — and it renders
            nothing at all until an effect has run, so it costs a signed-in
            person on a working connection no space and no layout shift. */}
        <OfflineBanner />

        {!resolved.user.emailVerifiedAt && <VerifyEmailBanner email={resolved.user.email} />}

        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
