import 'server-only';

import { eq } from 'drizzle-orm';
import { isAccentColor, type AccentColor } from '@/lib/branding';
import { hasNoWorkingDays, isTimeZone, isWeekDay } from '@/lib/workspace-date';
import { locales, type Locale } from '@/i18n/routing';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import { isUniqueViolation } from '@/server/db/errors';
import { workspace as workspaceTable } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { slugify, slugProblem, type SlugProblem } from '@/lib/slug';

/**
 * §6-1: the company's own settings, and the first screen in the product that
 * changes what every other screen means.
 *
 * Name, slug, timezone, week start, working days, default language — plus the
 * branding half of §6-7 below. Three of these were columns before they were
 * settings: `timezone` landed in slice 5 because "overdue" needed an authority
 * (§17-13), `working_days` in slice 9 because the digest needed to know which
 * evenings were working ones, and both carry a comment saying the screen was
 * slice 15's. This is that screen's service.
 *
 * **The reason it is one save rather than six** is §6's governing rule: "a
 * company that never opens Settings must be completely fine", which makes this
 * a form somebody visits once, changes two things on, and leaves. Six actions
 * would be six audit rows for one visit, and a log that reads as six changes to
 * one company on one afternoon is a log somebody has to reconstruct.
 *
 * Everything here is `workspace.settings` — §10's row, which already reads
 * "Workspace settings, branding, teams". **No §10 row was invented, the tenth
 * time that decision has gone the same way**, after labels, attachments,
 * notifications, custom fields, cycles, saved views, availability, search and
 * the holiday calendar beside this. There is nothing to invent: the matrix
 * named this screen before the screen existed.
 */

export type WorkspaceSettings = {
  name: string;
  slug: string;
  timezone: string;
  weekStart: number;
  workingDays: number;
  defaultLocale: string;
  accent: AccentColor | null;
  logoKey: string | null;
};

export async function getWorkspaceSettings(
  resolved: ResolvedActor,
): Promise<WorkspaceSettings | null> {
  return withActor(resolved.context, async (tx) => {
    const rows = await tx
      .select({
        name: workspaceTable.name,
        slug: workspaceTable.slug,
        timezone: workspaceTable.timezone,
        weekStart: workspaceTable.weekStart,
        workingDays: workspaceTable.workingDays,
        defaultLocale: workspaceTable.defaultLocale,
        accent: workspaceTable.accent,
        logoKey: workspaceTable.logoKey,
      })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, resolved.workspace.id))
      .limit(1);

    return rows[0] ?? null;
  });
}

export type SettingsProblem =
  | 'name_required'
  | 'invalid_timezone'
  | 'invalid_week_start'
  | 'no_working_days'
  | 'invalid_locale'
  | SlugProblem
  | 'slug_taken';

export type SettingsResult =
  /** The slug is returned because changing it changes the URL of the page you are on. */
  | { ok: true; slug: string }
  /** An identifier, never a sentence — the sentences are translated (§13). */
  | { ok: false; problem: SettingsProblem };

export type SettingsInput = {
  name: string;
  slug: string;
  timezone: string;
  weekStart: number;
  workingDays: number;
  defaultLocale: string;
};

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/**
 * Save §6-1.
 *
 * Validation happens before the transaction opens, because a refusal should
 * cost nothing — and because every one of these checks is answerable from the
 * input plus a constant.
 */
export async function updateWorkspaceSettings(
  resolved: ResolvedActor,
  input: SettingsInput,
): Promise<SettingsResult> {
  assertCan(resolved.actor, 'workspace.settings');

  // NFC before storing, so a Khmer name typed with a different composition
  // sequence compares and sorts as the same string it looks like (§13).
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };

  // Against the tz database as this Node build knows it, rather than a CHECK
  // constraint: the zone list changes without the schema, and a workspace whose
  // zone was abolished should keep working rather than fail to save.
  if (!isTimeZone(input.timezone)) return { ok: false, problem: 'invalid_timezone' };

  if (!isWeekDay(input.weekStart)) return { ok: false, problem: 'invalid_week_start' };

  // The one setting on this form that could put a workspace in the
  // unrecoverable state §6 rules out — see the CHECK in migration 0028 for what
  // silently stops working. Refused here so the person gets a sentence rather
  // than a constraint violation.
  if (hasNoWorkingDays(input.workingDays)) return { ok: false, problem: 'no_working_days' };
  const workingDays = input.workingDays & 0b1111111;

  if (!isLocale(input.defaultLocale)) return { ok: false, problem: 'invalid_locale' };

  // A slug the person typed is validated, never silently rewritten: they are
  // looking at the field, and a value that changes under them reads as a bug.
  // The same bargain `createWorkspace` makes, and the reason both call the same
  // pure module (`src/lib/slug.ts`) that the field previews with as they type.
  const slug = slugify(input.slug);
  const problem = slugProblem(slug);
  if (problem) return { ok: false, problem };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const rows = await tx
        .select({
          name: workspaceTable.name,
          slug: workspaceTable.slug,
          timezone: workspaceTable.timezone,
          weekStart: workspaceTable.weekStart,
          workingDays: workspaceTable.workingDays,
          defaultLocale: workspaceTable.defaultLocale,
        })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, resolved.workspace.id))
        .limit(1);

      // RLS has already scoped this to the acting workspace, so a missing row
      // is not "somebody else's company" — it cannot be.
      const current = rows[0];
      if (!current) return { ok: false, problem: 'name_required' } as const;

      await tx
        .update(workspaceTable)
        .set({
          name,
          slug,
          timezone: input.timezone,
          weekStart: input.weekStart,
          workingDays,
          defaultLocale: input.defaultLocale,
          updatedAt: new Date(),
        })
        .where(eq(workspaceTable.id, resolved.workspace.id));

      // Three events at most, and only for what actually moved. A save that
      // changed nothing writes nothing to the log — §18-11's log is read by a
      // person, and a row per visit to a settings screen is noise that pushes
      // the rows that matter off the page.
      if (name !== current.name) {
        uow.emit({
          type: 'workspace.renamed',
          workspaceId: resolved.workspace.id,
          from: current.name,
          to: name,
        });
      }

      if (slug !== current.slug) {
        uow.emit({
          type: 'workspace.slug_changed',
          workspaceId: resolved.workspace.id,
          from: current.slug,
          to: slug,
        });
      }

      const changed = (
        [
          current.timezone !== input.timezone ? 'timezone' : null,
          current.workingDays !== workingDays ? 'workingDays' : null,
          current.weekStart !== input.weekStart ? 'weekStart' : null,
          current.defaultLocale !== input.defaultLocale ? 'defaultLocale' : null,
        ] as const
      ).filter((entry): entry is Exclude<typeof entry, null> => entry !== null);

      if (changed.length > 0) {
        uow.emit({
          type: 'workspace.settings_changed',
          workspaceId: resolved.workspace.id,
          changed,
          timezone: input.timezone,
          workingDays,
          weekStart: input.weekStart,
          defaultLocale: input.defaultLocale,
        });
      }

      return { ok: true, slug } as const;
    });
  } catch (error) {
    // The slug is unique across every workspace in the product, which is the one
    // thing on this form a company can lose a race for. The unique index is the
    // authority rather than a `SELECT` beforehand, because between the two of
    // them somebody else can take it.
    if (isUniqueViolation(error)) return { ok: false, problem: 'slug_taken' };
    throw error;
  }
}

/* ------------------------------------------------------------------------- */
/* §6-7 Branding                                                             */
/* ------------------------------------------------------------------------- */

export type BrandingProblem = 'invalid_accent';

export type BrandingResult = { ok: true } | { ok: false; problem: BrandingProblem };

/**
 * Set the accent colour, the logo, or clear either (§6-7).
 *
 * The logo arrives as an object **key**, already uploaded — the ticket flow in
 * `src/server/services/workspace-logo.ts` is what puts the bytes there, for the
 * reason §8 gives about attachments: no byte passes through the app server, so
 * the row is written after the store has the file rather than around it.
 *
 * `undefined` means "leave it alone" and `null` means "clear it", which are
 * different requests from a form that can save the accent without touching the
 * logo. Collapsing them would make saving a colour delete the logo.
 */
export async function updateBranding(
  resolved: ResolvedActor,
  input: { accent?: string | null; logoKey?: string | null },
): Promise<BrandingResult> {
  assertCan(resolved.actor, 'workspace.settings');

  if (input.accent !== undefined && input.accent !== null && !isAccentColor(input.accent)) {
    return { ok: false, problem: 'invalid_accent' };
  }

  const accent = (input.accent ?? null) as AccentColor | null;

  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({ accent: workspaceTable.accent, logoKey: workspaceTable.logoKey })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, resolved.workspace.id))
      .limit(1);

    const current = rows[0];
    if (!current) return { ok: true } as const;

    const nextAccent = input.accent === undefined ? current.accent : accent;
    const nextLogoKey = input.logoKey === undefined ? current.logoKey : input.logoKey;

    await tx
      .update(workspaceTable)
      .set({ accent: nextAccent, logoKey: nextLogoKey, updatedAt: new Date() })
      .where(eq(workspaceTable.id, resolved.workspace.id));

    const changed = (
      [
        nextAccent !== current.accent ? 'accent' : null,
        nextLogoKey !== current.logoKey ? 'logo' : null,
      ] as const
    ).filter((entry): entry is Exclude<typeof entry, null> => entry !== null);

    if (changed.length > 0) {
      uow.emit({
        type: 'workspace.branding_changed',
        workspaceId: resolved.workspace.id,
        changed,
        accent: nextAccent,
        // The key is deliberately not logged: an append-only row outlives the
        // object it names, and whether the company has a logo is the fact worth
        // keeping. See the registry entry.
        hasLogo: nextLogoKey !== null,
      });
    }

    return { ok: true } as const;
  });
}
