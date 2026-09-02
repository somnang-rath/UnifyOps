'use server';

import { z } from 'zod';
import { appUrl } from '@/env';
import {
  consumeVerificationToken,
  createAccount,
  EmailTakenError,
  findAccountByEmail,
  issueVerificationToken,
  markEmailVerified,
  normalizeEmail,
  setPassword,
} from '@/server/auth/accounts';
import { DUMMY_HASH_PROMISE, needsRehash, verifyPassword } from '@/server/auth/password';
import { endSession, readCurrentUser, startSession } from '@/server/auth/session';
import { listMyWorkspaces } from '@/server/auth/context';
import { sendMail } from '@/server/email/mailer';
import { verificationEmail } from '@/server/email/templates';
import { acceptInvitation } from '@/server/services/invitations';
import type { FormState } from '@/lib/form-state';
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
