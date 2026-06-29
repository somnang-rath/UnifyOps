import { paperPx, type PrintSetup } from './print-types';

/**
 * Render the already-paginated `.sh-print-page` elements to a downloadable PDF.
 *
 * Each page is captured with html2canvas (rasterized) and placed 1:1 onto a
 * PDF page sized to the chosen paper. The libraries are imported dynamically so
 * they stay out of the initial /tables bundle and only load on first use.
 *
 * @param pagesHtml  outerHTML of the rendered pages (from the preview DOM).
 * @param setup      resolved print setup (paper + orientation).
 * @param fileName   base name for the downloaded file (no extension).
 */
export async function savePagesPdf(
  pagesHtml: string,
  setup: PrintSetup,
  fileName: string,
): Promise<void> {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const html2canvas = html2canvasMod.default;

  const paper = paperPx(setup); // px @96dpi, already oriented
  const orientation: 'portrait' | 'landscape' =
    paper.w > paper.h ? 'landscape' : 'portrait';

  // Off-screen host carrying the pages at their natural (unscaled) size.
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${paper.w}px`,
    background: '#ffffff',
    color: '#000000',
  } as CSSStyleDeclaration);
  host.innerHTML = pagesHtml;
  document.body.appendChild(host);

  try {
    const pages = Array.from(
      host.querySelectorAll<HTMLElement>('.sh-print-page'),
    );
    if (pages.length === 0) return;

    const pdf = new jsPDF({
      orientation,
      unit: 'px',
      format: [paper.w, paper.h],
      compress: true,
    });

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([paper.w, paper.h], orientation);
      pdf.addImage(img, 'JPEG', 0, 0, paper.w, paper.h);
    }

    pdf.save(`${sanitize(fileName)}.pdf`);
  } finally {
    host.remove();
  }
}

function sanitize(name: string): string {
  return (name || 'spreadsheet').replace(/[^\w.-]+/g, '_').slice(0, 100);
}
