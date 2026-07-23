'use client';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { IssueTemplate } from '@prism/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TodoChecklist } from '@/components/feature/issue/todo-checklist';
import { useIssueMutations } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useTemplates } from '@/hooks/use-templates';
import { useUsers } from '@/hooks/use-users';
import { useBoard } from '@/hooks/use-kanban';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  IssueFormSchema,
  type IssueFormInput,
  type Issue,
  type IssueTodo,
} from '@/schemas/issue';

interface Props {
  open: boolean;
  onClose: () => void;
  issue?: Issue | null;
  defaultStatus?: string;
  defaultProjectId?: string;
  defaultAssigneeId?: string;
  statusOptions?: { value: string; label: string }[];
}

const labelize = (s: string) => s[0].toUpperCase() + s.slice(1);

export function IssueModal({
  open,
  onClose,
  issue,
  defaultStatus = 'todo',
  defaultProjectId = '',
  defaultAssigneeId = '',
  statusOptions,
}: Props) {
  const { create, update } = useIssueMutations();
  const { data: projects = [] } = useProjects();
  const { data: users = [] } = useUsers();
  const { data: board } = useBoard();

  const [todos, setTodos] = useState<IssueTodo[]>([]);

  const form = useForm<IssueFormInput>({
    resolver: zodResolver(IssueFormSchema),
    defaultValues: {
      title: '',
      desc: '',
      type: 'task',
      priority: 'medium',
      status: defaultStatus,
      projectId: defaultProjectId,
      assigneeId: defaultAssigneeId,
      dueDate: '',
      labelsRaw: '',
    },
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setFocus,
    formState: { errors, isSubmitting, dirtyFields },
  } = form;

  const isCreate = !(issue && issue._id);

  // ── "Use template" picker (templates-csv-import spec §3) — create only.
  // Re-queries when the Project select changes; the API needs the project's
  // workspaceId too (member gate), derived from the loaded project list.
  const watchedProjectId = watch('projectId') ?? '';
  const watchedWorkspaceId =
    projects.find((p) => p._id === watchedProjectId)?.workspaceId ?? undefined;
  const { data: templates = [] } = useTemplates({
    projectId: isCreate && watchedProjectId ? watchedProjectId : undefined,
    workspaceId:
      isCreate && watchedProjectId ? watchedWorkspaceId : undefined,
  });
  const [templateSel, setTemplateSel] = useState('');
  const [pendingTemplate, setPendingTemplate] = useState<IssueTemplate | null>(
    null,
  );
  const [liveMessage, setLiveMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    const editing = issue && issue._id;
    reset(
      editing
        ? {
            title: issue!.title,
            desc: issue!.desc,
            type: issue!.type,
            priority: issue!.priority,
            status: issue!.status,
            projectId: issue!.projectId ?? '',
            assigneeId: issue!.assigneeId ?? '',
            dueDate: issue!.dueDate
              ? issue!.dueDate.slice(0, 10)
              : '',
            labelsRaw: (issue!.labels ?? []).join(', '),
          }
        : {
            title: '',
            desc: '',
            type: 'task',
            priority: 'medium',
            status: defaultStatus,
            projectId: defaultProjectId,
            assigneeId: defaultAssigneeId,
            dueDate: issue?.dueDate ? issue.dueDate.slice(0, 10) : '',
            labelsRaw: '',
          },
    );
    setTodos(issue?.todos ?? []);
    setTemplateSel('');
    setPendingTemplate(null);
    setLiveMessage('');
  }, [open, issue, defaultStatus, defaultProjectId, defaultAssigneeId, reset]);

  // Fill defaults-owned fields only (desc, type, priority, labels, todos) via
  // setValue — never reset(), so title/status/project/assignee/dueDate
  // survive. Templates are a client-side pre-fill: the create payload carries
  // no templateId.
  const applyTemplate = (t: IssueTemplate) => {
    const d = t.defaults ?? {};
    setTemplateSel(t._id);
    setValue('desc', d.desc ?? '', { shouldDirty: true });
    if (d.type)
      setValue('type', d.type as IssueFormInput['type'], {
        shouldDirty: true,
      });
    if (d.priority)
      setValue('priority', d.priority as IssueFormInput['priority'], {
        shouldDirty: true,
      });
    setValue('labelsRaw', (d.labels ?? []).join(', '), { shouldDirty: true });
    setTodos(
      // Cloned with fresh ids, done: false (spec §3.2).
      (d.todos ?? []).map((td) => ({
        id: Math.random().toString(36).slice(2),
        text: td.text,
        done: false,
      })),
    );
    setLiveMessage('Template applied');
    // Focus the next thing the user must type (spec §3.3).
    setFocus('title');
  };

  const pickTemplate = (id: string) => {
    if (!id) return; // '' is a placeholder, not an "undo"
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    // Applying overwrites defaults-owned fields — confirm only when one of
    // them is already non-empty/dirty; a clean form applies instantly.
    const dirty =
      !!(watch('desc') ?? '').trim() ||
      !!(watch('labelsRaw') ?? '').trim() ||
      todos.length > 0 ||
      !!dirtyFields.type ||
      !!dirtyFields.priority;
    if (dirty) setPendingTemplate(t);
    else applyTemplate(t);
  };

  const templateOptions = useMemo(() => {
    // Project templates first, workspace ones suffixed (spec §3.1).
    const project = templates.filter((t) => t.projectId !== null);
    const ws = templates.filter((t) => t.projectId === null);
    return [
      { value: '', label: 'Start from a template…' },
      ...project.map((t) => ({ value: t._id, label: t.name })),
      ...ws.map((t) => ({ value: t._id, label: `${t.name} · workspace` })),
    ];
  }, [templates]);

  const projectOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...projects.map((p) => ({ value: p._id, label: p.name })),
    ],
    [projects],
  );

  const assigneeOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...users
        .filter((u): u is typeof u & { _id: string } => !!u._id)
        .map((u) => ({ value: u._id, label: u.name })),
    ],
    [users],
  );

  // Derive status options from the user's Kanban board when no override is
  // provided. This ensures issues created from Kanban (which use column IDs
  // like 'design', 'ready', 'discovery' as status values) are shown with
  // their proper column name rather than falling back to "Select…".
  const resolvedStatusOptions = useMemo(() => {
    if (statusOptions) return statusOptions;
    const cols = board?.columns;
    const base: { value: string; label: string }[] = cols?.length
      ? cols.map((c) => ({ value: c.id, label: c.name }))
      : ISSUE_STATUSES.map((s) => ({ value: s, label: labelize(s) }));
    // Always include the current status if it isn't already in the list
    // (e.g. a user-created custom column that was later deleted).
    const currentStatus = issue?.status;
    if (currentStatus && !base.some((o) => o.value === currentStatus)) {
      base.push({ value: currentStatus, label: labelize(currentStatus) });
    }
    return base;
  }, [statusOptions, board, issue?.status]);

  const onSubmit = handleSubmit(async (v) => {
    const body = {
      title: v.title,
      desc: v.desc ?? '',
      type: v.type,
      status: v.status,
      priority: v.priority,
      projectId: v.projectId || null,
      assigneeId: v.assigneeId || null,
      dueDate: v.dueDate || null,
      labels: (v.labelsRaw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      todos,
    };
    try {
      if (issue && issue._id)
        await update.mutateAsync({ id: issue._id, body });
      else await create.mutateAsync(body);
      onClose();
    } catch {
      // The axios interceptor surfaces the error as a toast (e.g. a 403 when
      // writing to a project you can read but aren't a member of — ADR 0005).
      // Keep the modal open so the user can retry or pick a different project.
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={issue && issue._id ? 'Edit task' : 'New task'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            {issue && issue._id ? 'Save changes' : 'Create issue'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        {/* Polite announcements ("Template applied") for screen readers. */}
        <span aria-live="polite" className="sr-only">
          {liveMessage}
        </span>

        {isCreate && watchedProjectId && templates.length > 0 && (
          <div className="flex justify-end">
            <Select
              inline
              size="sm"
              value={templateSel}
              onValueChange={pickTemplate}
              options={templateOptions}
              aria-label="Start from a template"
            />
          </div>
        )}

        <Field label="Title" required error={errors.title?.message}>
          <Input
            placeholder="Short summary"
            autoFocus
            {...register('title')}
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={5}
            placeholder="Add more context…"
            {...register('desc')}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <Select
              value={watch('type')}
              onValueChange={(v) =>
                setValue('type', v as any, { shouldDirty: true })
              }
              options={ISSUE_TYPES.map((t) => ({
                value: t,
                label: labelize(t),
              }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={watch('priority')}
              onValueChange={(v) =>
                setValue('priority', v as any, { shouldDirty: true })
              }
              options={ISSUE_PRIORITIES.map((p) => ({
                value: p,
                label: labelize(p),
              }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={watch('status')}
              onValueChange={(v) =>
                setValue('status', v, { shouldDirty: true })
              }
              options={resolvedStatusOptions}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project">
            <Select
              value={watch('projectId') ?? ''}
              onValueChange={(v) =>
                setValue('projectId', v, { shouldDirty: true })
              }
              options={projectOptions}
            />
          </Field>
          <Field label="Assignee">
            <Select
              value={watch('assigneeId') ?? ''}
              onValueChange={(v) =>
                setValue('assigneeId', v, { shouldDirty: true })
              }
              options={assigneeOptions}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <Input type="date" {...register('dueDate')} />
          </Field>
          <Field label="Labels" hint="(comma-separated)">
            <Input
              placeholder="frontend, urgent"
              {...register('labelsRaw')}
            />
          </Field>
        </div>

        {/* Checklist (shared block — also used by the template modal) */}
        <TodoChecklist todos={todos} onChange={setTodos} />
      </form>

      <Confirm
        open={!!pendingTemplate}
        title="Apply template"
        body="Replace the description, priority, labels and checklist with this template's defaults?"
        onConfirm={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate);
        }}
        onClose={() => setPendingTemplate(null)}
      />
    </Modal>
  );
}
