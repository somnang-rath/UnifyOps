import type { InviteOutcome } from '@/server/services/invitations';

/**
 * The shapes server actions hand back to `useActionState`, and their initial
 * values.
 *
 * Here rather than beside the actions because a `'use server'` module may only
 * export async functions — an exported constant makes the whole file fail to
 * build, with an error that points at the last line rather than the offending
 * export. Types are erased and would have been fine; the `IDLE` objects are
 * not.
 *
 * Every message is a **key** into the catalogues, never a sentence. An English
 * string returned from the server is the one place Khmer quietly degrades
 * (§13), so both languages fail identically by construction.
 *
 * The import above is type-only, and stays that way: it is erased at compile
 * time, so this module carries no server code into a client bundle.
 */

export type FormState = {
  /** e.g. `auth.errors.invalidCredentials`. */
  error?: string;
  /** Per-field keys, keyed by the form field name. */
  fields?: Record<string, string>;
};

export const IDLE: FormState = {};

export type WorkspaceFormState = FormState;

export const WORKSPACE_IDLE: WorkspaceFormState = {};

export type InviteFormState = {
  error?: string;
  counts?: Record<InviteOutcome, number>;
  /** Addresses that failed, so §7.10's "retry on the failures only" has a list. */
  failed?: string[];
  invalid?: string[];
};

export const INVITE_IDLE: InviteFormState = {};

/** One row of the members table — a role change, a resend, a removal. */
export type RowActionState = { error?: string; done?: boolean };

export const ROW_IDLE: RowActionState = {};

/**
 * The comment composer's result (§7.7).
 *
 * `names` carries the people a refused mention named, so the message can say
 * *who* rather than how many — "block with a clear reason" is only clear if it
 * says whose access is missing.
 *
 * `postedAt` is what tells the composer a new success happened, and it exists
 * because of the rule beside it: §7.7 says a failed post keeps the typed text,
 * so the box cannot clear itself on every submit. It clears when this changes.
 */
export type CommentFormState = {
  error?: string;
  names?: string[];
  postedAt?: number;
};

export const COMMENT_IDLE: CommentFormState = {};
