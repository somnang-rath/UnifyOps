'use client';
import * as React from 'react';
import { ShieldCheck, Users, Zap } from 'lucide-react';
import { UnifyLogo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme';

const HIGHLIGHTS: { icon: typeof ShieldCheck; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Instance-wide control',
    body: 'Authentication, email, AI and storage — configured in one console.',
  },
  {
    icon: Users,
    title: 'Manage every workspace',
    body: 'Oversee members, roles and access across the whole instance.',
  },
  {
    icon: Zap,
    title: 'Fast & secure by default',
    body: 'Short-lived tokens, httpOnly refresh, God-Mode gated actions.',
  },
];

/**
 * Split-screen auth layout shared by /login, /register and /setup.
 * Left: a branded gradient marketing panel (hidden on small screens).
 * Right: the form area passed as `children`.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Brand panel */}
      <aside className="relative hidden w-[46%] max-w-[620px] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-hover p-12 text-white lg:flex">
        {/* Decorative glows + grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-black/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />

        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-lg">
            <UnifyLogo className="h-7 w-7" />
          </span>
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight">UnifyOps</p>
            <p className="text-xs text-white/70">Admin console</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            The control center for your UnifyOps instance.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/80">
            Sign in to manage workspaces, integrations and instance-wide
            settings from a single, secure place.
          </p>

          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title: t, body }) => (
              <li key={t} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
                  <Icon size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="text-sm text-white/70">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          © {new Date().getFullYear()} UnifyOps · Instance administration
        </p>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* Mobile-only logo */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft">
              <UnifyLogo className="h-6 w-6" />
            </span>
            <span className="text-sm font-bold tracking-tight text-brand">
              UnifyOps
            </span>
          </div>

          <div className="mb-7">
            {eyebrow && (
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand">
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
            {subtitle && (
              <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>
            )}
          </div>

          {children}

          {footer && (
            <div className="mt-6 text-center text-sm text-fg-muted">
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
