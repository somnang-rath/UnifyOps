'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE } from '@/lib/form-state';
import { VERIFICATION_DAYS, type VerificationDays } from '@/lib/wiki';
import {
  setPageOwnerAction,
  unverifyPageAction,
  verifyPageAction,
} from '@/app/[locale]/[workspaceSlug]/wiki/actions';
import type { VerificationView } from '@/server/services/wiki';
import { VerificationBadge } from './verification-badge';

/**
 * §21.3's controls: who owns this page, and is it still true (slice 19).
 *
 * Three forms rather than one, because they are three independent facts and a
 * combined save would make claiming a page and vouching for its contents the
 * same click — which is exactly the conflation §21.3 warns about when it says an
 * owner is "not its author, and not necessarily its last editor".
 *
 * **The verify form carries `baseRevision`.** §21.3's `[X]`: "verifying a page
 * somebody has edited underneath you → refused with §20.3.3's own message,
 * because verifying a body you did not read is the failure being prevented."
 * That is the sharpest instance of the stale rule in the product — a stale save
 * would destroy work, and a stale verification would attach somebody's name,
 * permanently and in the audit log, to words they never read.
 *
 * `[S]` §21.3: "verifying is one click and the badge appears with its date." So
 * the period select sits beside the button pre-set to the space's default rather
 * than behind a dialog: the common case is one click, and choosing a different
 * period is available without being a step.
 */
export function VerificationPanel({
  pageId,
  revisionNo,
  workspaceSlug,
  locale,
  verification,
  members,
  currentMemberId,
  canWrite,
  justUnverified = false,
}: {
  pageId: string;
  revisionNo: number;
  workspaceSlug: string;
  locale: 'en' | 'km';
  verification: VerificationView;
  members: { id: string; name: string }[];
  currentMemberId: string;
  canWrite: boolean;
  /**
   * Whether the save that brought the reader here cleared a verification
   * (§21.3).
   *
   * "The writer sees it happen and can re-verify in the same visit if the edit
   * was a typo fix." Without this the clearing is silent, and a silent automatic
   * transition is one people discover months later by noticing a badge they
   * expected is missing.
   */
  justUnverified?: boolean;
}) {
  const t = useTranslations('wiki');

  const [verifyState, verify, verifying] = useActionState(verifyPageAction, ROW_IDLE);
  const [clearState, clear, clearing] = useActionState(unverifyPageAction, ROW_IDLE);
  const [ownerState, setOwner, savingOwner] = useActionState(setPageOwnerAction, ROW_IDLE);

  const error = verifyState.error ?? clearState.error ?? ownerState.error;

  return (
    <section
      aria-labelledby={`verification-${pageId}`}
      className="space-y-3 rounded-md border border-border bg-surface p-3"
    >
      <h2 id={`verification-${pageId}`} className="sr-only">
        {t('verification.verify')}
      </h2>

      <VerificationBadge
        status={verification.status}
        verifiedAt={verification.verifiedAt}
        verifiedByName={verification.verifiedByName}
        expiresAt={verification.expiresAt}
        showDetail
      />

      {justUnverified && <Alert tone="warning">{t('verification.cleared')}</Alert>}
      {error && <Alert tone="danger">{t(error.replace(/^wiki\./, ''))}</Alert>}

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <form action={verify} className="flex flex-wrap items-end gap-2">
            <HiddenContext
              pageId={pageId}
              workspaceSlug={workspaceSlug}
              locale={locale}
            />
            <input type="hidden" name="baseRevision" value={revisionNo} />

            <label className="flex flex-col gap-1 text-2xs font-medium text-text-muted">
              {t('verification.period')}
              <select
                name="days"
                // Pre-set to the space's standing preference (§21.3: "so a
                // policy space does not depend on somebody remembering on every
                // page"). `defaultValue` rather than a controlled value: this is
                // a one-shot choice inside a form that resets on submit, and
                // holding it in state would be state with nothing to reconcile.
                defaultValue={periodValue(verification.defaultDays)}
                className="h-7 rounded-sm border border-border bg-surface px-2 text-xs text-text"
              >
                <option value="never">{t('verification.periodNever')}</option>
                {VERIFICATION_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {t('verification.periodDays', { count: days })}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" size="sm" variant="primary" loading={verifying}>
              {verification.status === 'verified' || verification.status === 'expiring'
                ? t('verification.reverify')
                : t('verification.verify')}
            </Button>
          </form>

          {verification.verifiedAt !== null && (
            <form action={clear}>
              <HiddenContext
                pageId={pageId}
                workspaceSlug={workspaceSlug}
                locale={locale}
              />
              <Button type="submit" size="sm" variant="ghost" loading={clearing}>
                {t('verification.unverify')}
              </Button>
            </form>
          )}
        </div>
      )}

      {/* --- Ownership ----------------------------------------------------- */}
      <div className="border-t border-border pt-3">
        <p className="text-2xs text-text-muted">{t('owner.explain')}</p>

        {canWrite ? (
          <form action={setOwner} className="mt-2 flex flex-wrap items-end gap-2">
            <HiddenContext
              pageId={pageId}
              workspaceSlug={workspaceSlug}
              locale={locale}
            />

            <label className="flex flex-col gap-1 text-2xs font-medium text-text-muted">
              {t('owner.assign')}
              <select
                name="ownerMemberId"
                defaultValue={verification.ownerMemberId ?? ''}
                className="h-7 max-w-56 rounded-sm border border-border bg-surface px-2 text-xs text-text"
              >
                {/* The empty option is *nobody*, which is an answer somebody
                    chooses and one of the All-pages view's four filters — not a
                    missing value. A `<select>` cannot submit null, so the empty
                    string carries the intent. */}
                <option value="">{t('owner.none')}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" size="sm" loading={savingOwner}>
              {t('verification.save')}
            </Button>
          </form>
        ) : (
          <p className="mt-1 text-sm text-text">
            {verification.ownerName ?? t('owner.none')}
          </p>
        )}

        {/*
          **A form of its own, not a second submit button on the one above.**
          
          A submit button carries its own `name`/`value` into the payload, so a
          button named `ownerMemberId` sitting inside a form that already has a
          `<select name="ownerMemberId">` submits *both* — and `formData.get`
          returns the first, which is the select. "Take this on" therefore set
          the owner to whatever the select happened to show, which was usually
          *nobody*: a control that did the opposite of its label, silently, with
          the page reloading as if it had worked. The e2e run caught it; nothing
          else could have.
        */}
        {canWrite && verification.ownerMemberId !== currentMemberId && (
          <form action={setOwner} className="mt-2">
            <HiddenContext
              pageId={pageId}
              workspaceSlug={workspaceSlug}
              locale={locale}
            />
            <input type="hidden" name="ownerMemberId" value={currentMemberId} />
            <Button type="submit" size="sm" variant="ghost">
              {t('owner.claim')}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

/**
 * The three fields every action in this file reads back.
 *
 * A component rather than three copies, because `contextFrom` in `actions.ts`
 * reads exactly these names and a form that forgets one fails at the workspace
 * lookup with a message about membership — which is a long way from the missing
 * input that caused it.
 */
function HiddenContext({
  pageId,
  workspaceSlug,
  locale,
}: {
  pageId: string;
  workspaceSlug: string;
  locale: 'en' | 'km';
}) {
  return (
    <>
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );
}

/** `null` is *Never*, which the form submits as a word rather than an empty value. */
function periodValue(days: VerificationDays | null): string {
  return days === null ? 'never' : String(days);
}
