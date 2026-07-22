'use client';

/**
 * Card + header chrome, extracted from `app/(app)/home/home-user.tsx` so home
 * and analytics share one implementation.
 */
export function Panel({
  title,
  subtitle,
  action,
  children,
}: React.PropsWithChildren<{ title: string; subtitle?: string; action?: React.ReactNode }>) {
  return (
    <section className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex flex-col leading-tight min-w-0">
          <h3 className="text-[14px] font-semibold truncate">{title}</h3>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
        {action}
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}
