import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';

const SIZE = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-[11px]',
  lg: 'w-10 h-10 text-[13px]',
} as const;

const COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#f43f5e',
];

const colorFor = (s: string) =>
  COLORS[
    [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length
  ];

export function Avatar({
  name,
  src,
  size = 'sm',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn(
          'inline-block rounded-full object-cover flex-shrink-0',
          SIZE[size],
          className,
        )}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0',
        SIZE[size],
        className,
      )}
      style={{ background: colorFor(name) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
