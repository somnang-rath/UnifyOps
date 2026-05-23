'use client';
import { Modal } from './modal';
import { Button } from './button';

interface Props {
  open: boolean;
  title?: string;
  body: React.ReactNode;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function Confirm({
  open,
  title = 'Are you sure?',
  body,
  danger,
  onConfirm,
  onClose,
}: Props) {
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
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {danger ? 'Delete' : 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-text-sub leading-[1.6]">{body}</p>
    </Modal>
  );
}
