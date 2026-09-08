'use client';

import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';

/**
 * §21.8's other export: one page, as a PDF.
 *
 * **A print stylesheet, not a PDF service** (§17-26), and §21.8 says so in as
 * many words: "a page exports to PDF through the print stylesheet slice 13
 * already wrote, which is why §17-26's three rules were written the way they
 * were". A server-side renderer costs Chromium in the container and a job
 * queue, for a document one person produces once a month.
 *
 * The three rules are the ones that make it work here rather than merely run:
 * the **Khmer face is re-stated** in `@media print` rather than inherited, so a
 * Khmer page does not print as boxes; the **light palette is forced**, so
 * somebody in dark mode does not print white on white; and **wide content
 * stacks**. A page body is the one place in the product where all three matter
 * at once — it is long-form text, often Khmer, and read by people who print
 * policies.
 *
 * This is a `<button>` and not a link, which is the opposite of what §20.11's
 * other controls are, and correctly: printing is not a destination. It carries
 * `print:hidden` for the reason `StatusSummary`'s pair does — a printed page has
 * nothing to click.
 */
export function PagePrint() {
  const t = useTranslations('wiki');

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xs text-accent hover:underline print:hidden"
    >
      <Printer size={12} strokeWidth={1.5} className="me-1 inline align-[-1px]" aria-hidden />
      {t('reader.print')}
    </button>
  );
}
