import { setRequestLocale } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The shell for the four screens that exist before a workspace does: sign in,
 * sign up, confirm an email, follow a verification link.
 *
 * The locale and theme controls are here rather than only inside the product
 * because §13's promise is that Khmer is never the degraded path — and a person
 * who cannot read the sign-in screen never reaches the part of the product that
 * would have let them switch.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 px-6 py-4">
        <ThemeToggle />
        <LocaleSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
