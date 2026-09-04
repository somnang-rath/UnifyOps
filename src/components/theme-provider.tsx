'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * next-themes' inline script is a **before-paint bootstrap**: its whole job is
 * to put `.dark` on <html> while the server's HTML is still being parsed, so
 * nobody sees a flash of the wrong theme. That is the only moment it does
 * anything, and it is a moment that exists only for a server-rendered document.
 *
 * React refuses to execute a <script> it creates during a client render, and
 * logs an error when it meets one. That fires here because `[locale]` is a
 * route segment: switching language remounts `LocaleLayout`, so next-themes
 * builds its script a second time — on the client, where it can neither run nor
 * be needed. The class is already on <html> by then, and the provider's own
 * effects keep it there.
 *
 * So on the client the script is inert text rather than a program, and saying
 * so with a non-JS media type is the accurate description of it, not a way of
 * hiding the warning — it is the same distinction React itself draws between a
 * data block and an executable script. The server passes no `type` at all, so
 * the initial document still carries a real script that really runs.
 *
 * `undefined` rather than `{}` so nothing is spread onto the server's tag: this
 * has to stay the one prop whose value differs between the two, and next-themes
 * already marks the element `suppressHydrationWarning`.
 */
const INERT_ON_CLIENT = { type: 'text/plain' } as const;

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
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={typeof window === 'undefined' ? undefined : INERT_ON_CLIENT}
    >
      {children}
    </NextThemesProvider>
  );
}
