import { PAPER_CSS_NAME, type PrintSetup } from './print-types';

/**
 * Print a pre-rendered set of `.sh-print-page` elements by writing them into a
 * hidden iframe with an exact `@page` size, then invoking the browser print
 * dialog. Using an iframe isolates the output from the app's global CSS and
 * gives precise page geometry — the key to Excel-like fidelity.
 *
 * @param pagesHtml  outerHTML of the rendered pages (from the preview DOM).
 * @param setup      resolved print setup (paper + orientation).
 */
export function printPagesHtml(pagesHtml: string, setup: PrintSetup): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  } as CSSStyleDeclaration);
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  const paperName = PAPER_CSS_NAME[setup.paper] ?? 'A4';
  const css = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; color: #000; }
    @page { size: ${paperName} ${setup.orientation}; margin: 0; }
    .sh-print-page {
      break-after: page;
      page-break-after: always;
      overflow: hidden;
    }
    .sh-print-page:last-child { break-after: auto; page-break-after: auto; }
    table { border-collapse: collapse; }
    img { max-width: 100%; }
  `;

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Print</title>` +
      `<style>${css}</style></head><body>${pagesHtml}</body></html>`,
  );
  doc.close();

  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }

  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } finally {
      // Give the print dialog time to read the document before teardown.
      window.setTimeout(() => iframe.remove(), 1000);
    }
  };

  // Wait for images (data URLs are sync, external ones aren't) before printing.
  if (doc.readyState === 'complete') {
    window.setTimeout(doPrint, 50);
  } else {
    win.addEventListener('load', () => window.setTimeout(doPrint, 50));
  }
}
