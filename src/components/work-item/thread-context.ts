import type { CommentFormState, RowActionState } from '@/lib/form-state';

/**
 * What a comment thread is attached to, and what it posts back with
 * (§7.7, §21.6 — slice 21).
 *
 * **A module with no `'use client'` directive, and that is the whole reason it
 * exists rather than living in `comment-composer.tsx`.** These types and this
 * one function are needed by both halves of the thread: the composer and the
 * delete control are client components, and `comment-thread.tsx` — which draws
 * the conversation — is a server component. A `'use client'` module's *types*
 * cross that line freely, because they are erased; a `'use client'` module's
 * **functions do not**. Calling one from the server fails at render with
 * "Attempted to call filesContextOf() from the server but filesContextOf is on
 * the client", which is a runtime error on a page that type-checks, and it is
 * how this file came to exist.
 *
 * Not in `src/lib`, though the rule there is "code both sides run": these are
 * component contracts rather than domain logic, and `lib` is where `slug.ts`,
 * `mentions.ts` and `rank.ts` live. The line worth drawing is that a module here
 * may describe components, and a module in `lib` may not.
 */

/**
 * The item-shaped context the **attachment** components take (slice 8).
 *
 * Deliberately not widened for slice 21. A page comment has no files — see
 * `pageCommentThreadIn`, which names that as a slice-18 gap — so widening this
 * into a union would have made five components that only ever handle an item's
 * files narrow a subject they can do nothing with.
 */
export type ComposerContext = {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  workItemId: string;
  /** The `142` of `ENG-142` — what the action revalidates. */
  number: number;
};

/**
 * What a thread is attached to (§21.6).
 *
 * The item branch carries a slug and a number as well as an id, because
 * `revalidateItem` rebuilds a path from them — the form has to post back
 * everything the action needs, not only what identifies the row.
 */
export type ThreadSubject =
  | { kind: 'work_item'; projectSlug: string; workItemId: string; number: number }
  | { kind: 'wiki_page'; pageId: string };

/**
 * Everything the thread and its composer post back with.
 *
 * **The two actions are props rather than imports**, which is the change slice
 * 21 made to slice 8's components. They used to import
 * `postCommentAction`/`deleteCommentAction` from the project route directly —
 * fine while there was one thread in the product, and a hard dependency on the
 * work-item route the moment there were two. `PageIconForm` already takes its
 * `save` this way, so the precedent is the wiki's own.
 */
export type ThreadContext = {
  workspaceSlug: string;
  locale: string;
  subject: ThreadSubject;
  post: (previous: CommentFormState, formData: FormData) => Promise<CommentFormState>;
  remove: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
};

/**
 * The attachment context for a thread, or null when the subject cannot hold
 * files.
 *
 * Derived rather than passed alongside `ThreadContext`, so one object reaches
 * the thread and the item-shaped half is reconstructed exactly where it is
 * needed. Null is what makes the composer hide the paperclip, the paste handler
 * and the drop target on a page — controls that promise something the ticket
 * route cannot deliver are worse than absent ones.
 */
export function filesContextOf(context: ThreadContext): ComposerContext | null {
  return context.subject.kind === 'work_item'
    ? {
        workspaceSlug: context.workspaceSlug,
        projectSlug: context.subject.projectSlug,
        locale: context.locale,
        workItemId: context.subject.workItemId,
        number: context.subject.number,
      }
    : null;
}
