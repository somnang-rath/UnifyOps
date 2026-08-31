import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tg = await getTranslations('stateGroup');

  const groups = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            {t('heading')}
          </h1>
          <p className="text-base text-text-muted">{t('body')}</p>
        </div>
        <LocaleSwitcher />
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

      <footer className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-xs text-text-subtle">
        {t('status')}
      </footer>
    </main>
  );
}
