import 'server-only';

// From `use-intl/core`, not from `next-intl`. An email template has no React
// in it, and next-intl's entry pulls the React bindings along with the
// formatter — which is fatal in the job worker (slice 9): it runs under the
// `react-server` condition so that `import 'server-only'` resolves to nothing,
// and React's own react-server build does not export `useEffect`, so loading
// those bindings crashes the process at startup. `use-intl` is next-intl's own
// engine and is pinned to the same version, so this is the same translator the
// UI uses, reached without the part of it that only a component needs.
import { createTranslator } from 'use-intl/core';
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

/**
 * §4's "password reset" half of the Identity row.
 *
 * The body deliberately says nothing about whether an account exists. This
 * message is only ever sent to an address that has one, but the *screen* that
 * triggers it reports the same thing either way, and a mail that opened with
 * "you do not have an account" would undo that the moment somebody forwarded a
 * screenshot of it.
 */
export function passwordResetEmail(input: {
  locale: string;
  name: string;
  url: string;
}): Mail {
  const t = translatorFor(input.locale);
  const { html, text } = layout({
    locale: input.locale,
    heading: t('passwordReset.heading'),
    paragraphs: [t('passwordReset.body', { name: input.name }), t('passwordReset.expiry')],
    linkLabel: t('passwordReset.cta'),
    url: input.url,
    footer: t('passwordReset.ignore'),
  });

  return { to: '', subject: t('passwordReset.subject'), html, text };
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

/**
 * One item, as a line in a digest.
 *
 * `key` is the human identifier (`ENG-142`), which is the only part of a work
 * item anybody quotes out loud. Latin digits by construction — the identifier
 * is generated, never localised (§13 pins `numberingSystem: 'latn'` for what a
 * user reads, and this is not even that).
 */
export type DigestLine = {
  key: string;
  title: string;
  url: string;
  /** `YYYY-MM-DD` in the workspace timezone, already resolved by the caller. */
  dueDate: string;
};

/**
 * A list of links, for the one email that is a list rather than a call to
 * action.
 *
 * Kept beside `layout` rather than folded into it: every other email in the
 * product asks for exactly one click, and giving that shape an optional list
 * parameter would invite a second kind of email to grow inside the first.
 */
function listLayout(input: {
  locale: string;
  heading: string;
  intro: string;
  sections: { title: string; lines: DigestLine[] }[];
  footer: string;
}): { html: string; text: string } {
  const lineHeight = input.locale === 'km' ? '1.75' : '1.5';
  const shown = input.sections.filter((section) => section.lines.length > 0);

  const html = [
    `<div lang="${escapeHtml(input.locale)}" style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: ${lineHeight}; max-width: 34em; margin: 0 auto; padding: 24px;">`,
    `<h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(input.heading)}</h1>`,
    `<p style="margin: 0 0 16px;">${escapeHtml(input.intro)}</p>`,
    ...shown.flatMap((section) => [
      `<h2 style="font-size: 15px; font-weight: 600; margin: 20px 0 8px;">${escapeHtml(section.title)}</h2>`,
      '<ul style="margin: 0; padding-left: 20px;">',
      ...section.lines.map(
        (line) =>
          `<li style="margin: 0 0 6px;"><a href="${escapeHtml(line.url)}">${escapeHtml(line.key)}</a> ${escapeHtml(line.title)}</li>`,
      ),
      '</ul>',
    ]),
    `<p style="margin: 24px 0 0; font-size: 13px;">${escapeHtml(input.footer)}</p>`,
    '</div>',
  ].join('\n');

  const text = [
    input.heading,
    '',
    input.intro,
    ...shown.flatMap((section) => [
      '',
      section.title,
      ...section.lines.map((line) => `- ${line.key} ${line.title} — ${line.url}`),
    ]),
    '',
    input.footer,
  ].join('\n');

  return { html, text };
}

/**
 * §7.8 — somebody was named, assigned, or something moved on their item.
 *
 * One template for all four kinds rather than four templates, because the
 * difference between them is one sentence and the subject line. Four would be
 * four places to forget a Khmer string.
 *
 * The URL is built by the caller and already carries the comment anchor where
 * there is one: "click navigates to the item **and the specific comment**".
 */
export function notificationEmail(input: {
  locale: string;
  kind: 'mention' | 'assignment' | 'item_activity' | 'comment';
  actorName: string;
  itemKey: string;
  itemTitle: string;
  workspaceName: string;
  url: string;
}): Mail {
  const t = translatorFor(input.locale);
  const { html, text } = layout({
    locale: input.locale,
    heading: t(`notification.${input.kind}.heading`, {
      actor: input.actorName,
      key: input.itemKey,
    }),
    paragraphs: [input.itemTitle],
    linkLabel: t('notification.cta'),
    url: input.url,
    footer: t('notification.preferences', { workspace: input.workspaceName }),
  });

  return {
    to: '',
    subject: t(`notification.${input.kind}.subject`, {
      actor: input.actorName,
      key: input.itemKey,
    }),
    html,
    text,
  };
}

/**
 * §7.8's evening digest — "one digest per person per evening, in the workspace
 * timezone: what is due tomorrow, and what is already overdue".
 *
 * One message listing that person's own work, never one per item: "that is the
 * fastest way to teach a team to filter the product's mail". The caller has
 * already refused to build one for an empty list, so this template never has to
 * render "you have nothing" — an email saying nothing happened is the other way
 * to teach the same lesson.
 */
export function digestEmail(input: {
  locale: string;
  workspaceName: string;
  /** Due on or before the horizon — the next working day, not necessarily tomorrow. */
  dueSoon: DigestLine[];
  overdue: DigestLine[];
  /**
   * Pages this person owns whose verification lapses soon (§21.3 — slice 19).
   *
   * **The one place anybody is told about an expiry**, and the section exists
   * here rather than as an inbox row because §21.3 refuses the alternative in
   * as many words: "an inbox row per expiring page is a stream that teaches
   * people to ignore the bell" — §7.8's own warning, applied to documentation.
   *
   * It rides the existing `digest` kind, so it inherits the preference row, the
   * working-evening rule and the read-as-that-member scope, and **no sixth
   * notification kind** was added: §6-6's five stay five.
   */
  pagesToReview: DigestLine[];
  url: string;
}): Mail {
  const t = translatorFor(input.locale);
  const count = input.dueSoon.length + input.overdue.length + input.pagesToReview.length;

  const { html, text } = listLayout({
    locale: input.locale,
    heading: t('digest.heading'),
    intro: t('digest.intro', { workspace: input.workspaceName, count }),
    sections: [
      { title: t('digest.overdue'), lines: input.overdue },
      { title: t('digest.dueSoon'), lines: input.dueSoon },
      // Last, deliberately. Work with a date on it is what somebody opens this
      // email for; a page needing review is a fortnight's notice, and putting it
      // above the overdue list would be the product telling somebody about
      // documentation while their own work is late.
      { title: t('digest.pagesToReview'), lines: input.pagesToReview },
    ],
    footer: t('digest.preferences'),
  });

  return { to: '', subject: t('digest.subject', { count }), html, text };
}
