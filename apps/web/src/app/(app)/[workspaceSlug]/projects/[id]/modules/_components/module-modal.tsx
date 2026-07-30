'use client';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  MODULE_STATUSES,
  type FeatureModule,
  type ModuleStatus,
  type SaveModuleBody,
} from '@/hooks/use-modules';

/** See the note in cycle-modal: slice, never re-serialise through UTC. */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

const STATUS_LABEL: Record<ModuleStatus, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** `''` is the sentinel for "no lead" — Select has no null value. */
const NO_LEAD = '';

interface Props {
  open: boolean;
  module?: FeatureModule | null;
  /** Project members, offered as the lead. */
  members: { _id: string; name: string }[];
  saving: boolean;
  onSave: (body: SaveModuleBody) => void;
  onClose: () => void;
}

export function ModuleModal({
  open,
  module,
  members,
  saving,
  onSave,
  onClose,
}: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ModuleStatus>('backlog');
  const [leadId, setLeadId] = useState<string>(NO_LEAD);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed on open so reopening after a cancel doesn't show the last edit.
  useEffect(() => {
    if (!open) return;
    setName(module?.name ?? '');
    setDescription(module?.description ?? '');
    setStatus(module?.status ?? 'backlog');
    setLeadId(module?.leadId ?? NO_LEAD);
    setStartDate(toDateInput(module?.startDate ?? null));
    setTargetDate(toDateInput(module?.targetDate ?? null));
    setError(null);
  }, [open, module]);

  const submit = () => {
    if (!name.trim()) return setError('Give the module a name');
    // Unlike a cycle, either date may stand alone — only the ordering matters.
    if (startDate && targetDate && startDate > targetDate) {
      return setError('The target date must be on or after the start date');
    }
    setError(null);
    onSave({
      name: name.trim(),
      description: description.trim(),
      status,
      leadId: leadId || null,
      startDate: startDate || null,
      targetDate: targetDate || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={module ? 'Edit module' : 'New module'}
      description="Group the work items that build one feature or goal."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : module ? 'Save changes' : 'Create module'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" required error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Billing v2"
            maxLength={120}
            autoFocus
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this module deliver?"
            maxLength={2000}
            rows={3}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ModuleStatus)}
              options={MODULE_STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABEL[s],
              }))}
              aria-label="Module status"
            />
          </Field>
          <Field label="Lead">
            <Select
              value={leadId}
              onValueChange={setLeadId}
              options={[
                { value: NO_LEAD, label: 'No lead' },
                ...members.map((m) => ({ value: m._id, label: m.name })),
              ]}
              aria-label="Module lead"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" hint="Optional">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Target" hint="Optional">
            <Input
              type="date"
              value={targetDate}
              min={startDate || undefined}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
