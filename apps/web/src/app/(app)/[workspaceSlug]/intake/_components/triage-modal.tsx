'use client';
import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Field, Input } from '@prism/ui';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ISSUE_PRIORITIES } from '@/schemas/issue';
import type { IntakeSubmission, TriageBody } from '@/hooks/use-intake';

export interface Assignable {
  id: string;
  name: string;
}

const parseLabels = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);

/**
 * "Accept with edits" (ADR 0015 §2.5).
 *
 * Every control starts on the assistant's proposal, so the common case is to
 * open and confirm. What is sent is only what the triager can see here — the
 * API falls back to the stored suggestion field by field, but pre-filling the
 * form means the person accepting is never agreeing to something off-screen.
 */
export function TriageModal({
  open,
  submission,
  assignables,
  saving,
  onClose,
  onAccept,
}: {
  open: boolean;
  submission: IntakeSubmission | null;
  assignables: Assignable[];
  saving: boolean;
  onClose: () => void;
  onAccept: (body: TriageBody) => void;
}) {
  const [priority, setPriority] = useState('medium');
  const [labels, setLabels] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  useEffect(() => {
    if (!open || !submission) return;
    const s = submission.suggestion;
    setPriority(
      s?.priority && (ISSUE_PRIORITIES as readonly string[]).includes(s.priority)
        ? s.priority
        : 'medium',
    );
    // `intake` is added by the API on every accepted submission — showing it
    // here would invite someone to delete a label they cannot remove.
    setLabels((s?.labels ?? []).filter((l) => l !== 'intake').join(', '));
    // An assignee the model proposed who has since left the project would be
    // an id with no row in the picker; drop it rather than render a blank.
    setAssigneeId(
      s?.assigneeId && assignables.some((a) => a.id === s.assigneeId)
        ? s.assigneeId
        : '',
    );
  }, [open, submission, assignables]);

  const assigneeOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...assignables.map((a) => ({ value: a.id, label: a.name })),
    ],
    [assignables],
  );

  if (!submission) return null;

  const accept = () =>
    onAccept({
      action: 'accept',
      priority,
      labels: parseLabels(labels),
      // Explicit null is "no assignee", and beats the stored suggestion —
      // omitting it would let the model's pick win over a deliberate clear.
      assigneeId: assigneeId || null,
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Accept request"
      description={submission.title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={accept}
            disabled={saving}
          >
            {saving ? 'Creating…' : 'Create work item'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {submission.suggestion?.reasoning && (
          <p className="flex gap-1.5 items-start text-[12px] text-text-muted bg-bg-subtle border border-border rounded-lg px-2.5 py-2">
            <Sparkles
              className="w-3.5 h-3.5 mt-px shrink-0 text-accent"
              aria-hidden="true"
            />
            <span>{submission.suggestion.reasoning}</span>
          </p>
        )}

        <Field label="Priority">
          <Select
            value={priority}
            onValueChange={setPriority}
            options={ISSUE_PRIORITIES.map((p) => ({
              value: p,
              label: p.charAt(0).toUpperCase() + p.slice(1),
            }))}
            aria-label="Priority"
          />
        </Field>

        <Field
          label="Labels"
          hint="comma separated · “intake” is always added"
        >
          <Input
            value={labels}
            placeholder="bug, mobile"
            onChange={(e) => setLabels(e.target.value)}
          />
        </Field>

        <Field label="Assignee">
          <Select
            value={assigneeId}
            onValueChange={setAssigneeId}
            options={assigneeOptions}
            aria-label="Assignee"
          />
        </Field>
      </div>
    </Modal>
  );
}
