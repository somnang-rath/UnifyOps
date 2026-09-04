import { getFormatter, getTranslations } from 'next-intl/server';
import type { CycleProgress as Progress } from '@/lib/cycles';

/**
 * §4's "progress + burndown", the progress half (§7.6).
 *
 * A server component: the numbers are computed inside the same transaction the
 * page's other numbers were, and nothing here changes without the page changing.
 *
 * **Cancelled work is shown and is not in the bar.** `progressFrom` takes it
 * out of the denominator — §4 gives `cancelled` its own state group precisely
 * so it can be a third answer — but a bar that silently ignored four abandoned
 * items would leave somebody counting rows to work out why the totals do not
 * add up. So the bar is honest arithmetic and the count beside it says what was
 * left out.
 *
 * §11's five states: `[L]` server-rendered · `[E]` an empty cycle reads 0% with
 * its own line, and §7.6's "Add work to this cycle" sits below it · `[S]`,
 * `[X]` nothing editable · `[!]` more open than the cycle started with (carry-
 * over) still reads correctly, because the bar is completed-over-in-scope
 * rather than a countdown.
 */
export async function CycleProgress({ progress }: { progress: Progress }) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-text">
          {t('cycles.progress.summary', {
            completed: progress.completed,
            total: progress.inScope,
          })}
        </p>
        <p className="text-sm font-medium tabular-nums text-text">
          {/*
            ICU, not a `{percent}%` message. Where the sign goes and whether it
            takes a space is a locale question, and a message with the glyph
            written into it answers it once, in English, for both catalogues.
            `numberingSystem` is pinned here for the reason `src/i18n/request.ts`
            pins it globally: a Khmer task list showing ០១២៣ is not what anybody
            wants (§13).
          */}
          {format.number(progress.percent / 100, {
            style: 'percent',
            numberingSystem: 'latn',
          })}
        </p>
      </div>

      {/*
        A native progress semantic rather than a styled div: `role="progressbar"`
        with the three aria-value attributes is what makes "62 percent" reachable
        without the visible label being read as a stray number. The visible label
        above is what a sighted person reads, so the bar itself is aria-hidden's
        opposite — it carries the value and the label references it.
      */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label={t('cycles.progress.label')}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full rounded-full bg-success transition-[width] duration-200 ease-[var(--ease-out-soft)] motion-reduce:transition-none"
          style={{ inlineSize: `${progress.percent}%` }}
        />
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <Stat label={t('cycles.progress.open')} value={progress.inScope - progress.completed} />
        <Stat label={t('cycles.progress.done')} value={progress.completed} />
        {/* Only when there is any, so an ordinary cycle is not asked to explain
            a zero it never had. */}
        {progress.counts.cancelled > 0 && (
          <Stat label={t('cycles.progress.cancelled')} value={progress.counts.cancelled} />
        )}
        {/* §17-9 hides estimates by default; this appears only for a team that
            actually estimates, rather than showing everyone a confident zero. */}
        {progress.estimate && (
          <Stat
            label={t('cycles.progress.points')}
            value={progress.estimate.completed}
            of={progress.estimate.total}
          />
        )}
      </dl>
    </div>
  );
}

function Stat({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-medium tabular-nums text-text">
        {of === undefined ? value : `${value}/${of}`}
      </dd>
    </div>
  );
}
