import 'server-only';

import { createTranslator } from 'next-intl';
import { routing } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import en from '@/i18n/messages/en.json';
import km from '@/i18n/messages/km.json';
import type { Mail } from './mailer';

/**
 * Transactional email, in both languages.
 *
 * The catalogues are the same ones the UI reads, through `createTranslator` —
 * next-intl's non-React entry point. That is the point: an email is UI, so an
 * English subject line arriving for a Khmer user is the same defect as an
 * English button, and putting the strings anywhere else is how that starts.
 *
 * DELIBERATELY UNSTYLED. No colours, no button, no table layout. Email clients
 * cannot resolve CSS custom properties, so any styling here would have to be
 * literal hex — a second, unversioned copy of the palette that drifts from
 * globals.css and cannot follow the reader's dark mode. A plain link renders
 * correctly in every client, in both themes, at any font size, and in a screen
 * reader. §12's design system governs the product; an email is not the product.
 */

const MESSAGES = { en, km } as const;

function translatorFor(locale: string) {
  const resolved: Locale = routing.locales.includes(locale as Locale)
    ? (locale as Locale)
    : routing.defaultLocale;

  return createTranslator({
    locale: resolved,
    messages: MESSAGES[resolved],
    namespace: 'email',
  });
}

/**
 * Minimal escaping for the values interpolated into the HTML body.
 *
 * Names and workspace names are user input and go into both an HTML and a text
 * part. The text part needs nothing; the HTML part needs this, and needs it
 * applied at the point of interpolation rather than trusted upstream.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The shared body shape: a greeting, a sentence, the link, and what to do if it
 * was not expected.
 *
 * `lang` on the wrapper is not decoration — it is what tells a client to pick a
 * Khmer face and the line height that keeps stacked diacritics from clipping
 * (§13). The same rule as `:lang(km)` in globals.css, in the one place that
 * cannot share the stylesheet.
 */
function layout(input: {
  locale: string;
  heading: string;
  paragraphs: string[];
  linkLabel: string;
  url: string;
  footer: string;
}): { html: string; text: string } {
  const lineHeight = input.locale === 'km' ? '1.75' : '1.5';

  const html = [
    `<div lang="${escapeHtml(input.locale)}" style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: ${lineHeight}; max-width: 34em; margin: 0 auto; padding: 24px;">`,
    `<h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(input.heading)}</h1>`,
    ...input.paragraphs.map((p) => `<p style="margin: 0 0 12px;">${escapeHtml(p)}</p>`),
    `<p style="margin: 20px 0;"><a href="${escapeHtml(input.url)}">${escapeHtml(input.linkLabel)}</a></p>`,
    `<p style="margin: 24px 0 0; font-size: 13px;">${escapeHtml(input.footer)}</p>`,
    '</div>',
  ].join('\n');

  const text = [
    input.heading,
    '',
    ...input.paragraphs,
    '',
    `${input.linkLabel}: ${input.url}`,
    '',
    input.footer,
  ].join('\n');

  return { html, text };
}

/** §7.1 — "Sign up → Verify email". */
export function verificationEmail(input: {
  locale: string;
  name: string;
  url: string;
}): Mail {
  const t = translatorFor(input.locale);
  const { html, text } = layout({
    locale: input.locale,
    heading: t('verify.heading'),
    paragraphs: [t('verify.body', { name: input.name }), t('verify.expiry')],
    linkLabel: t('verify.cta'),
    url: input.url,
    footer: t('verify.ignore'),
  });

  return { to: '', subject: t('verify.subject'), html, text };
}

/** §7.10 — the invitation itself. */
export function invitationEmail(input: {
  locale: string;
  inviterName: string;
  workspaceName: string;
  url: string;
}): Mail {
  const t = translatorFor(input.locale);
  const { html, text } = layout({
    locale: input.locale,
    heading: t('invitation.heading', { workspace: input.workspaceName }),
    paragraphs: [
      t('invitation.body', { inviter: input.inviterName, workspace: input.workspaceName }),
      t('invitation.expiry'),
    ],
    linkLabel: t('invitation.cta'),
    url: input.url,
    footer: t('invitation.ignore'),
  });

  return {
    to: '',
    subject: t('invitation.subject', { workspace: input.workspaceName }),
    html,
    text,
  };
}
