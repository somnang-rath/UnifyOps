import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EMAIL_LOG_FILE } from './constants';

/** One message as the development transport recorded it. */
export type SentMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  at: string;
};

/** Everything sent so far, oldest first. */
export async function readMailbox(): Promise<SentMail[]> {
  let contents: string;
  try {
    contents = await readFile(resolve(EMAIL_LOG_FILE), 'utf8');
  } catch {
    // Nothing has been sent yet. An empty mailbox, not an error — the callers
    // below poll, and a missing file is simply the first state.
    return [];
  }

  return contents
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SentMail);
}

/**
 * Waits for a message to an address, then returns it.
 *
 * Polls rather than watches: the send happens in the server process after the
 * response has already been streamed to the browser, so the message can arrive
 * a moment after the page says it did. Failing here without waiting would make
 * the suite flaky in exactly the way that teaches people to retry it.
 */
export async function waitForMail(
  to: string,
  options: { subjectContains?: string; timeoutMs?: number } = {},
): Promise<SentMail> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);

  for (;;) {
    const mail = (await readMailbox())
      .filter((m) => m.to.toLowerCase() === to.toLowerCase())
      .filter((m) => !options.subjectContains || m.subject.includes(options.subjectContains))
      .at(-1);

    if (mail) return mail;

    if (Date.now() > deadline) {
      const seen = (await readMailbox()).map((m) => `${m.to} — ${m.subject}`);
      throw new Error(
        `No mail to ${to} within the timeout. Mailbox held:\n${seen.join('\n') || '(nothing)'}`,
      );
    }

    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * The invitation token out of a message.
 *
 * The token, not the whole URL: the absolute link is built from
 * NEXT_PUBLIC_APP_URL, which is inlined at build time and points wherever the
 * build was configured — while the test server is on its own port. Taking the
 * token and rebuilding the path against Playwright's baseURL keeps the spec
 * independent of that.
 */
export function inviteTokenFrom(mail: SentMail): string {
  const match = mail.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No invitation link in:\n${mail.text}`);
  return match[1];
}

/** Same, for the email-verification link. */
export function verifyTokenFrom(mail: SentMail): string {
  const match = mail.text.match(/\/verify\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No verification link in:\n${mail.text}`);
  return match[1];
}
