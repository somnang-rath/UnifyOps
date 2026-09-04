'use server';

import { z } from 'zod';
import { appUrl } from '@/env';
import {
  consumeVerificationToken,
  createAccount,
  EmailTakenError,
  findAccountByEmail,
  findAccountById,
  inspectVerificationToken,
  issueVerificationToken,
  markEmailVerified,
  normalizeEmail,
  setPassword,
} from '@/server/auth/accounts';
import { DUMMY_HASH_PROMISE, needsRehash, verifyPassword } from '@/server/auth/password';
import {
  endAllSessions,
  endSession,
  readCurrentUser,
  startSession,
} from '@/server/auth/session';
import { listMyWorkspaces } from '@/server/auth/context';
import { sendMail } from '@/server/email/mailer';
import { passwordResetEmail, verificationEmail } from '@/server/email/templates';
import { acceptInvitation } from '@/server/services/invitations';
import type { FormState, PasswordResetRequestState } from '@/lib/form-state';
import { redirect } from '@/i18n/navigation';

/**
 * The authentication server actions (§8: "Server Actions for everything").
 *
 * Every failure comes back as a **message key**, never a sentence. An English
 * string returned from the server is the one place Khmer quietly degrades
 * (§13), so the client looks the key up in its own catalogue and the two
 * languages fail identically.
 */

const PASSWORD_MIN = 12;

const signUpSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  password: z.string().min(PASSWORD_MIN),
});

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

function localeOf(formData: FormData): string {
  const value = formData.get('locale');
  return value === 'km' ? 'km' : 'en';
}

/**
 * Where a signed-in person belongs.
 *
 * An invitation token wins over everything: §7.10 promises that following a
 * link and signing in lands you "directly in the workspace, in the right
 * teams", and sending someone to their old workspace instead — or worse, to
 * onboarding to create a second company — is the failure that makes an invite
 * feel broken.
 *
 * Otherwise: their only workspace if they have exactly one, the picker if
 * several, onboarding if none. The common case never shows a list of one.
 */
async function destinationFor(userId: string, inviteToken?: string): Promise<string> {
  if (inviteToken) {
    const accepted = await acceptInvitation(inviteToken, userId);
    // A dead token is not a reason to strand someone who has just proved who
    // they are. Fall through to their normal destination; the invite screen is
    // where an expired link explains itself (§7.10).
    if (accepted.ok) return `/${accepted.workspaceSlug}`;
  }

  const workspaces = await listMyWorkspaces(userId);
  const only = workspaces[0];
  if (workspaces.length === 1 && only) return `/${only.slug}`;
  if (workspaces.length > 1) return '/workspaces';
  return '/new-workspace';
}

/** The token carried through a signup or sign-in that began on an invite link. */
function inviteTokenOf(formData: FormData): string | undefined {
  const value = formData.get('inviteToken');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function signUp(_previous: FormState, formData: FormData): Promise<FormState> {
  const locale = localeOf(formData);

  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name') fields.name = 'auth.errors.nameRequired';
      if (field === 'email') fields.email = 'auth.errors.invalidEmail';
      if (field === 'password') fields.password = 'auth.errors.weakPassword';
    }
    return { fields };
  }

  let userId: string;
  let name: string;
  let email: string;

  try {
    const account = await createAccount({ ...parsed.data, locale });
    userId = account.id;
    name = account.name;
    email = account.email;
  } catch (error) {
    if (error instanceof EmailTakenError) {
      // §7.1: "email taken → inline on the field with a sign-in link, form
      // retained." Inline on the field, so it is a field key rather than a
      // form-level one.
      return { fields: { email: 'auth.errors.emailTaken' } };
    }
    throw error;
  }

  // Verification is sent, not waited for. §7.1 targets first task in under
  // three minutes, and a mail round trip in the middle of that path is how a
  // signup becomes a support ticket — so the account is usable immediately and
  // a banner asks for confirmation until it arrives. The link still works
  // whenever they get to it.
  await sendVerification({ userId, name, email, locale });

  await startSession(userId);
  redirect({ href: await destinationFor(userId, inviteTokenOf(formData)), locale });
}

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const locale = localeOf(formData);

  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return { error: 'auth.errors.invalidCredentials' };

  const account = await findAccountByEmail(parsed.data.email);

  // An unknown address must cost the same as a wrong password. Without the
  // dummy verify, "no such account" returns in a millisecond and "wrong
  // password" takes 150ms, and the difference enumerates every address in the
  // product.
  const stored = account?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const ok = await verifyPassword(parsed.data.password, stored);

  if (!ok || !account?.passwordHash) return { error: 'auth.errors.invalidCredentials' };

  // The only moment the plaintext exists to re-hash with, so it is the only
  // moment the cost parameters can be raised for an existing account.
  if (needsRehash(account.passwordHash)) {
    await setPassword(account.id, parsed.data.password);
  }

  await startSession(account.id);
  redirect({ href: await destinationFor(account.id, inviteTokenOf(formData)), locale });
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  await endSession();
  redirect({ href: '/', locale });
}

/** §7.1's "[!] resend" — and the reason the verify screen is not a dead end. */
export async function resendVerification(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = localeOf(formData);
  const user = await readCurrentUser();

  // Silently successful when there is nobody to send to, or the address is
  // already confirmed. Both are states a user can reach by refreshing, and
  // neither is an error worth a red banner.
  if (!user || user.emailVerifiedAt) return {};

  await sendVerification({
    userId: user.id,
    name: user.name,
    email: user.email,
    locale: user.locale || locale,
  });

  return {};
}

export type VerifyOutcome = 'verified' | 'expired' | 'already_used' | 'unknown';

/**
 * Consumes a verification link.
 *
 * Not a form action — it runs from the page the link lands on, so the result is
 * an outcome the page renders rather than a redirect that loses the reason.
 */
export async function verifyEmail(token: string): Promise<VerifyOutcome> {
  const outcome = await consumeVerificationToken(token, 'email_verification');
  if (!outcome.ok) return outcome.reason;

  await markEmailVerified(outcome.userId);
  return 'verified';
}

async function sendVerification(input: {
  userId: string;
  name: string;
  email: string;
  locale: string;
}): Promise<void> {
  const token = await issueVerificationToken(input.userId, 'email_verification');
  const url = `${appUrl().replace(/\/+$/, '')}/${input.locale}/verify/${token}`;

  const mail = verificationEmail({ locale: input.locale, name: input.name, url });

  // The result is deliberately not surfaced. A signup that succeeded and an
  // email that did not go out is still a usable account, and the verify screen
  // already offers a resend — failing the signup here would throw away a
  // working account over a provider outage.
  await sendMail({ ...mail, to: normalizeEmail(input.email) });
}

/* ------------------------------------------------------------------ *
 * Password reset (§4, Identity)
 *
 * The link is the credential, so it has the shortest lifetime in
 * `tokens.ts` — one hour — and everything below is arranged around one
 * rule: the screen must reveal nothing about which addresses have
 * accounts. `signIn` already pays that price with its dummy hash; a
 * "forgot password" form that says "no such account" hands back for free
 * exactly what the dummy hash is there to withhold.
 * ------------------------------------------------------------------ */

const resetRequestSchema = z.object({ email: z.email() });

const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(PASSWORD_MIN),
    confirm: z.string().min(1),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'] });

/**
 * §4's "forgot password", first half: send the link.
 *
 * Always reports the same thing. An address with no account produces the
 * identical screen, which is why the copy says "if an account exists" rather
 * than "sent" — the sentence has to be true in both cases, or the reassuring
 * version becomes the tell.
 *
 * KNOWN AND ACCEPTED: the two paths are not constant *time*. A real address
 * costs a token insert and a provider round trip, an unknown one costs a
 * single indexed SELECT, and a determined attacker can measure the difference.
 * Closing it would mean either sending mail nowhere — a real message to a real
 * provider for an address we know is not ours — or moving the send off the
 * request entirely, which is slice 9's outbox and a queue this flow does not
 * otherwise need. The response is identical, which defeats the casual version
 * of the attack; the timing channel is written down rather than papered over.
 */
export async function requestPasswordReset(
  _previous: PasswordResetRequestState,
  formData: FormData,
): Promise<PasswordResetRequestState> {
  const locale = localeOf(formData);

  const parsed = resetRequestSchema.safeParse({ email: formData.get('email') });

  // A malformed address is a *syntax* error and says nothing about who has an
  // account, so it is reported as one. "Not an email address" and "no account
  // for that email address" are different facts, and only the second leaks.
  if (!parsed.success) return { fields: { email: 'auth.errors.invalidEmail' } };

  const account = await findAccountByEmail(parsed.data.email);

  if (account) {
    const token = await issueVerificationToken(account.id, 'password_reset');
    const url = `${appUrl().replace(/\/+$/, '')}/${account.locale || locale}/reset/${token}`;

    const mail = passwordResetEmail({
      locale: account.locale || locale,
      name: account.name,
      url,
    });

    // Not surfaced, for the reason the verification send is not: the caller
    // cannot be told whether this succeeded without also being told the
    // account exists. A provider outage is a message that does not arrive and
    // a person who asks again, which the form already allows.
    await sendMail({ ...mail, to: normalizeEmail(account.email) });
  }

  return { sent: true };
}

export type ResetOutcome = 'expired' | 'already_used' | 'unknown';

/**
 * Whether a reset link is still worth showing a form for.
 *
 * Read-only — see `inspectVerificationToken`. The page calls this on the GET
 * and the action below consumes on the POST, which is what lets a mail scanner
 * follow the link without spending it.
 */
export async function checkResetToken(token: string): Promise<ResetOutcome | null> {
  const outcome = await inspectVerificationToken(token, 'password_reset');
  return outcome.ok ? null : outcome.reason;
}

/**
 * §4's "forgot password", second half: set the new password.
 *
 * The order of the last four statements is the whole security story:
 *
 * 1. consume the token — conditionally, so two tabs cannot both succeed;
 * 2. set the password;
 * 3. end **every** session, because a reset is the remedy for an account
 *    somebody else is inside, and leaving their cookie working would make the
 *    remedy cosmetic. `endAllSessions` was written in slice 3 with this caller
 *    named in its comment;
 * 4. start a fresh session, after the sweep rather than before it — the other
 *    order signs the person out of the session they just created.
 */
export async function resetPassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = localeOf(formData);

  const parsed = resetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });

  // Validation runs before the token is touched, so a mistyped confirmation
  // costs a retry rather than the link. Consuming first would spend a
  // one-hour credential on a typo and send the person back to their inbox.
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'password') fields.password = 'auth.errors.weakPassword';
      if (field === 'confirm') fields.confirm = 'auth.errors.passwordMismatch';
    }
    // A token that failed its own `min(1)` means the hidden field was lost,
    // which is not a field the person can see or fix.
    return Object.keys(fields).length > 0 ? { fields } : { error: 'auth.resetPassword.unknown' };
  }

  const outcome = await consumeVerificationToken(parsed.data.token, 'password_reset');

  // The page checked this on the way in, so reaching it here means the link
  // died while the form was open — or two tabs raced. Either way it is the
  // form's error rather than the page's, because the typed password is still
  // on screen and a redirect would throw it away.
  if (!outcome.ok) return { error: `auth.resetPassword.${camel(outcome.reason)}` };

  await setPassword(outcome.userId, parsed.data.password);
  await endAllSessions(outcome.userId);

  // Following a link sent to that address is the same proof the verification
  // link asks for, so an unconfirmed account is confirmed here rather than
  // being nagged by the banner immediately after proving the point.
  await markEmailVerified(outcome.userId);

  await startSession(outcome.userId);

  const account = await findAccountById(outcome.userId);
  redirect({
    href: await destinationFor(outcome.userId),
    locale: account?.locale || locale,
  });
}

/** `already_used` → `alreadyUsed`. The catalogue is camelCase; the outcomes are not. */
function camel(reason: ResetOutcome): string {
  return reason.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
