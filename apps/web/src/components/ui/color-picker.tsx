'use client';
import { cn } from '@/lib/utils';
import { PROJECT_COLORS } from '@/schemas/project';

export function ColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (c: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-1.5 p-2 bg-bg-input border-[1.5px] border-border rounded-sm flex-wrap',
        className,
      )}
    >
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={cn(
            'w-[22px] h-[22px] rounded-full border-2 cursor-pointer transition-transform duration-[var(--dur)] hover:scale-110',
            value === c ? 'border-text' : 'border-transparent',
          )}
        />
      ))}
    </div>
  );
}
