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

/**
 * The "forgot password" request (§4's Identity row).
 *
 * `sent` rather than a redirect, because the answer is deliberately the same
 * whether or not an account exists — see `requestPasswordReset`. A redirect to
 * a "check your email" *route* would be a URL anybody could visit directly,
 * which reads as a confirmation that the address is real; a state on the form
 * that submitted it cannot be reached any other way.
 */
export type PasswordResetRequestState = FormState & { sent?: boolean };

export const PASSWORD_RESET_REQUEST_IDLE: PasswordResetRequestState = {};

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

/**
 * A note composer's result (§20.3.1).
 *
 * `savedAt` is the comment composer's `postedAt` under a different name and for
 * the identical reason: §20.3.1's `[X]` says a failed save keeps the text — "the
 * text stays in the box and the retry button is the same button", a rule §7.7
 * already stated and which "applies with more force to something nobody else has
 * a copy of". So the box cannot clear itself on every submit; it clears when
 * this number changes, which is the only way two successful saves in a row look
 * different to a component.
 *
 * `noteId` is what the capture dialog needs to offer a pin without a second
 * round trip, and what the composer needs to switch from creating to editing.
 */
export type NoteFormState = {
  error?: string;
  fields?: Record<string, string>;
  savedAt?: number;
  noteId?: string;
};

export const NOTE_IDLE: NoteFormState = {};

/**
 * A wiki page save (§20.3.3 — slice 18).
 *
 * **`current` is the whole reason this is not `FormState`.** §20.3.3 refuses a
 * stale save rather than merging it, and "the writer is shown their text beside
 * the version that landed while they were typing". Neither body is ever
 * discarded, so the refusal has to carry the *other* one back — an error string
 * saying "somebody else saved" would leave the person with two versions and only
 * one of them on screen.
 *
 * The writer's own text is not in this state and does not need to be: the
 * textarea is controlled and keeps it, which is §7.7's "never lose typed text"
 * rule that the comment composer already follows. What the server has to supply
 * is the half the browser cannot know.
 *
 * `savedAt` rather than a boolean, for `CommentFormState`'s reason: two
 * successful saves in a row must look different, or the second one does not
 * re-render.
 */
export type WikiPageFormState = {
  error?: string;
  /** Names, when the failure is a mention naming somebody who cannot read the space. */
  names?: string[];
  savedAt?: number;
  revisionNo?: number;
  /** The version that landed while this writer was typing (§20.3.3). */
  current?: { title: string; body: string; revisionNo: number };
};

export const WIKI_PAGE_IDLE: WikiPageFormState = {};
