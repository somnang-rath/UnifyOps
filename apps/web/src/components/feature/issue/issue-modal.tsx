'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useIssueMutations } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
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
  const [newTodoText, setNewTodoText] = useState('');
  const newTodoRef = useRef<HTMLInputElement>(null);

  const doneTodos = todos.filter((t) => t.done).length;
  const progress = todos.length > 0 ? Math.round((doneTodos / todos.length) * 100) : 0;

  const addTodo = () => {
    const text = newTodoText.trim();
    if (!text) return;
    setTodos((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), text, done: false },
    ]);
    setNewTodoText('');
    newTodoRef.current?.focus();
  };

  const toggleTodo = (id: string) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const removeTodo = (id: string) =>
    setTodos((prev) => prev.filter((t) => t.id !== id));

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
    formState: { errors, isSubmitting },
  } = form;

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
    setNewTodoText('');
  }, [open, issue, defaultStatus, defaultProjectId, defaultAssigneeId, reset]);

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

        {/* Checklist */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[--text]">Checklist</span>
            {todos.length > 0 && (
              <span className="text-xs text-[--text-muted]">
                {doneTodos}/{todos.length} &mdash; {progress}%
              </span>
            )}
          </div>

          {todos.length > 0 && (
            <div className="w-full h-1.5 rounded-full bg-[--bg-subtle] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, backgroundColor: 'var(--a)' }}
              />
            </div>
          )}

          {todos.length > 0 && (
            <div className="flex flex-col gap-1">
              {todos.map((todo) => (
                <div key={todo.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[--bg-hover]">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => toggleTodo(todo.id)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-[--a]"
                  />
                  <span
                    className={`flex-1 text-sm ${todo.done ? 'line-through text-[--text-muted]' : 'text-[--text]'}`}
                  >
                    {todo.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTodo(todo.id)}
                    className="opacity-0 group-hover:opacity-100 text-[--text-muted] hover:text-red-500 transition-opacity text-base leading-none"
                    aria-label="Remove task"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={newTodoRef}
              type="text"
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTodo(); } }}
              placeholder="Add a task…"
              className="flex-1 rounded-md border border-[--border] bg-[--bg-input] px-3 py-1.5 text-sm text-[--text] placeholder:text-[--text-muted] outline-none focus:border-[--a] transition-colors"
            />
            <Button type="button" variant="outline" onClick={addTodo} className="shrink-0">
              Add
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
