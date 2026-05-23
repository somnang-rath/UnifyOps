'use client';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

export function TextPrompt({
  open,
  title,
  label,
  initial = '',
  placeholder,
  confirmLabel = 'Save',
  onConfirm,
  onClose,
}: Props) {
  const [v, setV] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setV(initial);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, initial]);

  const submit = () => {
    const trimmed = v.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!v.trim()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-[12px] font-semibold text-text-sub">
            {label}
          </label>
        )}
        <Input
          ref={inputRef}
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </Modal>
  );
}
