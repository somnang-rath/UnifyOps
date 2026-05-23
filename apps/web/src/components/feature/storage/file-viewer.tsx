'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  X,
} from 'lucide-react';
import { filesService } from '@/hooks/use-files';
import { fmtBytes, relTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { FileItem } from '@/schemas/file';

export function FileViewer({
  files,
  index,
  onIndexChange,
  onClose,
}: {
  files: FileItem[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const file = index !== null ? files[index] ?? null : null;
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < files.length - 1;

  useEffect(() => {
    if (file === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index! - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndexChange(index! + 1);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [file, hasPrev, hasNext, index, onIndexChange, onClose]);

  if (!file || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[600] bg-[rgba(0,0,0,.82)] backdrop-blur-[6px] flex flex-col animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 text-white">
        <div className="flex-1 min-w-0">
          <strong className="block text-[14px] font-semibold truncate">
            {file.name}
          </strong>
          <span className="block text-[11.5px] text-white/60 tabular-nums">
            {file.category !== 'link' && `${fmtBytes(file.size)} · `}
            {relTime(file.updatedAt)}
          </span>
        </div>
        {file.category !== 'link' && (
          <a
            href={filesService.downloadUrl(file._id)}
            download={file.name}
            title="Download"
            className="w-8 h-8 rounded-sm flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Download className="w-4 h-4" />
          </a>
        )}
        <a
          href={
            file.category === 'link'
              ? file.url
              : filesService.downloadUrl(file._id)
          }
          target="_blank"
          rel="noreferrer"
          title="Open in new tab"
          className="w-8 h-8 rounded-sm flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 rounded-sm flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-4 relative">
        <NavBtn
          side="left"
          disabled={!hasPrev}
          onClick={() => hasPrev && onIndexChange(index! - 1)}
        />
        <ViewerBody file={file} />
        <NavBtn
          side="right"
          disabled={!hasNext}
          onClick={() => hasNext && onIndexChange(index! + 1)}
        />
      </div>

      {files.length > 1 && (
        <footer className="px-5 py-2.5 border-t border-white/10 text-center text-[11.5px] text-white/60 tabular-nums">
          {index! + 1} / {files.length}
        </footer>
      )}
    </div>,
    document.body,
  );
}

function ViewerBody({ file }: { file: FileItem }) {
  const src = filesService.downloadUrl(file._id);

  if (file.category === 'image') {
    return (
      <img
        src={src}
        alt={file.name}
        className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
      />
    );
  }

  if (file.category === 'pdf') {
    return (
      <iframe
        src={src}
        title={file.name}
        className="w-full h-full max-w-[1200px] bg-white rounded-sm shadow-2xl"
      />
    );
  }

  if (file.category === 'link') {
    return (
      <Fallback
        title={file.name}
        hint={file.url ?? ''}
        action={
          <a
            href={file.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-accent text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open link
          </a>
        }
      />
    );
  }

  return (
    <Fallback
      title={file.name}
      hint={`${fmtBytes(file.size)} · No inline preview for this file type`}
      action={
        <a
          href={src}
          download={file.name}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-accent text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      }
    />
  );
}

function Fallback({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center max-w-[520px] px-6 py-10 bg-white/5 border border-white/10 rounded-lg text-white">
      <FileText className="w-12 h-12 text-white/50" />
      <strong className="text-[16px] font-semibold break-all">{title}</strong>
      <span className="text-[12.5px] text-white/60 break-all">{hint}</span>
      <div className="mt-2">{action}</div>
    </div>
  );
}

function NavBtn({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous' : 'Next'}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full',
        'flex items-center justify-center bg-white/10 text-white/90 backdrop-blur-md',
        'hover:bg-white/20 hover:text-white transition-colors',
        'disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-white/10',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      <Icon className="w-6 h-6" />
    </button>
  );
}
