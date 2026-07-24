'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ColorPicker } from '@/components/ui/color-picker';
import { Avatar } from '@/components/ui/avatar';
import { PROJECT_COLORS, type Project } from '@/schemas/project';
import { useProjectMutations } from '@/hooks/use-projects';
import { useUsers } from '@/hooks/use-users';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';

const randomColor = () =>
  PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  open: boolean;
  onClose: () => void;
  project?: Project | null;
  memberEmails?: string[];
}

type Visibility = 'private' | 'internal' | 'public';

export function ProjectModal({
  open,
  onClose,
  project,
  memberEmails = [],
}: Props) {
  const { create, update } = useProjectMutations();
  const { data: users = [] } = useUsers();
  const { current: currentWorkspace, workspaces } = useCurrentWorkspace();

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [color, setColor] = useState<string>(randomColor());
  const [workspaceId, setWorkspaceId] = useState('');
  const [membersRaw, setMembersRaw] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    members?: string;
    workspace?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [suggOpen, setSuggOpen] = useState(false);
  const [suggFocus, setSuggFocus] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dropRect, setDropRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const computeDropRect = () => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (project) {
      setName(project.name);
      setDesc(project.desc ?? '');
      setVisibility(project.visibility);
      setColor(project.color);
      setMembersRaw(memberEmails.join(', '));
    } else {
      setName('');
      setDesc('');
      setVisibility('private');
      setColor(randomColor());
      setWorkspaceId(currentWorkspace?.id ?? '');
      setMembersRaw('');
    }
    setErrors({});
    setSuggOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?._id, currentWorkspace?.id]);

  // Derive suggestions from the partial text after the last comma
  const partialEmail = membersRaw.split(',').pop()?.trim() ?? '';
  const addedEmails = new Set(
    membersRaw
      .split(',')
      .slice(0, -1)
      .map((s) => s.trim().toLowerCase()),
  );

  const suggestions = users.filter((u) => {
    if (addedEmails.has(u.email.toLowerCase())) return false;
    if (!partialEmail) return true;
    const q = partialEmail.toLowerCase();
    return u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
  });

  const selectSuggestion = (email: string) => {
    const parts = membersRaw.split(',');
    parts[parts.length - 1] = ' ' + email;
    setMembersRaw(parts.join(',').replace(/^,\s*/, '') + ', ');
    setSuggOpen(false);
    setSuggFocus(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggOpen || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggFocus((f) => (f + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggFocus((f) => (f - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectSuggestion(suggestions[suggFocus].email);
    } else if (e.key === 'Escape') {
      setSuggOpen(false);
    }
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedName = name.trim();
    const next: typeof errors = {};
    if (!trimmedName) next.name = 'Project name is required';
    else if (trimmedName.length > 80) next.name = 'Max 80 characters';

    const emails = membersRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.some((s) => !EMAIL_RE.test(s)))
      next.members = 'One or more emails are invalid';

    // Creating without a workspace makes an orphan only its owner can see
    // (ADR 0006), so block it here rather than let it through silently.
    if (!project && !workspaceId && workspaces.length > 0)
      next.workspace = 'Pick a workspace';

    setErrors(next);
    if (Object.keys(next).length) return;

    const body = {
      name: trimmedName,
      desc: desc ?? '',
      visibility,
      color,
      memberEmails: emails,
    };

    setSubmitting(true);
    try {
      if (project) await update.mutateAsync({ id: project._id, body });
      else
        await create.mutateAsync({
          ...body,
          ...(workspaceId ? { workspaceId } : {}),
        });
      onClose();
    } catch {
      // Toast surfaced by the axios interceptor; keep the modal open so the user can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => onSubmit()}
            disabled={submitting}
          >
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <Field label="Name" required error={errors.name}>
          <Input
            placeholder="Awesome project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Description">
          <Textarea
            rows={3}
            placeholder="Short description"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </Field>

        {/* Create-only: the API's UpdateProjectSchema omits workspaceId, so
            re-homing a project is the instance admin's job, not an edit. */}
        {!project && workspaces.length > 0 && (
          <Field
            label="Workspace"
            required
            error={errors.workspace}
            hint="(who can see this project)"
          >
            <Select
              value={workspaceId}
              onValueChange={setWorkspaceId}
              options={workspaces.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
              placeholder="Select workspace…"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Visibility">
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as Visibility)}
              options={[
                { value: 'private', label: 'Private' },
                { value: 'internal', label: 'Internal' },
                { value: 'public', label: 'Public' },
              ]}
            />
          </Field>
          <Field label="Color">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
        </div>

        <Field
          label="Members"
          hint="(comma-separated emails)"
          error={errors.members}
        >
          <div ref={wrapRef}>
            <Input
              ref={inputRef}
              placeholder="alice@ex.com, bob@ex.com"
              value={membersRaw}
              onChange={(e) => {
                setMembersRaw(e.target.value);
                computeDropRect();
                setSuggOpen(true);
                setSuggFocus(0);
              }}
              onFocus={() => {
                if (blurTimer.current) clearTimeout(blurTimer.current);
                computeDropRect();
                setSuggOpen(true);
                setSuggFocus(0);
              }}
              onBlur={() => {
                blurTimer.current = setTimeout(() => setSuggOpen(false), 150);
              }}
              onKeyDown={handleKeyDown}
            />
            {suggOpen && suggestions.length > 0 && dropRect &&
              createPortal(
              <ul
                style={{ position: 'fixed', top: dropRect.top, left: dropRect.left, width: dropRect.width }}
                className="z-[9999] bg-bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto py-1">
                {suggestions.map((u, i) => (
                  <li key={u._id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(u.email);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-[var(--dur)] ${
                        i === suggFocus ? 'bg-bg-hover' : 'hover:bg-bg-hover'
                      }`}
                    >
                      <Avatar name={u.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{u.name}</div>
                        <div className="text-[11px] text-text-muted truncate">{u.email}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>,
              document.body,
            )}
          </div>
        </Field>
      </form>
    </Modal>
  );
}
