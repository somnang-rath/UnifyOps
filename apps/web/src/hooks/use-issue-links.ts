'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';

/** A trimmed issue card, as returned by the children/relations endpoints. */
export interface LinkedIssue {
  _id: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  assigneeId?: string | null;
  projectId?: string | null;
}

export interface ChildrenResponse {
  items: LinkedIssue[];
  rollup: { done: number; total: number };
}

/** Relation kinds as seen from the current issue (inverse already applied). */
export type RelationKind =
  | 'blocks'
  | 'blocked_by'
  | 'relates_to'
  | 'duplicate';

export type RelationsResponse = Partial<
  Record<RelationKind, { relationId: string; issue: LinkedIssue }[]>
>;

/** Only these three can be *created*; `blocked_by` is the stored inverse of `blocks`. */
export type CreatableRelation = 'blocks' | 'relates_to' | 'duplicate';

const linksService = {
  children: (id: string) =>
    api.get<ChildrenResponse>(`/issues/${id}/children`).then((r) => r.data),
  relations: (id: string) =>
    api.get<RelationsResponse>(`/issues/${id}/relations`).then((r) => r.data),
  addRelation: (id: string, targetId: string, type: CreatableRelation) =>
    api
      .post(`/issues/${id}/relations`, { targetId, type })
      .then((r) => r.data),
  removeRelation: (relationId: string) =>
    api.delete(`/issues/relations/${relationId}`).then((r) => r.data),
};

export const useIssueChildren = (id: string | undefined) =>
  useQuery({
    queryKey: ['issue-children', id],
    queryFn: () => linksService.children(id!),
    enabled: !!id,
  });

export const useIssueRelations = (id: string | undefined) =>
  useQuery({
    queryKey: ['issue-relations', id],
    queryFn: () => linksService.relations(id!),
    enabled: !!id,
  });

export function useRelationMutations(issueId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['issue-relations', issueId] });

  const add = useMutation({
    mutationFn: ({
      targetId,
      type,
    }: {
      targetId: string;
      type: CreatableRelation;
    }) => linksService.addRelation(issueId, targetId, type),
    onSuccess: invalidate,
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast(e.response?.data?.message ?? 'Could not add relation', 'error'),
  });

  const remove = useMutation({
    mutationFn: (relationId: string) => linksService.removeRelation(relationId),
    onSuccess: invalidate,
  });

  return { add, remove };
}
