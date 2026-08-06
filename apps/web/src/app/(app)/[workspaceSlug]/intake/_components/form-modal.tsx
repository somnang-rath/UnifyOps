'use client';
import { useEffect, useState } from 'react';
import { Field, Input, Textarea } from '@prism/ui';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import type { IntakeForm, SaveIntakeFormBody } from '@/hooks/use-intake';

/** Mirrors the API's anchor rule so a bad slug fails here, not at the server. */
const ANCHOR_RE = /^[a-z0-9-]{3,60}$/;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * Create / rename an intake form.
 *
 * The anchor is what makes a form reachable by strangers, so it is spelled out
 * rather than derived silently: leaving it blank keeps the form unpublished,
 * and clearing it on an existing form takes the public URL away.
 */
export function FormModal({
  open,
  form,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Absent ⇒ create. */
  form?: IntakeForm | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: SaveIntakeFormBody) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anchor, setAnchor] = useState('');
  const [touchedAnchor, setTouchedAnchor] = useState(false);

  // Reset per open, not per render — reopening the same modal must not keep a
  // half-typed title from the previous form.
  useEffect(() => {
    if (!open) return;
    setTitle(form?.title ?? '');
    setDescription(form?.description ?? '');
    setAnchor(form?.anchor ?? '');
    setTouchedAnchor(!!form?.anchor);
  }, [open, form]);

  const anchorError =
    anchor && !ANCHOR_RE.test(anchor)
      ? '3–60 characters: a–z, 0–9 and hyphens only'
      : undefined;
  const canSave = !!title.trim() && !anchorError && !saving;

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      // On update, `null` unpublishes; on create the API takes the field as
      // optional, and null is simply "no anchor".
      anchor: anchor ? anchor : null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={form ? 'Edit intake form' : 'New intake form'}
      description={
        form
          ? undefined
          : 'Collect requests from people who have no account in this workspace.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : form ? 'Save' : 'Create form'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title" required>
          <Input
            value={title}
            autoFocus
            placeholder="Bug reports"
            onChange={(e) => {
              setTitle(e.target.value);
              if (!touchedAnchor) setAnchor(slugify(e.target.value));
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </Field>

        <Field label="Description" hint="shown on the public form">
          <Textarea
            value={description}
            rows={3}
            placeholder="Tell us what went wrong and how to reproduce it."
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field
          label="Public link"
          hint="leave blank to keep it unpublished"
          error={anchorError}
        >
          <Input
            value={anchor}
            placeholder="bug-reports"
            onChange={(e) => {
              setTouchedAnchor(true);
              setAnchor(e.target.value.trim().toLowerCase());
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}
