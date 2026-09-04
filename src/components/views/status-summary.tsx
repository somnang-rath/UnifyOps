'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ClipboardCopy, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/**
 * §7.4's two ways of getting this screen out of the browser.
 *
 * "→ 'Copy status summary' → markdown to clipboard, ready to paste in chat
 *  → 'Export' → print layout → Save as PDF, the version you send a client"
 *
 * **Export is a print stylesheet, not a PDF service** (§17-26). "A print-specific
 * layout plus `⌘/Ctrl+P → Save as PDF` costs a stylesheet; a server-side
 * renderer costs Chromium in the container and a job queue, for a document one
 * person produces once a week." So the Export button calls `window.print()` and
 * the layout lives in `globals.css` under `@media print`.
 *
 * **The markdown is composed on the server and passed in.** It has to be — every
 * name, count and heading in it is translated, and a client that rebuilt the
 * text would be a second renderer of the same numbers, in the same two
 * languages, kept in step by hand. The server already knows all of it.
 */

export function StatusSummary({ markdown }: { markdown: string }) {
  const t = useTranslations();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      // Long enough to read, short enough that the button is a button again
      // before anybody wants to press it twice.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /*
       * The clipboard API needs a secure context and a user gesture, and it is
       * refused outright in some embedded browsers. §11 says an error is
       * explained rather than swallowed — and a copy button that silently does
       * nothing is the most common broken control on the web.
       */
      toast({ tone: 'danger', message: t('dashboards.copyFailed') });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button size="sm" onClick={copy}>
        {copied ? (
          <Check size={14} strokeWidth={1.5} className="me-1.5" aria-hidden />
        ) : (
          <ClipboardCopy size={14} strokeWidth={1.5} className="me-1.5" aria-hidden />
        )}
        {copied ? t('dashboards.copied') : t('dashboards.copySummary')}
      </Button>

      <Button size="sm" onClick={() => window.print()}>
        <Printer size={14} strokeWidth={1.5} className="me-1.5" aria-hidden />
        {t('dashboards.export')}
      </Button>
    </div>
  );
}
