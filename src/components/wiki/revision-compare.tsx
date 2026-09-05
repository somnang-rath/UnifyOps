import { getTranslations } from 'next-intl/server';
import { hasKhmer } from '@/lib/search';
import { diffLines, diffSummary } from '@/lib/wiki';
import type { RevisionRow } from '@/server/queries/wiki';

/**
 * Two revisions, side by side (§20.2's "side-by-side compare").
 *
 * **A line diff, and no diff library** — the same bargain `sigv4.ts` makes
 * against `@aws-sdk`, the burndown against a charting library and `dialog.tsx`
 * against Radix, with an argument specific to this one: a *word*-level diff of
 * prose in a script with no inter-word spaces is a diff of one enormous word
 * (§13), so the sophisticated version is the one that degrades in Khmer. A line
 * is a unit both scripts have, and `documents.ts` already made a newline
 * meaningful by treating it as a hard break — so a line here is a line the
 * reader saw.
 *
 * **One table, not two columns.** A true side-by-side is two scrollers a person
 * has to keep aligned by hand, and at 390px (§15-6) it is two columns of four
 * words each. A unified diff with both line numbers is the same information in
 * the shape that survives a phone, which is the market §2.5 describes.
 *
 * Colour is never the only signal: every changed row carries an `sr-only` word
 * saying which side it came from, because §11's baseline is the whole screen
 * without a mouse *and* without colour vision.
 */
export async function RevisionCompare({ from, to }: { from: RevisionRow; to: RevisionRow }) {
  const t = await getTranslations('wiki');
  const lines = diffLines(from.body, to.body);
  const summary = diffSummary(lines);

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-text">
          {t('compare.title', { from: from.revisionNo, to: to.revisionNo })}
        </h2>
        <p className="text-2xs text-text-muted">
          {t('compare.summary', {
            added: summary.added,
            removed: summary.removed,
          })}
        </p>

        {from.title !== to.title && (
          <p className="text-2xs text-text-muted">
            {t('compare.renamed')}{' '}
            <span lang={hasKhmer(from.title) ? 'km' : undefined} className="line-through">
              {from.title}
            </span>{' '}
            <span lang={hasKhmer(to.title) ? 'km' : undefined} className="text-text">
              {to.title}
            </span>
          </p>
        )}
      </header>

      {lines.every((line) => line.op === 'same') ? (
        // Two revisions with identical bodies — a rename, or a restore of the
        // body that was already current. Saying so is better than an empty table
        // that reads as a failure to compute anything.
        <p className="text-sm text-text-subtle">{t('compare.identical')}</p>
      ) : (
        /*
          Scrolls inside its own container, never widening the document — the
          rule the board, the Table and the workload already follow, and the one
          `responsive.spec.ts` sweeps every screen for at 390px.
        */
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full border-collapse text-2xs">
            <caption className="sr-only">
              {t('compare.tableCaption', {
                from: from.revisionNo,
                to: to.revisionNo,
              })}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">{t('compare.lineFrom')}</th>
                <th scope="col">{t('compare.lineTo')}</th>
                <th scope="col">{t('compare.content')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  key={`${line.op}-${line.before}-${line.after}-${index}`}
                  className={
                    line.op === 'added'
                      ? 'bg-success-subtle'
                      : line.op === 'removed'
                        ? 'bg-danger-subtle'
                        : undefined
                  }
                >
                  <td className="w-10 select-none px-1 text-right align-top text-text-subtle tabular-nums">
                    {line.before ?? ''}
                  </td>
                  <td className="w-10 select-none px-1 text-right align-top text-text-subtle tabular-nums">
                    {line.after ?? ''}
                  </td>
                  <td
                    lang={hasKhmer(line.text) ? 'km' : undefined}
                    className="whitespace-pre-wrap px-2 align-top font-mono text-text"
                  >
                    {line.op !== 'same' && (
                      <span className="sr-only">{t(`compare.op.${line.op}`)} </span>
                    )}
                    {line.text || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
