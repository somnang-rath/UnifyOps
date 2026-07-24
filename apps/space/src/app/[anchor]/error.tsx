'use client';

/**
 * Non-404 failure boundary for the public anchor route (spec publish-to-space
 * §3.6): getPublicPayload threw — API down or a 5xx. No fetching here, same
 * visual register as not-found.tsx. A plain same-URL anchor is the reload
 * affordance (works under the strict space CSP).
 */
export default function AnchorError() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-text-muted">
          Error
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Something went wrong loading this page.
        </h1>
        <p className="mt-3 text-[14px] text-text-sub">
          <a href="" className="underline underline-offset-2">
            Reload
          </a>
        </p>
      </div>
    </main>
  );
}
