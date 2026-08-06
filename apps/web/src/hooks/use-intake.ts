'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';

export type IntakeStatus = 'pending' | 'accepted' | 'declined';

export interface IntakeForm {
  _id: string;
  projectId: string;
  workspaceId: string;
  createdBy: string;
  title: string;
  description: string;
  /** Public slug. `null` ⇒ the form exists but is not reachable from outside. */
  anchor: string | null;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the assistant *proposes* for a submission (ADR 0015 §2.5). Every field
 * is a default for the accept form, never an action: nothing here reaches an
 * issue until a real user accepts.
 */
export interface IntakeSuggestion {
  priority: string | null;
  labels: string[];
  assigneeId: string | null;
  reasoning: string;
  generatedAt: string;
}

export interface IntakeSubmission {
  _id: string;
  formId: string;
  title: string;
  description: string;
  submitterEmail: string | null;
  status: IntakeStatus;
  issueId: string | null;
  triagedBy: string | null;
  suggestion: IntakeSuggestion | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveIntakeFormBody {
  title: string;
  description?: string;
  /** Sending `null` on update unpublishes; omitting it leaves the anchor alone. */
  anchor?: string | null;
  isOpen?: boolean;
}

/** Anything omitted falls back to the stored suggestion, server-side. */
export interface TriageBody {
  action: 'accept' | 'decline';
  priority?: string;
  labels?: string[];
  assigneeId?: string | null;
}

const intakeService = {
  forms: (projectId: string) =>
    api
      .get<IntakeForm[]>('/intake/forms', { params: { projectId } })
      .then((r) => r.data),
  createForm: (b: SaveIntakeFormBody & { projectId: string }) =>
    api.post<IntakeForm>('/intake/forms', b).then((r) => r.data),
  updateForm: (id: string, b: Partial<SaveIntakeFormBody>) =>
    api.patch<IntakeForm>(`/intake/forms/${id}`, b).then((r) => r.data),
  submissions: (formId: string) =>
    api
      .get<IntakeSubmission[]>(`/intake/forms/${formId}/submissions`)
      .then((r) => r.data),
  triage: (id: string, b: TriageBody) =>
    api
      .post<{ status: IntakeStatus; issueId?: string }>(
        `/intake/submissions/${id}/triage`,
        b,
      )
      .then((r) => r.data),
  suggest: (id: string) =>
    api
      .post<IntakeSuggestion>(`/intake/submissions/${id}/suggest`)
      .then((r) => r.data),
};

const msg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data
    ?.message ?? fallback;

/**
 * The API lists forms one project at a time (it gates on project write), so the
 * queue screen picks a project first rather than fanning out over a workspace.
 */
export const useIntakeForms = (projectId: string | null) =>
  useQuery({
    queryKey: ['intake', 'forms', projectId],
    queryFn: () => intakeService.forms(projectId!),
    enabled: !!projectId,
  });

export const useIntakeSubmissions = (formId: string | null) =>
  useQuery({
    queryKey: ['intake', 'submissions', formId],
    queryFn: () => intakeService.submissions(formId!),
    enabled: !!formId,
  });

export function useIntakeMutations(projectId: string | null) {
  const qc = useQueryClient();
  const invalidateForms = () =>
    qc.invalidateQueries({ queryKey: ['intake', 'forms', projectId] });
  const invalidateSubs = (formId: string) =>
    qc.invalidateQueries({ queryKey: ['intake', 'submissions', formId] });

  const createForm = useMutation({
    // The create and update schemas disagree about `anchor`, deliberately:
    // update takes `null` to mean "unpublish", create takes it as *optional*
    // and rejects an explicit null. The form produces one shape for both, so
    // the null is dropped here rather than in every caller.
    mutationFn: ({ anchor, ...rest }: SaveIntakeFormBody) =>
      intakeService.createForm({
        ...rest,
        ...(anchor ? { anchor } : {}),
        projectId: projectId!,
      }),
    onSuccess: () => {
      invalidateForms();
      toast('Intake form created', 'success');
    },
    onError: (e) => toast(msg(e, 'Could not create the form'), 'error'),
  });

  const updateForm = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<SaveIntakeFormBody>;
    }) => intakeService.updateForm(id, body),
    onSuccess: () => {
      invalidateForms();
      toast('Form updated', 'success');
    },
    onError: (e) => toast(msg(e, 'Could not update the form'), 'error'),
  });

  const triage = useMutation({
    mutationFn: ({
      id,
      formId: _formId,
      body,
    }: {
      id: string;
      formId: string;
      body: TriageBody;
    }) => intakeService.triage(id, body),
    onSuccess: (r, vars) => {
      invalidateSubs(vars.formId);
      // Accepting spawns a real work item, so the issue lists are stale too.
      if (r.issueId) qc.invalidateQueries({ queryKey: ['issues'] });
      toast(
        r.status === 'accepted' ? 'Accepted — work item created' : 'Declined',
        r.status === 'accepted' ? 'success' : 'info',
      );
    },
    onError: (e) => toast(msg(e, 'Could not triage this request'), 'error'),
  });

  const suggest = useMutation({
    mutationFn: ({ id, formId: _formId }: { id: string; formId: string }) =>
      intakeService.suggest(id),
    onSuccess: (_r, vars) => {
      invalidateSubs(vars.formId);
      toast('Suggestion refreshed', 'success');
    },
    // The API answers 400 with a readable reason when no key is configured —
    // surface it verbatim rather than a generic failure.
    onError: (e) =>
      toast(msg(e, 'Could not generate a suggestion'), 'error'),
  });

  return { createForm, updateForm, triage, suggest };
}
