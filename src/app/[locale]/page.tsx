import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/navigation';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tg = await getTranslations('stateGroup');
  const ta = await getTranslations('auth');

  const groups = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            {t('heading')}
          </h1>
          <p className="text-base text-text-muted">{t('body')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </header>

      {/* Renders the five state groups so a Khmer pass can be eyeballed
          immediately — line breaking, diacritic clipping, and truncation all
          show up here before any real UI exists. */}
      <section className="flex flex-wrap gap-2" aria-label="State groups">
        {groups.map((g) => (
          <span
            key={g}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-muted shadow-sm"
          >
            {tg(g)}
          </span>
        ))}
      </section>

      {/* Deliberately no session read on this page. It stays statically
          rendered and needs no database, which is what lets the locale and
          theme suites run against a build with neither. Signed-in users reach
          their workspace through these links, one redirect later. */}
      <nav aria-label={ta('signIn.title')} className="flex flex-wrap gap-2">
        <Link
          href="/sign-up"
          className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
        >
          {ta('signUp.submit')}
        </Link>
        <Link
          href="/sign-in"
          className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-surface-hover"
        >
          {ta('signIn.submit')}
        </Link>
      </nav>

      <footer className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-xs text-text-subtle">
        {t('status')}
      </footer>
    </main>
  );
}
