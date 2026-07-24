/**
 * "On this page" table of contents, built server-side from the h2/h3 anchors
 * that markdownToHtml() stamps onto headings. Rendered only when the page has
 * at least two headings — a TOC with one entry is noise.
 */
type Heading = { id: string; text: string; level: 2 | 3 };

function extractHeadings(html: string): Heading[] {
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  const out: Heading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]) as 2 | 3;
    const text = m[3].replace(/<[^>]*>/g, '').trim();
    if (text) out.push({ id: m[2], text, level });
  }
  return out;
}

export function WikiToc({ html }: { html: string }) {
  const headings = extractHeadings(html);
  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="wiki-toc">
      <p className="wiki-toc-title">On this page</p>
      <ul>
        {headings.map((h, i) => (
          <li key={`${h.id}-${i}`} className={h.level === 3 ? 'pl-3' : ''}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
