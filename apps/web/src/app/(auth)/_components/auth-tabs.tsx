"use client"

export function AuthHead() {
  return null;
}

export function FieldIcon({
  label,
  icon,
  error,
  children,
}: {
  label: string
  icon: React.ReactNode
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold text-text-sub tracking-[.01em]">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
          {icon}
        </span>
        {children}
      </div>
      {error && (
        <p className="px-2.5 py-1.5 rounded-sm text-[12px] text-red bg-[rgba(239,68,68,.08)]">
          {error}
        </p>
      )}
    </div>
  )
}
