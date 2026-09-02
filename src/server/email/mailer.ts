import 'server-only';

import { emailConfig } from '@/env';

/**
 * Outbound email, behind one port.
 *
 * Two transports, chosen by whether Resend is configured (§8). The logging
 * transport is not a stub — it is what makes §7.10's whole invite flow runnable
 * on a laptop with no API key, and it returns the same result shape, so the
 * invitation row records a real delivery status either way and the members list
 * shows the same states it will in production.
 *
 * Never throws. A failed send is a value, because §7.10 requires exactly that:
 * "part of a batch fails → no rollback; the result lists sent and not-sent,
 * with retry on the failures only". A transport that threw would take the other
 * thirty-nine invitations down with it.
 */

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export type Transport = (mail: Mail) => Promise<SendResult>;

/**
 * Development and test. Writes what would have been sent, including the link,
 * because the alternative is a developer who cannot complete their own signup.
 *
 * With `EMAIL_LOG_FILE` set it also appends each message as one JSON line. That
 * is what makes the whole of §7.10 testable end to end: the invitation link
 * exists only in the email — the table holds its hash, and nothing can reverse
 * that — so a browser test has no other way to follow one. A file rather than a
 * mock, because the message read back is the message that was actually rendered
 * and sent, through the same path production uses.
 */
const logTransport: Transport = async (mail) => {
  console.info(
    ['', '─── email (not sent: no RESEND_API_KEY) ───', `to:      ${mail.to}`, `subject: ${mail.subject}`, '', mail.text, '───────────────────────────────────────────', ''].join(
      '\n',
    ),
  );
  const file = process.env.EMAIL_LOG_FILE;
  if (file) {
    const { appendFile } = await import('node:fs/promises');
    const line = JSON.stringify({ ...mail, at: new Date().toISOString() });
    await appendFile(file, line + '\n', 'utf8');
  }

  return { ok: true };
};

/**
 * Resend over its HTTP API rather than the SDK.
 *
 * One `fetch` against a documented endpoint, versus a dependency that wraps it.
 * React Email (§8) earns its place when templates get complex; the client for a
 * single POST does not.
 */
function resendTransport(apiKey: string, from: string): Transport {
  return async (mail) => {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        }),
      });

      if (!response.ok) {
        // The provider's own message, kept verbatim for the delivery_error
        // column. It is English, machine-generated, and never reaches a user
        // (§13) — so this cap is a byte budget for a log column, not the
        // grapheme-aware truncation §13 requires for anything a person reads.
        // Intl.Segmenter here would be the wrong tool on the wrong kind of text.
        const detail = await response.text().catch(() => '');
        return { ok: false, error: `resend ${response.status}: ${detail.substring(0, 500)}` };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

let transport: Transport | undefined;

/** Overridden by tests. The one seam, rather than a mock of `fetch`. */
export function setTransport(next: Transport | undefined): void {
  transport = next;
}

function currentTransport(): Transport {
  if (transport) return transport;
  const config = emailConfig();
  return config ? resendTransport(config.apiKey, config.from) : logTransport;
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  return currentTransport()(mail);
}
