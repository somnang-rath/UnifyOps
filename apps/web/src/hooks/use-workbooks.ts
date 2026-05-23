'use client';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type {
  NamedRange,
  Sheet,
  Workbook,
  WorkbookGrant,
  WorkbookGrantLevel,
  WorkbookGrantRole,
  WorkbookSummary,
} from '@/schemas/workbook';

interface ShareTargetUser {
  userId: string;
  level: WorkbookGrantLevel;
}
interface ShareTargetRole {
  role: WorkbookGrantRole;
  level: WorkbookGrantLevel;
}
type ShareBody = ShareTargetUser | ShareTargetRole;

interface CreateBody {
  name: string;
}
interface UpdateBody {
  name?: string;
  sheets?: Sheet[];
  activeSheetId?: string;
  namedRanges?: NamedRange[];
  version?: number;
}

const wbService = {
  list: () => api.get<WorkbookSummary[]>('/workbooks').then((r) => r.data),
  byId: (id: string) =>
    api.get<Workbook>(`/workbooks/${id}`).then((r) => r.data),
  create: (b: CreateBody) =>
    api.post<Workbook>('/workbooks', b).then((r) => r.data),
  update: (id: string, b: UpdateBody) =>
    api.patch<Workbook>(`/workbooks/${id}`, b).then((r) => r.data),
  remove: (id: string) => api.delete(`/workbooks/${id}`).then((r) => r.data),
  copy: (id: string) =>
    api.post<Workbook>(`/workbooks/${id}/copy`).then((r) => r.data),

  listGrants: (id: string) =>
    api.get<WorkbookGrant[]>(`/workbooks/${id}/grants`).then((r) => r.data),
  setGrant: (id: string, body: ShareBody) =>
    api
      .put<WorkbookGrant[]>(`/workbooks/${id}/grants`, body)
      .then((r) => r.data),
  /** target is a user ObjectId or a role string. */
  removeGrant: (id: string, target: string) =>
    api
      .delete<WorkbookGrant[]>(`/workbooks/${id}/grants/${target}`)
      .then((r) => r.data),
};

export const useWorkbooks = () =>
  useQuery({ queryKey: ['workbooks'], queryFn: wbService.list });

export const useWorkbook = (id: string | null) =>
  useQuery({
    queryKey: ['workbooks', 'byId', id],
    queryFn: () => wbService.byId(id!),
    enabled: !!id,
  });

export const useWorkbookGrants = (id: string | null) =>
  useQuery({
    queryKey: ['workbooks', 'grants', id],
    queryFn: () => wbService.listGrants(id!),
    enabled: !!id,
  });

export function useWorkbookMutations() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: wbService.create,
      onSuccess: (wb) => {
        toast('Spreadsheet created', 'success');
        qc.invalidateQueries({ queryKey: ['workbooks'] });
        qc.setQueryData(['workbooks', 'byId', wb._id], wb);
      },
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateBody }) =>
        wbService.update(id, body),
      onSuccess: (wb) => {
        qc.setQueryData(['workbooks', 'byId', wb._id], wb);
        qc.invalidateQueries({ queryKey: ['workbooks'], exact: true });
      },
    }),
    remove: useMutation({
      mutationFn: wbService.remove,
      onSuccess: () => {
        toast('Spreadsheet deleted', 'success');
        qc.invalidateQueries({ queryKey: ['workbooks'] });
      },
    }),
    copy: useMutation({
      mutationFn: wbService.copy,
      onSuccess: (wb) => {
        toast('Copy created', 'success');
        qc.invalidateQueries({ queryKey: ['workbooks'] });
        qc.setQueryData(['workbooks', 'byId', wb._id], wb);
      },
    }),
    setGrant: useMutation({
      mutationFn: ({
        id,
        ...body
      }: { id: string } & ShareBody) => wbService.setGrant(id, body),
      onSuccess: (grants, vars) => {
        qc.setQueryData(['workbooks', 'grants', vars.id], grants);
        qc.invalidateQueries({ queryKey: ['workbooks'], exact: true });
        toast('Sharing updated', 'success');
      },
    }),
    removeGrant: useMutation({
      mutationFn: ({ id, target }: { id: string; target: string }) =>
        wbService.removeGrant(id, target),
      onSuccess: (grants, vars) => {
        qc.setQueryData(['workbooks', 'grants', vars.id], grants);
        qc.invalidateQueries({ queryKey: ['workbooks'], exact: true });
        toast('Access removed', 'success');
      },
    }),
  };
}
