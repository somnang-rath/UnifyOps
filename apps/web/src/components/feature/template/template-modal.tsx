'use client';
import { useEffect, useState } from 'react';
import type { IssueTemplate } from '@prism/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TodoChecklist } from '@/components/feature/issue/todo-checklist';
import { useTemplateMutations } from '@/hooks/use-templates';
import { ISSUE_PRIORITIES, ISSUE_TYPES, type IssueTodo } from '@/schemas/issue';

const labelize = (s: string) => s[0].toUpperCase() + s.slice(1);

export interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  /** Present ⇒ edit mode. */
  template?: IssueTemplate | null;
  /** The settings page's project. */
  projectId: string;
  workspaceId: string;
  /** Whether the current user may create workspace-scoped templates. */
  canScopeWorkspace: boolean;
}

type Scope = 'project' | 'workspace';

/**
 * Create/edit an issue template (templates-csv-import spec §2.2). Scope is
 * create-only: moving a template between scopes changes who sees it — out of
 * v1, so edit mode locks the Select with a hint.
 */
export function TemplateModal({
  open,
  onClose,
  template,
  projectId,
  workspaceId,
  canScopeWorkspace,
}: TemplateModalProps) {
  const { create, update } = useTemplateMutations();
  const editing = !!template;

  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('project');
  const [type, setType] = useState('task');
  const [priority, setPriority] = useState('medium');
  const [desc, setDesc] = useState('');
  const [labelsRaw, setLabelsRaw] = useState('');
  const [todos, setTodos] = useState<IssueTodo[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setScope(template ? (template.projectId === null ? 'workspace' : 'project') : 'project');
    setType(template?.defaults.type ?? 'task');
    setPriority(template?.defaults.priority ?? 'medium');
    setDesc(template?.defaults.desc ?? '');
    setLabelsRaw((template?.defaults.labels ?? []).join(', '));
    setTodos(
      // Stored template todos carry no id — mint one for list keys/toggles.
      (template?.defaults.todos ?? []).map((t) => ({
        id: t.id ?? Math.random().toString(36).slice(2),
        text: t.text,
        done: false,
      })),
    );
  }, [open, template]);

  const pending = create.isPending || update.isPending;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    const defaults = {
      desc,
      type,
      priority,
      labels: labelsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      // Templates define items, not completion — done is always false. The
      // API stores { text, done } only; ids are minted on apply.
      todos: todos.map((t) => ({ text: t.text, done: false })),
    };
    if (editing && template) {
      update.mutate(
        { id: template._id, body: { name: trimmed, defaults } },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        {
          name: trimmed,
          projectId: scope === 'project' ? projectId : null,
          workspaceId,
          defaults,
        },
        { onSuccess: onClose },
      );
    }
  };

  const scopeOptions = [
    { value: 'project', label: 'This project' },
    // Option hidden when the user may not create workspace-scoped templates —
    // except in edit mode, where the locked Select must display the scope.
    ...(canScopeWorkspace || (editing && scope === 'workspace')
      ? [{ value: 'workspace', label: 'Whole workspace' }]
      : []),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit template' : 'New template'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={pending || !name.trim()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Template name" required>
          <Input
            autoFocus
            placeholder="e.g. Bug report"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label="Scope"
          hint={editing ? "Scope can't change after creation" : undefined}
        >
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
            options={scopeOptions}
            disabled={editing}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select
              value={type}
              onValueChange={setType}
              options={ISSUE_TYPES.map((t) => ({
                value: t,
                label: labelize(t),
              }))}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={priority}
              onValueChange={setPriority}
              options={ISSUE_PRIORITIES.map((p) => ({
                value: p,
                label: labelize(p),
              }))}
            />
          </Field>
        </div>

        <Field label="Description">
          <Textarea
            rows={4}
            placeholder="Pre-filled description…"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </Field>

        <Field label="Labels" hint="(comma-separated)">
          <Input
            placeholder="frontend, urgent"
            value={labelsRaw}
            onChange={(e) => setLabelsRaw(e.target.value)}
          />
        </Field>

        {/* Templates define items, not completion — progress hidden. */}
        <TodoChecklist todos={todos} onChange={setTodos} showProgress={false} />
      </div>
    </Modal>
  );
}
