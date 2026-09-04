import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsNav, type SettingsSection } from '@/components/settings/settings-nav';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';

/**
 * The settings shell — §6's seven areas, in one place, for the first time.
 *
 * Before slice 15 there were four screens under `settings/` reached from four
 * links in the workspace header, which worked while there were four and stops
 * working at nine. **The header links are gone**; one "Settings" link leads
 * here and this layout is the index of everything under it.
 *
 * §6's governing rule shapes the whole screen: "a company that never opens
 * Settings must be completely fine." So this is a destination, never a step —
 * nothing in onboarding routes through it, no screen sends anybody here to
 * finish a task, and every page under it edits a value that already has a
 * working default.
 *
 * **Two of the nine sections are the member's own rather than the company's**,
 * and they are deliberately not gated: notification preferences and
 * availability. A preference page an Admin has to unlock is a preference page
 * nobody finds. Everything else is `workspace.settings` or
 * `workspace.manage_members`, and a Member who follows a link to one of them
 * gets the read-only version of that page rather than a 404 — the pages decide
 * that individually, because "you may look but not change" is a different
 * answer per screen.
 */
export default async function SettingsLayout({
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

  const t = await getTranslations('settings');

  const canSettings = can(resolved.actor, 'workspace.settings');
  const canMembers = can(resolved.actor, 'workspace.manage_members');

  /*
   * The seven §6 areas plus the two personal ones, in §6's own table order so
   * the screen and the plan can be read side by side. `visible` is a *nav*
   * decision, not the permission itself — every page re-asks §10 for itself,
   * because a hidden link is not an access control.
   */
  const sections: SettingsSection[] = [
    { key: 'general', href: 'settings/general', visible: true },
    { key: 'members', href: 'settings/members', visible: canMembers },
    { key: 'teams', href: 'settings/teams', visible: true },
    { key: 'labels', href: 'settings/labels', visible: true },
    { key: 'holidays', href: 'settings/holidays', visible: true },
    { key: 'branding', href: 'settings/branding', visible: canSettings },
    { key: 'notificationDefaults', href: 'settings/notification-defaults', visible: canSettings },
    { key: 'notifications', href: 'settings/notifications', visible: true },
    { key: 'availability', href: 'settings/availability', visible: true },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {/*
        A sidebar on a wide screen and a scrolling row of tabs on a narrow one.
        §17-3 makes responsive a v1 must-have verified at 390px, and a settings
        sidebar is the classic thing that becomes a 40%-wide column of wrapped
        words on a phone.
      */}
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <SettingsNav
          workspaceSlug={workspaceSlug}
          sections={sections.filter((section) => section.visible)}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
