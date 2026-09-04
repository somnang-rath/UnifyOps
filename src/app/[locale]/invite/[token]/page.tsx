import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { readCurrentUser } from '@/server/auth/session';
import { acceptInvitation, lookupInvitation } from '@/server/services/invitations';
import { Link, redirect } from '@/i18n/navigation';

/**
 * Where an invitation link lands (§7.10).
 *
 * Signed in: accept immediately and go. There is nothing to ask — following the
 * link *is* the acceptance, and an extra confirmation screen between a person
 * and the workspace they were invited to is a step that exists only to be
 * clicked through.
 *
 * Signed out: the invitation is named, and the two ways in are offered with the
 * token carried along, so signing up lands them "directly in the workspace, in
 * the right teams" rather than in onboarding for a company they do not need.
 *
 * The three dead-link cases each say what happened. §7.10 asks for "a clear
 * message + request-new-link button" on expiry, and "expired", "withdrawn" and
 * "not a valid link" are different things to have to explain to a colleague.
 */

const DEAD_MESSAGE = {
  expired: 'invite.accept.expired',
  revoked: 'invite.accept.revoked',
  accepted: 'invite.accept.alreadyMember',
  unknown: 'invite.accept.unknown',
} as const;

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const lookup = await lookupInvitation(token);
  const user = await readCurrentUser();

  if (lookup.ok && user) {
    const accepted = await acceptInvitation(token, user.id);
    // Outside the try/catch-free path on purpose: `redirect` throws to unwind,
    // so it must not sit inside anything that would swallow it.
    if (accepted.ok) redirect({ href: `/${accepted.workspaceSlug}`, locale });
  }

  const t = await getTranslations();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 px-6 py-4">
        <ThemeToggle />
        <LocaleSwitcher />
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-6 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm space-y-6">
          {lookup.ok ? (
            <>
              <header className="space-y-1">
                <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
                  {t('invite.accept.title', { workspace: lookup.invitation.workspaceName })}
                </h1>
                {/* The inviter's name is deliberately absent. Naming them would
                    mean reading their membership row, and the identity role can
                    only read the memberships of the person it has already
                    authenticated — widening that for a nicety is exactly the
                    kind of trade this boundary exists to refuse. The invitation
                    email, which is sent from inside the workspace, does say who
                    sent it. */}
                <p className="text-sm text-text-muted">
                  {t('invite.accept.body', { workspace: lookup.invitation.workspaceName })}
                </p>
              </header>

              <div className="space-y-2">
                <Link
                  href={`/sign-up?invite=${encodeURIComponent(token)}`}
                  className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-accent-hover"
                >
                  {t('invite.accept.signUpFirst')}
                </Link>
                <Link
                  href={`/sign-in?invite=${encodeURIComponent(token)}`}
                  className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text transition-colors duration-120 ease-[var(--ease-out-soft)] hover:bg-surface-hover"
                >
                  {t('invite.accept.signInFirst')}
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
                {t('invite.accept.cta')}
              </h1>
              <Alert tone={lookup.reason === 'accepted' ? 'info' : 'warning'}>
                {t(DEAD_MESSAGE[lookup.reason])}
              </Alert>
              <p className="text-xs text-text-muted">{t('invite.accept.requestNew')}</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
