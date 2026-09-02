import { z } from 'zod';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@/server/authz/roles';

/**
 * Turning what someone pasted into a list of people to invite (§7.10).
 *
 * In `src/lib` because both sides run it: the invite form previews the chips as
 * the user pastes, and the server parses the same text again when the form is
 * submitted. One implementation, so the preview cannot promise something the
 * send does not do.
 *
 * Pure, so the whole of the messy half of bulk invite is unit-testable with no
 * database and no HTTP. And it is the messy half: "a 40-person company should
 * not submit the same form 40 times" means this function is what stands between
 * a spreadsheet column and forty invitations, and every real paste is slightly
 * malformed.
 *
 * The rule the plan sets is that a bad address is *flagged in place* and the
 * rest still send. So nothing here throws and nothing here rejects the batch —
 * invalid entries come back as a separate list, keeping their original text so
 * the UI can show the user what it could not read.
 */

const emailSchema = z.email();

export type Recipient = {
  email: string;
  /** From a CSV `role` column. The form's role applies when this is absent. */
  role?: WorkspaceRole;
  /** From a CSV `team` column, matched to a team by name later — names, not ids. */
  team?: string;
};

export type ParsedRecipients = {
  recipients: Recipient[];
  /** The raw text of everything that did not parse, in the order it appeared. */
  invalid: string[];
  /** How many entries were dropped as repeats. §7.10: collapsed, not rejected. */
  duplicates: number;
};

const ROLES = new Set<string>(WORKSPACE_ROLES);

function asRole(value: string | undefined): WorkspaceRole | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return ROLES.has(normalized) ? (normalized as WorkspaceRole) : undefined;
}

function isEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

/**
 * Strips the display-name wrapper mail clients add.
 *
 * `Sophea Chan <sophea@acme.com>` is what copying a row out of Outlook or
 * Gmail actually produces, and treating it as malformed would make the single
 * most common paste in the product fail.
 */
function unwrapAngleBrackets(value: string): string {
  const match = value.match(/<([^>]+)>\s*$/);
  return (match?.[1] ?? value).trim();
}

/** Removes one layer of surrounding quotes, which is how CSV escapes a field. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

/**
 * Splits one line into CSV fields, respecting quotes.
 *
 * A plain `split(',')` is wrong on the field this feature is most likely to
 * meet: a team called "Design, West" exported by a spreadsheet arrives quoted
 * precisely because it contains the separator, and splitting naively turns one
 * team into two fields that match nothing.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      // A doubled quote inside a quoted field is one literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

/**
 * Whether a line is a CSV record rather than a run-on list of addresses.
 *
 * The distinguishing question is what follows the first comma: in a CSV record
 * it is a role or a team name, in a pasted list it is another address. Asking
 * that directly is more reliable than trying to detect a header, because plenty
 * of real files have no header row.
 */
function looksLikeCsvRow(fields: string[]): boolean {
  if (fields.length < 2) return false;
  const [first, ...rest] = fields;
  if (first === undefined || !isEmail(unwrapAngleBrackets(unquote(first)))) return false;
  return rest.every((field) => !isEmail(unwrapAngleBrackets(unquote(field))));
}

const HEADER_FIELDS = new Set(['email', 'e-mail', 'address', 'role', 'team', 'name']);

function isHeaderRow(fields: string[]): boolean {
  const cleaned = fields.map((f) => unquote(f).toLowerCase()).filter(Boolean);
  if (cleaned.length === 0) return false;
  return cleaned.every((f) => HEADER_FIELDS.has(f));
}

export function parseRecipients(raw: string): ParsedRecipients {
  const recipients: Recipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const add = (email: string, role?: WorkspaceRole, team?: string) => {
    const key = email.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    recipients.push({ email: key, ...(role ? { role } : {}), ...(team ? { team } : {}) });
  };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fields = splitCsvLine(trimmed);

    if (isHeaderRow(fields)) continue;

    if (looksLikeCsvRow(fields)) {
      const [emailField, roleField, teamField] = fields;
      const email = unwrapAngleBrackets(unquote(emailField ?? ''));
      // Every field is unquoted before it is interpreted. Reading the role
      // straight out of the raw field is the bug this line exists to not have:
      // `"member"` is not the string `member`, so a quoted CSV silently loses
      // every per-row role while looking like it worked.
      const team = unquote(teamField ?? '') || undefined;
      add(email, asRole(unquote(roleField ?? '')), team);
      continue;
    }

    // A run-on list: commas, semicolons, tabs and spaces all separate. Angle
    // brackets are kept out of the split so a wrapped address survives it.
    for (const token of trimmed.split(/[,;\t ]+/)) {
      const candidate = unwrapAngleBrackets(unquote(token));
      if (!candidate) continue;
      if (isEmail(candidate)) add(candidate);
      else invalid.push(candidate);
    }
  }

  return { recipients, invalid, duplicates };
}
