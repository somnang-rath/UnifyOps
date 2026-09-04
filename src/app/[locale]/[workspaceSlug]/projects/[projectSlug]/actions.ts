'use server';

import { revalidatePath } from 'next/cache';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import type { CommentFormState, FormState, RowActionState } from '@/lib/form-state';
import {
  deleteComment,
  postComment,
  type CommentProblem,
} from '@/server/services/comments';
import {
  confirmAttachment,
  deleteAttachment,
  type AttachmentServiceProblem,
} from '@/server/services/attachments';
import {
  setWorkItemCustomFields,
  type CustomFieldProblem,
} from '@/server/services/custom-fields';
import {
  createSavedView,
  deleteSavedView,
  saveTableLayout,
  updateSavedView,
  type SavedViewFailure,
} from '@/server/services/saved-views';
import type { TableLayout } from '@/lib/saved-views';
import {
  createWorkItem,
  deleteWorkItem,
  setWorkItemAssignees,
  setWorkItemBlocked,
  setWorkItemLabels,
  setWorkItemState,
  updateWorkItem,
  type WorkItemProblem,
} from '@/server/services/work-items';
import { redirect } from '@/i18n/navigation';

/**
 * The work-item server actions.
 *
 * Each one re-resolves the actor from the session and hands the request to the
 * service, which asks §10. A server action is a public endpoint — that only our
 * own forms post to it is a property of our UI, not of the network — so
 * `workspaceSlug` and `workItemId` arriving in a payload are a request, never
 * an authorization. Nothing here decides anything; it translates.
 */

/** Problem identifiers to message keys. Sentences are translated (§13). */
const KEYS: Record<WorkItemProblem, string> = {
  title_required: 'workItems.errors.titleRequired',
  unknown_state: 'workItems.errors.unknownState',
  unknown_neighbour: 'workItems.errors.unknownNeighbour',
  unknown_parent: 'workItems.errors.unknownParent',
  too_deep: 'workItems.errors.tooDeep',
  unknown_member: 'workItems.errors.unknownMember',
  unknown_label: 'workItems.errors.unknownLabel',
  blocked_reason_required: 'workItems.errors.blockedReasonRequired',
  not_found: 'workItems.errors.notFound',
  archived: 'projects.errors.archived',
  name_required: 'workItems.errors.titleRequired',
  slug_taken: 'projects.errors.slugTaken',
  invalid_slug: 'projects.errors.invalidSlug',
  key_taken: 'projects.errors.keyTaken',
  invalid_key: 'projects.errors.invalidKey',
  no_team: 'projects.errors.noTeam',
};

/**
 * The value refusals (§6-4). Every work-item and project problem is already in
 * `KEYS` — a value is written through the same guard an edit is — so this
 * spreads it and adds what only a custom field can say.
 */
const CUSTOM_FIELD_VALUE_KEYS: Record<CustomFieldProblem, string> = {
  ...KEYS,
  name_taken: 'customFields.errors.nameTaken',
  unknown_field: 'customFields.errors.unknownField',
  unknown_option: 'customFields.errors.unknownOption',
  unknown_kind: 'customFields.errors.unknownKind',
  too_many_fields: 'customFields.errors.tooManyFields',
  too_many_options: 'customFields.errors.tooManyOptions',
  needs_options: 'customFields.errors.needsOptions',
  field_has_values: 'customFields.errors.hasValues',
  option_in_use: 'customFields.errors.optionInUse',
  value_too_long: 'customFields.errors.tooLong',
  value_too_many: 'customFields.errors.tooMany',
  value_not_a_number: 'customFields.errors.notANumber',
  value_not_a_date: 'customFields.errors.notADate',
  value_not_an_option: 'customFields.errors.notAnOption',
  unknown_member: 'customFields.errors.unknownMember',
};

type Locale = 'en' | 'km';

type Context = {
  workspaceSlug: string;
  projectSlug: string;
  locale: Locale;
};

function localeOf(value: unknown): Locale {
  return value === 'km' ? 'km' : 'en';
}

function contextFrom(formData: FormData): Context & { projectId: string } {
  return {
    workspaceSlug: String(formData.get('workspaceSlug') ?? ''),
    projectSlug: String(formData.get('projectSlug') ?? ''),
    projectId: String(formData.get('projectId') ?? ''),
    locale: localeOf(formData.get('locale')),
  };
}

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) throw new Error('No such workspace, or you are not a member of it.');
  return resolved;
}

/**
 * The list and the item both change when an item does, and the list is grouped
 * by state — so a state change moves a row between two groups and the page has
 * to be rebuilt, not patched.
 */
function revalidateItem(context: Context, number?: number) {
  revalidatePath(`/${context.locale}/${context.workspaceSlug}/projects/${context.projectSlug}`);
  if (number !== undefined) {
    revalidatePath(
      `/${context.locale}/${context.workspaceSlug}/projects/${context.projectSlug}/${number}`,
    );
  }

  /**
   * Slice 13's two cross-project surfaces (§7.3, §7.4).
   *
   * They read the same rows this project's list does, so every mutation that
   * rebuilds one has to rebuild them too — and the failure mode without this is
   * the quiet kind: a state pill clicked on My Work advances the item, the
   * server records it, and the row stays in the same bucket until the next hard
   * navigation. That reads as a control that did not work.
   *
   * Both are unconditional rather than guarded on "was this item mine": a change
   * to somebody else's item moves §7.4's counts, and a mutation handler is the
   * wrong place to be deciding whose screens are interesting.
   */
  revalidatePath(`/${context.locale}/${context.workspaceSlug}`);
  revalidatePath(`/${context.locale}/${context.workspaceSlug}/team`);
}

/** Turns a thrown §10 refusal into the same shape a returned problem takes. */
async function guarded<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      // Two different sentences, because "you are in view-as" and "you are not a
      // member of this project" ask the person to do different things (§10).
      return {
        error:
          error.denial === 'read_only'
            ? 'workItems.errors.readOnly'
            : 'workItems.errors.forbidden',
      };
    }
    throw error;
  }
}

/**
 * §7.2: inline `+` at the bottom of a group → type a title → Enter. Created in
 * that group, with defaults, and the input stays focused for the next one.
 *
 * The state comes from the group the person typed into, which is §5's "state
 * defaults to the column you created in" — not from a form field they had to
 * think about.
 */
export async function createWorkItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(async () => {
    const stateId = String(formData.get('stateId') ?? '').trim();

    return createWorkItem(resolved, {
      projectId: context.projectId,
      title: String(formData.get('title') ?? ''),
      stateId: stateId || undefined,
    });
  });

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { fields: { title: KEYS[outcome.problem] } };

  revalidateItem(context);
  return {};
}

export async function setWorkItemStateAction(input: {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  workItemId: string;
  stateId: string;
}): Promise<RowActionState> {
  const context: Context = {
    workspaceSlug: input.workspaceSlug,
    projectSlug: input.projectSlug,
    locale: localeOf(input.locale),
  };
  const resolved = await actorFor(input.workspaceSlug);

  const outcome = await guarded(() =>
    setWorkItemState(resolved, { workItemId: input.workItemId, stateId: input.stateId }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context);
  return { done: true };
}

export async function updateWorkItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const optionalText = (name: string): string | null | undefined => {
    if (!formData.has(name)) return undefined;
    const value = String(formData.get(name) ?? '').trim();
    return value === '' ? null : value;
  };

  const estimateRaw = optionalText('estimate');
  const estimate =
    estimateRaw === undefined
      ? undefined
      : estimateRaw === null
        ? null
        : Number.isFinite(Number(estimateRaw))
          ? Math.max(0, Math.trunc(Number(estimateRaw)))
          : null;

  const outcome = await guarded(() =>
    updateWorkItem(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      title: formData.has('title') ? String(formData.get('title') ?? '') : undefined,
      description: optionalText('description'),
      priority: formData.has('priority') ? String(formData.get('priority') ?? '') : undefined,
      startDate: optionalText('startDate'),
      dueDate: optionalText('dueDate'),
      estimate,
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) {
    const key = KEYS[outcome.problem];
    return outcome.problem === 'title_required' ? { fields: { title: key } } : { error: key };
  }

  revalidateItem(context, Number(formData.get('number')));
  return {};
}

export async function setAssigneesAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    setWorkItemAssignees(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      // §4: assignment is multiple, so the form posts a set and the service
      // takes a set — never an add followed by a remove, which would leave a
      // window where the item is assigned to nobody.
      memberIds: formData.getAll('memberId').map(String).filter(Boolean),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

export async function setLabelsAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    setWorkItemLabels(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      labelIds: formData.getAll('labelId').map(String).filter(Boolean),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

/** §7.3: one click, and it notifies the project lead once slice 9 has an inbox. */
export async function setBlockedAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const blocked = formData.get('blocked') === '1';

  const outcome = await guarded(() =>
    setWorkItemBlocked(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      blocked,
      reason: String(formData.get('reason') ?? ''),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

export async function deleteWorkItemAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    deleteWorkItem(resolved, String(formData.get('workItemId') ?? '')),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: KEYS[outcome.problem] };

  revalidateItem(context);
  // Back to the list: the page the person was on no longer describes anything.
  redirect({
    href: `/${context.workspaceSlug}/projects/${context.projectSlug}`,
    locale: context.locale,
  });
}

/**
 * Comment problems to message keys, in their own map (§13).
 *
 * Separate from `KEYS` above because `CommentProblem` is its own union — a
 * shared map would have to widen to the union of both and would then accept a
 * work-item problem here, which is exactly the kind of mistake the identifiers
 * exist to prevent.
 */
const COMMENT_KEYS: Record<CommentProblem, string> = {
  not_found: 'workItems.errors.notFound',
  archived: 'projects.errors.archived',
  body_required: 'comments.errors.bodyRequired',
  body_too_long: 'comments.errors.bodyTooLong',
  mention_not_visible: 'comments.errors.mentionNotVisible',
};

/**
 * §7.7: post a comment.
 *
 * On failure this returns a key and nothing else — deliberately. The typed text
 * stays in the composer's own state, because a server action that handed the
 * draft back would lose it the moment the network was the thing that failed,
 * which is the case §7.7 is written about.
 */
export async function postCommentAction(
  _previous: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    postComment(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      body: String(formData.get('body') ?? ''),
      // The files the composer uploaded while this comment was being typed.
      // Ids only: the rows already exist and already belong to this member, so
      // there is nothing here to trust beyond "which of mine did you mean".
      attachmentIds: formData.getAll('attachmentId').map(String).filter(Boolean),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: COMMENT_KEYS[outcome.problem], names: outcome.names };

  revalidateItem(context, Number(formData.get('number')));
  // A timestamp rather than a boolean: two successful posts in a row must look
  // different to the composer, or the second one does not clear the box.
  return { postedAt: Date.now() };
}

/**
 * Delete a comment — the author retracting their own, or §10's Lead power over
 * somebody else's. The service decides which of the two is being asked for.
 */
export async function deleteCommentAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    deleteComment(resolved, { commentId: String(formData.get('commentId') ?? '') }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: COMMENT_KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}


/**
 * Attachment problems to message keys, in their own map (§13).
 *
 * A third map beside `KEYS` and `COMMENT_KEYS`, for the reason the second one
 * exists: each is exhaustive over its own problem union, and merging them would
 * produce a map that accepted a work-item problem where a file problem was
 * meant — which is the mistake the identifiers exist to prevent.
 */
const ATTACHMENT_KEYS: Record<AttachmentServiceProblem, string> = {
  not_found: 'workItems.errors.notFound',
  archived: 'projects.errors.archived',
  filename_required: 'attachments.errors.filenameRequired',
  file_empty: 'attachments.errors.fileEmpty',
  file_too_large: 'attachments.errors.fileTooLarge',
  file_type: 'attachments.errors.fileType',
};

/**
 * §2.4: the bytes have landed in the store, so the file becomes visible.
 *
 * The second half of an upload, and a server action rather than a route handler
 * because this one *is* a revalidation: the page has to re-render with the file
 * in it, which is exactly what a server action does and what the ticket
 * endpoint deliberately does not.
 */
export async function confirmAttachmentAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    confirmAttachment(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      attachmentIds: formData.getAll('attachmentId').map(String).filter(Boolean),
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: ATTACHMENT_KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

/**
 * Remove a file — the uploader retracting their own, or §10's Lead power over
 * somebody else's. The service decides which of the two is being asked for.
 */
export async function deleteAttachmentAction(
  _previous: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await guarded(() =>
    deleteAttachment(resolved, { attachmentId: String(formData.get('attachmentId') ?? '') }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) return { error: ATTACHMENT_KEYS[outcome.problem] };

  revalidateItem(context, Number(formData.get('number')));
  return { done: true };
}

/**
 * One item's custom fields, saved as a panel (§6-4, §7.11).
 *
 * The whole panel rather than a field at a time, for the reason the details
 * form saves title, dates and priority together: they are one thought and one
 * click, and §7.8 would otherwise turn one save into five notifications.
 *
 * The form names the fields it drew in `fieldId`, and each value arrives under
 * `cf:{fieldId}` — a prefix rather than a bare id so a field can never collide
 * with `workItemId`, `locale` or anything else the form carries. A field the
 * form did not draw is absent from the payload and the service leaves it alone,
 * which is what makes a stale tab widen nothing.
 *
 * `getAll` throughout, because a multi-select posts several values under one
 * name and every kind then arrives in one shape.
 */
export async function setCustomFieldsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const values: Record<string, string[]> = {};
  for (const fieldId of formData.getAll('fieldId')) {
    const id = String(fieldId);
    values[id] = formData.getAll(`cf:${id}`).map((value) => String(value));
  }

  const outcome = await guarded(() =>
    setWorkItemCustomFields(resolved, {
      workItemId: String(formData.get('workItemId') ?? ''),
      values,
    }),
  );

  if ('error' in outcome) return outcome;
  if (!outcome.ok) {
    const key = CUSTOM_FIELD_VALUE_KEYS[outcome.problem];
    // §11: the refusal lands on the control that caused it whenever the service
    // could say which one — a bad date belongs under the date, not in a banner
    // about the form.
    return outcome.fieldId ? { fields: { [`cf:${outcome.fieldId}`]: key } } : { error: key };
  }

  revalidateItem(context, Number(formData.get('number')));
  return {};
}

/* ------------------------------------------------------------------------- */
/* Saved views (§4, slice 12)                                                */
/* ------------------------------------------------------------------------- */

/**
 * The saved-view refusals. Identifiers in, message keys out (§13).
 *
 * There is no §10 entry among them, and that is not an omission: a saved view
 * is one person's bookmark of their own screen, so the service asks nothing of
 * the policy module and `guarded` has no `ForbiddenError` to catch here. The
 * only refusals are the shape of the name and how many views one person may
 * keep.
 */
const SAVED_VIEW_KEYS: Record<SavedViewFailure, string> = {
  name_required: 'savedViews.errors.nameRequired',
  name_too_long: 'savedViews.errors.nameTooLong',
  name_taken: 'savedViews.errors.nameTaken',
  query_too_long: 'savedViews.errors.queryTooLong',
  too_many: 'savedViews.errors.tooMany',
  not_found: 'savedViews.errors.notFound',
};

export async function createSavedViewAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = contextFrom(formData);
  const resolved = await actorFor(context.workspaceSlug);

  const outcome = await createSavedView(resolved, {
    name: String(formData.get('name') ?? ''),
    // The query string the bar was rendered with. Stored verbatim and re-parsed
    // on every read, so nothing here has to understand what a filter is.
    query: String(formData.get('query') ?? ''),
    projectId: context.projectId || null,
  });

  if (!outcome.ok) return { fields: { name: SAVED_VIEW_KEYS[outcome.problem] } };

  revalidateItem(context);
  return {};
}

/**
 * Points an existing view at the query now on screen, and/or renames it.
 *
 * One action for both, because the bar offers one control that does it — "update
 * this view to what I am looking at" — and splitting it would be two round
 * trips for one click.
 */
export async function updateSavedViewAction(input: {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  viewId: string;
  name?: string;
  query?: string;
}): Promise<RowActionState> {
  const context: Context = {
    workspaceSlug: input.workspaceSlug,
    projectSlug: input.projectSlug,
    locale: localeOf(input.locale),
  };
  const resolved = await actorFor(input.workspaceSlug);

  const outcome = await updateSavedView(resolved, {
    viewId: input.viewId,
    name: input.name,
    query: input.query,
  });

  if (!outcome.ok) return { error: SAVED_VIEW_KEYS[outcome.problem] };

  revalidateItem(context);
  return { done: true };
}

export async function deleteSavedViewAction(input: {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  viewId: string;
}): Promise<RowActionState> {
  const context: Context = {
    workspaceSlug: input.workspaceSlug,
    projectSlug: input.projectSlug,
    locale: localeOf(input.locale),
  };
  const resolved = await actorFor(input.workspaceSlug);

  const outcome = await deleteSavedView(resolved, input.viewId);
  if (!outcome.ok) return { error: SAVED_VIEW_KEYS[outcome.problem] };

  revalidateItem(context);
  return { done: true };
}

/**
 * §12's "column widths persisted per saved view".
 *
 * **It deliberately does not revalidate.** The width is already applied in the
 * browser — that is what a drag *is* — so rebuilding the route would re-render
 * the table underneath the pointer that is still on the column edge, to arrive
 * at the layout already on screen. What is being written matters on the *next*
 * load, and the next load fetches it.
 */
export async function saveTableLayoutAction(input: {
  workspaceSlug: string;
  viewId: string;
  layout: TableLayout;
}): Promise<RowActionState> {
  const resolved = await actorFor(input.workspaceSlug);

  const outcome = await saveTableLayout(resolved, {
    viewId: input.viewId,
    layout: input.layout,
  });

  if (!outcome.ok) return { error: SAVED_VIEW_KEYS[outcome.problem] };
  return { done: true };
}
