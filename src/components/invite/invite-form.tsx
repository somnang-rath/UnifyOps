'use client';

import { useActionState, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField, TextareaField } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { WORKSPACE_ROLES } from '@/server/authz/roles';
import { parseRecipients } from '@/lib/recipients';
import { INVITE_IDLE, type InviteFormState } from '@/lib/form-state';
import { inviteAction } from '@/app/[locale]/[workspaceSlug]/actions';

/**
 * §7.10's bulk invite.
 *
 * "Each address becomes a validated, removable chip; duplicates and existing
 * members are collapsed, not rejected." The chips are derived from the textarea
 * as it changes, using the same pure `parseRecipients` the server uses — so
 * what the user sees previewed is exactly what will be sent, including which
 * entries it could not read.
 *
 * The textarea stays the source of truth rather than the chips holding state of
 * their own. Removing a chip edits the text. That keeps paste, undo, and typing
 * a fortieth address all working without a second model to keep in sync — and a
 * 40-person company pasting a spreadsheet column is the case this form exists
 * for.
 */
export function InviteForm({
  workspaceSlug,
  teams,
  onSkip,
}: {
  workspaceSlug: string;
  teams: { id: string; name: string }[];
  /** The onboarding step passes a Skip control; the settings screen does not. */
  onSkip?: React.ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<InviteFormState, FormData>(
    inviteAction,
    INVITE_IDLE,
  );

  const [raw, setRaw] = useState('');
  const parsed = useMemo(() => parseRecipients(raw), [raw]);

  const removeAddress = (email: string) => {
    // Rebuilt from what parsing found rather than by cutting the original text:
    // the address may have arrived wrapped as `Name <a@b.com>` or inside a CSV
    // row, and a substring edit would leave the wrapper behind.
    setRaw(
      parsed.recipients
        .filter((r) => r.email !== email)
        .map((r) => r.email)
        .join('\n'),
    );
  };

  const summary = state.counts;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      {summary && (
        <Alert tone={summary.failed > 0 ? 'warning' : 'success'}>
          <ul className="space-y-0.5">
            {summary.sent > 0 && <li>{t('invite.result.sent', { count: summary.sent })}</li>}
            {summary.already_member > 0 && (
              <li>{t('invite.result.skippedMember', { count: summary.already_member })}</li>
            )}
            {summary.already_invited > 0 && (
              <li>{t('invite.result.skippedPending', { count: summary.already_invited })}</li>
            )}
            {summary.invalid > 0 && (
              <li>{t('invite.result.invalidCount', { count: summary.invalid })}</li>
            )}
            {summary.failed > 0 && (
              <li>{t('invite.result.failed', { count: summary.failed })}</li>
            )}
          </ul>
        </Alert>
      )}

      <TextareaField
        label={t('invite.form.emails')}
        name="emails"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        help={t('invite.form.emailsHint')}
        autoFocus
        spellCheck={false}
      />

      {(parsed.recipients.length > 0 || parsed.invalid.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            {t('invite.form.count', { count: parsed.recipients.length })}
          </p>

          <ul className="flex flex-wrap gap-1.5">
            {parsed.recipients.map((r) => (
              <li key={r.email}>
                <span className="inline-flex items-center gap-1 rounded-xs border border-border bg-surface-sunken py-0.5 pe-0.5 ps-2 text-xs">
                  {/* Addresses are Latin, but a display name pasted alongside
                      one may not be — min-w-0 lets the chip wrap rather than
                      push the row wider than the panel. */}
                  <span className="min-w-0 break-all">{r.email}</span>
                  <button
                    type="button"
                    onClick={() => removeAddress(r.email)}
                    aria-label={t('invite.form.remove', { email: r.email })}
                    className="rounded-xs p-0.5 text-text-subtle transition-colors duration-120 hover:bg-surface-hover hover:text-text"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              </li>
            ))}

            {/* §7.10: "a pasted list contains a malformed address → flagged in
                place, the rest still send." Flagged, and left in the textarea
                so it can be corrected rather than silently dropped. */}
            {parsed.invalid.map((value, index) => (
              <li key={`${value}-${index}`}>
                <Badge tone="danger">
                  <span className="break-all">{value}</span>
                  <span className="ms-1 text-text-muted">{t('invite.form.invalid')}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SelectField label={t('invite.form.role')} name="role" defaultValue="member">
        {WORKSPACE_ROLES.filter((role) => role !== 'owner').map((role) => (
          <option key={role} value={role}>
            {t(`role.${role}`)}
          </option>
        ))}
      </SelectField>

      {teams.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-text-muted">{t('invite.form.teams')}</legend>
          <p className="text-xs text-text-subtle">{t('invite.form.teamsHint')}</p>
          <div className="flex flex-wrap gap-3">
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="teamIds"
                  value={team.id}
                  className="size-4 rounded-xs border-border accent-[var(--accent)]"
                />
                <span>{team.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <p className="text-xs text-text-subtle">{t('invite.form.projectsLater')}</p>

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          disabled={parsed.recipients.length === 0}
          className="flex-1"
        >
          {pending ? t('invite.form.sending') : t('invite.form.send')}
        </Button>
        {/* §7.1: "Skip is visually equal to Send." Same size, same row, not a
            quiet link underneath. */}
        {onSkip}
      </div>
    </form>
  );
}
