'use client';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import type { CellLink } from '@/schemas/workbook';

interface Props {
  open: boolean;
  initial: CellLink | null;
  defaultText: string;
  onClose: () => void;
  onApply: (link: CellLink | null) => void;
}

export function InsertLinkModal({
  open,
  initial,
  defaultText,
  onClose,
  onApply,
}: Props) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(initial?.url ?? '');
    setText(initial?.text ?? defaultText ?? '');
    // Focus URL on next paint so the modal's autofocus doesn't fight us.
    setTimeout(() => urlRef.current?.focus(), 50);
  }, [open, initial, defaultText]);

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const normalized = normalizeUrl(trimmed);
    onApply({
      url: normalized,
      text: text.trim() || undefined,
    });
    onClose();
  };

  const remove = () => {
    onApply(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit link' : 'Insert link'}
      size="sm"
      footer={
        <>
          {initial && (
            <Button variant="ghost" onClick={remove}>
              Remove
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!url.trim()}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="URL">
          <Input
            ref={urlRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim()) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Field>
        <Field label="Display text (optional)">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={defaultText || 'Same as cell value'}
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Add a protocol if the user typed a bare host like `example.com` or
 * `www.foo.com`. Anchor refs (#section) and explicit schemes pass through.
 */
function normalizeUrl(s: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (s.startsWith('#') || s.startsWith('/')) return s;
  if (s.startsWith('mailto:')) return s;
  if (s.includes('@') && !s.includes('/')) return 'mailto:' + s;
  return 'https://' + s;
}
