// The admin app is served under basePath /god-mode (see next.config.mjs).
// Plain <img> tags are NOT auto-prefixed by Next (unlike next/image), and the
// public/ folder is served under the basePath — so static asset URLs must
// include it explicitly.
const BASE_PATH = '/god-mode';

/** UnifyOps logomark — same asset as the main web app. */
export function UnifyLogo({ className }: { className?: string }) {
  return (
    <img
      src={`${BASE_PATH}/imgs/logo/Secondary_Logomark.svg`}
      alt="UnifyOps"
      className={className}
      draggable={false}
    />
  );
}

/**
 * Logo + wordmark lockup used in the sidebar and auth screens. Shares the
 * "UnifyOps" product name with the main web app, with an "Admin console"
 * qualifier so both apps read as one product.
 */
export function UnifyAdminLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <UnifyLogo className="h-9 w-9 flex-shrink-0" />
      {!compact && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-bold tracking-tight text-brand">
            UnifyOps
          </span>
          <span className="text-[11px] text-fg-subtle">Admin console</span>
        </div>
      )}
    </div>
  );
}
