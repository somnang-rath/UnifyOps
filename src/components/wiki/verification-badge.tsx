import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/feedback';
import type { CalendarDate } from '@/lib/workspace-date';
import type { VerificationStatus } from '@/lib/wiki';

/**
 * §21.3's badge — the whole feature, as one word somebody can see (slice 19).
 *
 * "Staleness does not announce itself — a wrong page and a right page look
 * identical, which is exactly why the answer cannot be a convention and has to
 * be data." This is where the data becomes visible, and everything about it is
 * shaped by that sentence.
 *
 * **The status is a prop, never computed here.** `verificationStatus` is pure
 * and both sides could call it, but only the server can resolve `warnFrom` —
 * the working-day horizon that separates *verified* from *expiring* — because
 * only the database knows the company's working days and holidays (§9). A
 * component that derived its own amber threshold would be the second
 * implementation of a rule that exists precisely to have one.
 *
 * **Four tones for four states, and `never` is not a fault.** §21.3's `[E]`: a
 * space where nothing is verified "reads as *nothing here has been reviewed
 * yet*, which is a true and actionable sentence rather than a fault". So it is
 * the neutral `info` tone, not `danger` — a page nobody has vouched for is the
 * honest starting point for every page ever written, and colouring it red on
 * day one would teach people that the badge means nothing.
 *
 * A `Badge` rather than a new primitive: §12's inventory has one, its four
 * tones are exactly the four levels of emphasis needed, and "a second badge
 * component is how a design system dies".
 */

const TONES: Record<VerificationStatus, 'info' | 'success' | 'warning' | 'danger'> = {
  // Neutral, per the note above: unreviewed is a starting point, not a problem.
  never: 'info',
  verified: 'success',
  // Amber a week out (§21.13), which is `warning`'s exact meaning everywhere
  // else in the product — something a person can still act on in time.
  expiring: 'warning',
  expired: 'danger',
};

export function VerificationBadge({
  status,
  verifiedAt,
  verifiedByName,
  expiresAt,
  showDetail = false,
}: {
  status: VerificationStatus;
  verifiedAt: Date | null;
  verifiedByName: string | null;
  expiresAt: CalendarDate | null;
  /**
   * Whether to spell the dates out beside the badge.
   *
   * Off in the All-pages table, where the expiry has a column of its own and
   * repeating it in the badge would be the same fact twice in one row. On in
   * the page header, which is the one place somebody asks "who said so, and
   * when".
   */
  showDetail?: boolean;
}) {
  const t = useTranslations('wiki.verification');
  const format = useFormatter();

  const label = t(status);

  if (!showDetail) {
    return <Badge tone={TONES[status]}>{label}</Badge>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={TONES[status]}>{label}</Badge>

      <span className="text-2xs text-text-muted">
        {status === 'never'
          ? t('neverExplain')
          : detailFor({ t, format, status, verifiedAt, verifiedByName, expiresAt })}
      </span>
    </span>
  );
}

/**
 * The sentence beside the badge.
 *
 * Two facts, and which one leads depends on the state: a page comfortably in
 * review is described by *when somebody vouched for it*, and one that has
 * lapsed or is about to is described by *when it is due*. That is the fact the
 * reader needs in each case, and leading with the other would make the common
 * question take a second read.
 *
 * `verifiedByName` may be null even where `verifiedAt` is not — the join is a
 * left join and the account behind a membership can be gone (§20.5's "a page
 * stays attributed" is about the membership, not about the user row surviving
 * forever). The message without a name is a real string in both catalogues
 * rather than an interpolation of an empty one, because "Verified 3 March by "
 * is the kind of sentence that ships.
 */
function detailFor({
  t,
  format,
  status,
  verifiedAt,
  verifiedByName,
  expiresAt,
}: {
  t: ReturnType<typeof useTranslations<'wiki.verification'>>;
  format: ReturnType<typeof useFormatter>;
  status: VerificationStatus;
  verifiedAt: Date | null;
  verifiedByName: string | null;
  expiresAt: CalendarDate | null;
}): string {
  // Latin digits are pinned for both locales in `src/i18n/request.ts`, so the
  // formatter does §13's work here rather than each call site remembering to.
  const on = (date: CalendarDate) => format.dateTime(new Date(`${date}T00:00:00Z`), 'short');

  if (status === 'expired' && expiresAt !== null) return t('expiredOn', { date: on(expiresAt) });
  if (status === 'expiring' && expiresAt !== null) return t('expiresOn', { date: on(expiresAt) });

  if (verifiedAt === null) return t('noCycle');

  const date = format.dateTime(verifiedAt, 'short');
  return verifiedByName === null
    ? t('verifiedOnUnknown', { date })
    : t('verifiedOn', { date, name: verifiedByName });
}
