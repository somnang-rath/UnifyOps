'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const sizeMap = {
  sm: 'max-w-[400px]',
  md: 'max-w-[540px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-[920px]',
};

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
}: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-5 backdrop-blur-[6px] bg-[var(--overlay)] animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={cn(
          'w-full max-h-[90vh] overflow-hidden flex flex-col rounded-xl border border-border shadow-xl',
          'bg-[var(--modal-bg)] backdrop-blur-2xl',
          'animate-modal-in',
          sizeMap[size],
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 px-6 pt-5">
            <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-sm flex items-center justify-center text-text-muted transition-all duration-[var(--dur)] hover:bg-bg-hover hover:text-text flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3.5">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border bg-bg-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
