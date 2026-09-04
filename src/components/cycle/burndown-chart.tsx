import { getFormatter, getTranslations } from 'next-intl/server';
import type { BurndownPoint } from '@/lib/cycles';

/**
 * The burndown (§4's Cycles row, §7.6, slice 11).
 *
 * **Inline SVG, and no charting library.** The same bargain `sigv4.ts` makes by
 * not adding `@aws-sdk` and `mailer.ts` by calling Resend over `fetch`: this is
 * two polylines, a set of bands and an axis, and a dependency for it would
 * bring its own colour system — which is the one thing §12's three-layer token
 * architecture cannot accommodate. A chart that hard-codes a light-mode palette
 * still *renders* in dark mode; only a comparison catches it, which is why
 * `e2e/theme.spec.ts` exists.
 *
 * **No new token family, deliberately.** Slice 4 added `--state-*`, slice 5
 * added `--priority-*`, `--label-*` and `--avatar-*`, and each time the reason
 * was that a company's own *data* carried a colour. Nothing here does: the
 * actual line is the emphasised series and takes `--accent`, the ideal line is
 * a reference and takes `--text-subtle` dashed, and a closed day takes
 * `--surface-sunken`. Those are emphasis levels, which layer 2 already has.
 *
 * **A server component.** A burndown cannot change while somebody reads it
 * without the page changing too, so there is nothing to hydrate — and the
 * locale and the workspace's dates are both already here.
 *
 * §11's five states: `[L]` server-rendered inside the page · `[E]` a cycle with
 * no work draws the frame and says so, rather than an empty box · `[S]`, `[X]`
 * nothing here is editable · `[!]` the edges that actually happen — a cycle
 * that has not started (every point null), one that ended (no nulls at all),
 * and a range with no working day in it — are all handled by `withIdealLine`
 * and drawn without a special case here.
 */

/** The drawing box. A viewBox, so the chart scales to whatever column it is in. */
const W = 720;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 34 };

export async function BurndownChart({
  points,
  scope,
}: {
  points: readonly BurndownPoint[];
  scope: number;
}) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  if (points.length === 0) {
    return <p className="text-sm text-text-subtle">{t('cycles.burndown.unavailable')}</p>;
  }

  const plot = {
    width: W - PAD.left - PAD.right,
    height: H - PAD.top - PAD.bottom,
  };

  // The y-axis tops out at the scope, or at the highest thing actually drawn —
  // carry-over can leave more open than the cycle started with, and a line that
  // ran off the top of its own chart would be the one day it mattered.
  const ceiling = Math.max(
    1,
    scope,
    ...points.map((point) => point.remaining ?? 0),
    ...points.map((point) => point.ideal),
  );

  // `points.length - 1` so the first point sits on the left edge and the last on
  // the right; a single-day cycle divides by one instead of by zero.
  const step = points.length > 1 ? plot.width / (points.length - 1) : 0;
  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plot.height * (1 - value / ceiling);

  const idealPath = points.map((point, index) => `${x(index)},${y(point.ideal)}`).join(' ');
  // Only the days that have happened. `remaining` is null for the future, and
  // the line has to stop rather than fall to zero.
  const actual = points
    .map((point, index) => ({ point, index }))
    .filter((entry) => entry.point.remaining !== null);
  const actualPath = actual.map((e) => `${x(e.index)},${y(e.point.remaining ?? 0)}`).join(' ');

  const shortDate = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), 'short');

  // First, last, and the midpoint. Every date would collide at 390px (§15-6),
  // and a chart whose axis is unreadable on a phone is a chart nobody checks
  // during a standup.
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        // The accessible name is the summary; the table below is the data. A
        // chart announced only as "chart" is a chart a screen reader user is
        // told exists and nothing more.
        role="img"
        aria-labelledby="burndown-caption"
        preserveAspectRatio="none"
      >
        {/* Closed days, drawn behind everything. The visible half of §17-18: a
            week-long lunar holiday should be legible as a week nobody worked,
            not as a team that stalled. */}
        {points.map((point, index) =>
          point.working ? null : (
            <rect
              key={point.date}
              x={x(index) - step / 2}
              y={PAD.top}
              width={step || plot.width}
              height={plot.height}
              className="fill-surface-sunken"
            />
          ),
        )}

        {/* The baseline and the scope line — two rules, not a grid. A grid of
            eight faint lines is decoration; these two are the numbers somebody
            reads off the chart. */}
        <line
          x1={PAD.left}
          y1={y(0)}
          x2={W - PAD.right}
          y2={y(0)}
          className="stroke-border-strong"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={y(ceiling)}
          x2={W - PAD.right}
          y2={y(ceiling)}
          className="stroke-border"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        <polyline
          points={idealPath}
          fill="none"
          className="stroke-text-subtle"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          strokeLinejoin="round"
        />

        {actual.length > 1 && (
          <polyline
            points={actualPath}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* A single day of data is a dot rather than a line nobody can see. */}
        {actual.length === 1 && actual[0] && (
          <circle
            cx={x(actual[0].index)}
            cy={y(actual[0].point.remaining ?? 0)}
            r={3}
            className="fill-accent"
          />
        )}

        {/* Today's marker: the last day with real data. It is the one point on
            the chart anybody is looking for. */}
        {actual.length > 0 && actual.at(-1) && (
          <circle
            cx={x(actual.at(-1)!.index)}
            cy={y(actual.at(-1)!.point.remaining ?? 0)}
            r={3.5}
            className="fill-accent"
          />
        )}

        <text
          x={PAD.left - 6}
          y={y(ceiling) + 4}
          textAnchor="end"
          className="fill-text-subtle text-[10px] tabular-nums"
        >
          {format.number(ceiling)}
        </text>
        <text
          x={PAD.left - 6}
          y={y(0) + 4}
          textAnchor="end"
          className="fill-text-subtle text-[10px] tabular-nums"
        >
          0
        </text>

        {ticks.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={H - 8}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            className="fill-text-subtle text-[10px]"
          >
            {shortDate(points[index]!.date)}
          </text>
        ))}
      </svg>

      <figcaption
        id="burndown-caption"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted"
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
          {t('cycles.burndown.actual')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0 w-4 border-t-2 border-dashed border-text-subtle"
          />
          {t('cycles.burndown.ideal')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-4 rounded-xs bg-surface-sunken" />
          {t('cycles.burndown.closed')}
        </span>
      </figcaption>

      {/*
        The same data as a table, for a screen reader and for anybody who wants
        the numbers rather than the shape. §11's accessibility baseline asks for
        correct roles and labels; for a chart that means the values have to be
        reachable, and an `aria-label` summarising a fortnight is not reachable.
      */}
      <table className="sr-only">
        <caption>{t('cycles.burndown.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('cycles.burndown.day')}</th>
            <th scope="col">{t('cycles.burndown.actual')}</th>
            <th scope="col">{t('cycles.burndown.ideal')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{shortDate(point.date)}</th>
              <td>
                {point.remaining === null
                  ? t('cycles.burndown.notYet')
                  : format.number(point.remaining)}
              </td>
              <td>{format.number(point.ideal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
