'use client';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkMentions } from '@/lib/remark-mentions';
import { remarkCallouts } from '@/lib/remark-callouts';
import { cn } from '@/lib/utils';

interface Props {
  body: string;
  className?: string;
  users?: { name: string; email: string }[];
}

export function MarkdownView({ body, className, users = [] }: Props) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null,
  );
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [lightbox]);
  const nameByLocal = new Map(
    users.map((u) => [u.email.split('@')[0].toLowerCase(), u.name]),
  );
  const emailByLocal = new Map(
    users.map((u) => [u.email.split('@')[0].toLowerCase(), u.email]),
  );
  return (
    <div
      className={cn(
        'md-view text-[13.5px] leading-[1.6] text-text break-words',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkCallouts, remarkMentions, remarkGfm]}
        components={{
          a: ({ node: _n, href, children, ...p }) => {
            if (typeof href === 'string' && href.startsWith('#mention-')) {
              const token = href.slice('#mention-'.length);
              const name = nameByLocal.get(token);
              const email = emailByLocal.get(token);
              return (
                <span
                  data-mention
                  title={email}
                  className="inline-flex items-baseline px-1 py-px mx-px text-[12.5px] font-medium text-accent bg-accent-50 dark:bg-[rgba(99,102,241,.16)] dark:text-[var(--a-200)] rounded"
                >
                  {name ? `@${name}` : children}
                </span>
              );
            }
            return (
              <a
                {...p}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {children}
              </a>
            );
          },
          img: ({ node: _n, alt, src, ...p }) => (
            <img
              {...p}
              src={src}
              alt={alt ?? ''}
              onClick={() =>
                typeof src === 'string' &&
                setLightbox({ src, alt: alt ?? '' })
              }
              className="block max-h-[180px] max-w-[260px] w-auto h-auto rounded-md border border-border my-2 cursor-zoom-in object-cover hover:opacity-90 transition-opacity"
            />
          ),
          h1: ({ node: _n, ...p }) => (
            <h1
              {...p}
              className="text-[18px] font-bold mt-3 mb-1.5 first:mt-0"
            />
          ),
          h2: ({ node: _n, ...p }) => (
            <h2
              {...p}
              className="text-[16px] font-bold mt-3 mb-1.5 first:mt-0"
            />
          ),
          h3: ({ node: _n, ...p }) => (
            <h3
              {...p}
              className="text-[14px] font-semibold mt-2.5 mb-1 first:mt-0"
            />
          ),
          h4: ({ node: _n, ...p }) => (
            <h4
              {...p}
              className="text-[13px] font-semibold mt-2 mb-1 first:mt-0"
            />
          ),
          p: ({ node: _n, ...p }) => <p {...p} className="my-1.5 first:mt-0 last:mb-0" />,
          ul: ({ node: _n, className, ...p }) => (
            <ul
              {...p}
              className={cn(
                /task-list/.test(className ?? '')
                  ? 'list-none pl-1 my-1.5'
                  : 'list-disc pl-5 my-1.5',
              )}
            />
          ),
          ol: ({ node: _n, ...p }) => (
            <ol {...p} className="list-decimal pl-5 my-1.5" />
          ),
          li: ({ node: _n, className, ...p }) => (
            <li
              {...p}
              className={cn(
                'my-0.5',
                /task-list-item/.test(className ?? '') &&
                  'flex items-start gap-2 list-none',
              )}
            />
          ),
          input: ({ node: _n, ...p }) => (
            <input
              {...p}
              disabled
              className="mt-1 accent-accent cursor-default"
            />
          ),
          del: ({ node: _n, ...p }) => <del {...p} className="opacity-70" />,
          blockquote: ({ node: _n, ...p }) => (
            <blockquote
              {...p}
              className="border-l-2 border-border pl-3 my-2 text-text-sub italic"
            />
          ),
          code: ({ node: _n, className, children, ...p }) => {
            const inline = !/language-/.test(className ?? '');
            if (inline) {
              return (
                <code
                  {...p}
                  className="px-1 py-0.5 rounded bg-bg-subtle text-[12.5px] font-mono"
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                {...p}
                className={cn(
                  'block px-3 py-2 rounded-md bg-bg-subtle text-[12.5px] font-mono overflow-x-auto',
                  className,
                )}
              >
                {children}
              </code>
            );
          },
          pre: ({ node: _n, ...p }) => <pre {...p} className="my-2" />,
          hr: ({ node: _n, ...p }) => (
            <hr {...p} className="border-border my-3" />
          ),
          table: ({ node: _n, ...p }) => (
            <div className="overflow-x-auto my-2">
              <table
                {...p}
                className="text-[12.5px] border-collapse border border-border"
              />
            </div>
          ),
          th: ({ node: _n, ...p }) => (
            <th
              {...p}
              className="border border-border px-2 py-1 bg-bg-subtle text-left font-semibold"
            />
          ),
          td: ({ node: _n, ...p }) => (
            <td {...p} className="border border-border px-2 py-1" />
          ),
        }}
      >
        {body}
      </ReactMarkdown>
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 cursor-zoom-out animate-fade-in"
        >
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[95vw] max-h-[92vh] object-contain rounded-md shadow-2xl cursor-default"
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-9 h-9 inline-flex items-center justify-center rounded-full bg-black/60 text-white text-lg hover:bg-black/80"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
