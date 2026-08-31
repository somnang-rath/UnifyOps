'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * §12: "Dark mode is a second token set, not a rewrite." The provider's only
 * job is to put `.dark` on <html>; every colour decision is already made by the
 * semantic aliases in globals.css.
 *
 * `attribute="class"` matches the `.dark` selector the token layer uses, and
 * the inline script next-themes injects is why <html> carries
 * suppressHydrationWarning in the layout — the class is set before paint, so
 * there is no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
