import { getFormatter, getTranslations } from 'next-intl/server';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { displayName } from '@/lib/seeded-name';
import type { ActivityFeed as Feed } from '@/server/services/activity';
import type { ActivityRow } from '@/server/queries/activity';

/**
 * One work item's history (§4, slice 7).
 *
 * A server component, and there is nothing to hydrate on the client: the feed
 * is a record of things that already happened, so it cannot change while
 * somebody reads it without the page changing too. That also keeps §13's
 * hardest requirement cheap — every line is a translated sentence assembled on
 * the server, where the locale and the workspace timezone both already are.
 *
 * §11's five states: `[L]` server-rendered inside the page · `[E]` an item
 * created before this slice has no history, and says so rather than showing a
 * blank panel · `[S]`, `[X]` not applicable, nothing here is editable ·
 * `[!]` an archived project changes nothing — history stays readable.
 *
 * **The sentences carry names as plain text, not chips.** A `StatePill` inside
 * "moved this from X to Y" would need the message split into fragments around
 * it, and a translator would then be laying out a sentence they cannot see. The
 * feed is a log; it reads as one.
 */

/** The fields `updateWorkItem` compares, each with its own line in the feed. */
const FIELDS = new Set(['title', 'description', 'priority', 'startDate', 'dueDate', 'estimate']);

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The one line this row reads as.
 *
 * Every unresolved reference falls back to a translated phrase rather than to
 * an id: a workflow state is hard-deleted (§4 migrates its items first), and a
 * feed that answers "who moved this, and where to" with a uuid has failed at
 * the only thing it does.
 */
function sentence(row: ActivityRow, feed: Feed, t: Translate): string {
  const actor = row.actorName ?? t('activity.formerMember');
  const data = row.data;

  const stateName = (id: unknown): string => {
    const state = typeof id === 'string' ? feed.states[id] : undefined;
    return state ? displayName(state, t) : t('activity.deletedState');
  };

  switch (row.action) {
    case 'work_item.created':
      return t('activity.created', { actor });

    case 'work_item.updated': {
      const field = data.field;
      // An unknown field name means a column was added to the edit path without
      // a message for it. One vague-but-true line beats a raw key on screen.
      return typeof field === 'string' && FIELDS.has(field)
        ? t(`activity.field.${field}`, { actor })
        : t('activity.changed', { actor });
    }

    case 'work_item.state_changed':
      return data.completed === true
        ? t('activity.stateCompleted', { actor, to: stateName(data.to) })
        : t('activity.stateChanged', {
            actor,
            from: stateName(data.from),
            to: stateName(data.to),
          });

    case 'work_item.assigned': {
      const person =
        (typeof data.memberId === 'string' ? feed.people[data.memberId] : undefined) ??
        t('activity.formerMember');
      return data.assigned === true
        ? t('activity.assigned', { actor, person })
        : t('activity.unassigned', { actor, person });
    }

    case 'work_item.labelled': {
      const label =
        (typeof data.labelId === 'string' ? feed.labels[data.labelId]?.name : undefined) ??
        t('activity.deletedLabel');
      return data.applied === true
        ? t('activity.labelled', { actor, label })
        : t('activity.unlabelled', { actor, label });
    }

    case 'work_item.custom_field_changed': {
      // The name is resolved now, never written into the row — a field renamed
      // next March reads under its new name in the line that recorded this
      // change, which is the rule `data` follows everywhere (§13).
      const field =
        (typeof data.fieldId === 'string' ? feed.fields[data.fieldId] : undefined) ??
        t('activity.deletedField');
      return t('activity.customField', { actor, field });
    }

    /*
     * §7.12's offboarding, in the item's own history (slice 15).
     *
     * One event produced this line and forty others like it — the registry's
     * projector returns a list, which is what makes an offboarding say so in
     * every item it touched rather than silently changing forty owners. It is
     * the one line in the feed that is about a person leaving rather than about
     * the item, and it is here because the person picking the work up has no
     * other way to find out why it is theirs.
     */
    case 'workspace_member.work_reassigned': {
      const from =
        (typeof data.fromMemberId === 'string' ? feed.people[data.fromMemberId] : undefined) ??
        t('activity.formerMember');
      const to =
        typeof data.toMemberId === 'string' ? feed.people[data.toMemberId] : undefined;

      return to
        ? t('activity.reassigned', { actor, from, to })
        : t('activity.reassignedToNobody', { actor, from });
    }

    case 'work_item.blocked_changed':
      return data.blocked === true
        ? t('activity.blocked', {
            actor,
            reason: typeof data.reason === 'string' ? data.reason : '',
          })
        : t('activity.unblocked', { actor });

    default:
      // A row written by a deploy that knew an event this one does not. It
      // still happened, and it still had an actor.
      return t('activity.changed', { actor });
  }
}

export async function ActivityFeed({
  feed,
  timezone,
  showAllHref,
}: {
  feed: Feed;
  /**
   * The company's zone (§6-1, §17-13). Every member sees one timestamp for an
   * event; read off the device, "3:40pm" would be a different afternoon for a
   * manager in another country than for the person who did it.
   */
  timezone: string;
  /** Where "show the full history" goes, or null when nothing is hidden. */
  showAllHref: string | null;
}) {
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);

  return (
    <section aria-labelledby="activity-heading" className="space-y-3">
      <h2 id="activity-heading" className="text-xs font-medium text-text-muted">
        {t('activity.heading')}
      </h2>

      {feed.lines.length === 0 ? (
        <EmptyState title={t('activity.empty')} />
      ) : (
        <>
          {feed.truncated && showAllHref && (
            <p className="text-2xs text-text-subtle">
              {t('activity.truncated')}{' '}
              <Link
                href={showAllHref}
                className="underline underline-offset-2 transition-colors duration-120 hover:text-text"
              >
                {t('activity.showAll')}
              </Link>
            </p>
          )}

          <ol className="space-y-2.5">
            {feed.lines.map((row) => {
              const who = row.actorName ?? t('activity.someone');
              return (
                <li key={row.id} className="flex items-start gap-2 text-xs text-text-muted">
                  <Avatar id={row.actorUserId ?? row.id} name={who} size="sm" className="mt-px" />
                  <p className="min-w-0 flex-1">
                    {sentence(row, feed, t)}{' '}
                    <time
                      dateTime={row.occurredAt.toISOString()}
                      className="whitespace-nowrap text-text-subtle tabular-nums"
                    >
                      {format.dateTime(row.occurredAt, {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: timezone,
                      })}
                    </time>
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
