'use client';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import type { Cycle, SaveCycleBody } from '@/hooks/use-cycles';

/**
 * `<input type="date">` speaks `YYYY-MM-DD`, the API stores an instant. Slice
 * rather than `toISOString()` on a parsed Date: the stored start is local
 * midnight, and re-serialising through UTC can shift it to the previous day for
 * anyone east of Greenwich — the classic off-by-one on a date-only field.
 */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

interface Props {
  open: boolean;
  /** Present = edit, absent = create. */
  cycle?: Cycle | null;
  saving: boolean;
  onSave: (body: SaveCycleBody) => void;
  onClose: () => void;
}

export function CycleModal({ open, cycle, saving, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the modal opens, so reopening after a cancel doesn't show
  // the previous edit's values.
  useEffect(() => {
    if (!open) return;
    setName(cycle?.name ?? '');
    setDescription(cycle?.description ?? '');
    setStartDate(toDateInput(cycle?.startDate ?? null));
    setEndDate(toDateInput(cycle?.endDate ?? null));
    setError(null);
  }, [open, cycle]);

  const submit = () => {
    if (!name.trim()) return setError('Give the cycle a name');
    // Mirror the server rule locally so the common mistake is caught without a
    // round-trip; the server still enforces it (and owns the overlap check).
    if (!!startDate !== !!endDate) {
      return setError('A scheduled cycle needs both a start and an end date');
    }
    if (startDate && endDate && startDate > endDate) {
      return setError('The start date must come before the end date');
    }
    setError(null);
    onSave({
      name: name.trim(),
      description: description.trim(),
      startDate: startDate || null,
      endDate: endDate || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={cycle ? 'Edit cycle' : 'New cycle'}
      description="Leave the dates empty to keep it as a draft you can schedule later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : cycle ? 'Save changes' : 'Create cycle'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" required error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sprint 12"
            maxLength={120}
            autoFocus
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this cycle for?"
            maxLength={2000}
            rows={3}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Ends">
            <Input
              type="date"
              value={endDate}
              // A cycle cannot end before it starts; let the picker enforce it.
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
