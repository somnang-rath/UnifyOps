'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/input';

interface Props {
  open: boolean;
  initial: string;
  onClose: () => void;
  onApply: (text: string) => void;
}

export function CellNoteModal({ open, initial, onClose, onApply }: Props) {
  const [text, setText] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => taRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cell note"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onApply(text)}>Save</Button>
        </>
      }
    >
      <Textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Enter note text…"
      />
    </Modal>
  );
}
