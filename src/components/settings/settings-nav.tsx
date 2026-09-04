'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * The settings sub-navigation.
 *
 * A client component for one reason only — `usePathname`, to mark the current
 * section. Everything else about it is static, which is why it takes its
 * sections as a prop rather than deciding them: the permission decisions belong
 * on the server, in the layout, where they are made from a resolved actor
 * rather than from anything a browser could influence.
 *
 * `aria-current="page"` rather than colour alone. The active row is also bolder
 * and carries a rule down its inline-start edge, because §11's baseline is that
 * nothing is signalled by hue on its own.
 */

export type SettingsSection = {
  /** A message key under `settings.sections`, never a sentence (§13). */
  key: string;
  /** Workspace-relative, so the locale prefix is added by `@/i18n/navigation`. */
  href: string;
  visible: boolean;
};

export function SettingsNav({
  workspaceSlug,
  sections,
}: {
  workspaceSlug: string;
  sections: SettingsSection[];
}) {
  const t = useTranslations('settings.sections');
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('label')}
      /*
       * Horizontally scrollable on a phone, a column from `md` up. The row must
       * scroll rather than wrap: nine wrapped chips push the page content
       * below the fold on the one screen §15-6 measures at 390px.
       */
      className={cn(
        '-mx-4 overflow-x-auto px-4 md:mx-0 md:w-52 md:shrink-0 md:overflow-visible md:px-0',
      )}
    >
      <ul className="flex gap-1 md:flex-col">
        {sections.map((section) => {
          const href = `/${workspaceSlug}/${section.href}`;
          const current = pathname === href;

          return (
            <li key={section.key} className="shrink-0">
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'block rounded-sm px-3 py-1.5 text-sm transition-colors duration-120 ease-[var(--ease-out-soft)]',
                  'border-s-2 border-transparent',
                  current
                    ? 'border-s-accent bg-accent-subtle font-medium text-text'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text',
                )}
              >
                {t(section.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
