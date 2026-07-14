'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Settings,
  ShieldCheck,
  Mail,
  Sparkles,
  Image as ImageIcon,
  Building2,
  LogOut,
  ArrowLeft,
} from 'lucide-react';
import { getToken, setToken } from '@/lib/auth';
import { api, bootstrapSession } from '@/lib/api';
import { UnifyAdminLockup } from '@/components/logo';
import { ThemeToggle } from '@/components/theme';

// The main web app lives on a different origin, so this is a plain cross-app
// link (not next/link). Defaults to the local web dev server.
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

const NAV: {
  section: string;
  items: { href: string; label: string; icon: typeof Settings }[];
}[] = [
  {
    section: 'Instance',
    items: [
      { href: '/general', label: 'General', icon: Settings },
      { href: '/workspaces', label: 'Workspaces', icon: Building2 },
    ],
  },
  {
    section: 'Integrations',
    items: [
      { href: '/authentication', label: 'Authentication', icon: ShieldCheck },
      { href: '/email', label: 'Email', icon: Mail },
      { href: '/ai', label: 'AI', icon: Sparkles },
      { href: '/images', label: 'Images', icon: ImageIcon },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // 'checking' → verifying session + admin status; 'ok' → render dashboard;
  // 'forbidden' → authenticated but not an instance admin (show notice, no redirect
  // loop since the user already has a valid session).
  const [status, setStatus] = useState<'checking' | 'ok' | 'forbidden'>(
    'checking',
  );

  useEffect(() => {
    (async () => {
      // 1. Must have a session (in-memory token or a refreshable cookie).
      if (!getToken() && !(await bootstrapSession())) {
        router.replace('/login');
        return;
      }
      // 2. Must be an instance admin — otherwise every God Mode call 403s and
      //    the dashboard is unusable. Surface a clear notice instead.
      try {
        const { data } = await api.get<{ isInstanceAdmin: boolean }>(
          '/instance/me',
        );
        setStatus(data.isInstanceAdmin ? 'ok' : 'forbidden');
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  function onLogout() {
    setToken(null);
    router.replace('/login');
  }

  if (status === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-fg-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
        Loading UnifyOps Admin…
      </div>
    );
  }

  if (status === 'forbidden') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <UnifyAdminLockup />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-fg">
            You’re not an instance admin
          </h1>
          <p className="max-w-sm text-sm text-fg-muted">
            This account can sign in, but it doesn’t have instance-admin
            (God Mode) access. Sign in with an admin account, or ask an existing
            instance admin to grant you access.
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <LogOut size={16} />
          Sign in with a different account
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-canvas">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex h-16 items-center border-b border-line px-5">
          <UnifyAdminLockup />
        </div>

        <a
          href={WEB_URL}
          className="group mx-3 mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <ArrowLeft
            size={15}
            className="text-fg-subtle transition-transform group-hover:-translate-x-0.5 group-hover:text-fg"
          />
          Back to UnifyOps
        </a>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map(({ section, items }) => (
            <div key={section} className="mb-5">
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-fg-subtle">
                {section}
              </p>
              {items.map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`group relative mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-brand-soft text-brand'
                        : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                    }`}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand" />
                    )}
                    <Icon
                      size={17}
                      className={
                        active
                          ? 'text-brand'
                          : 'text-fg-subtle group-hover:text-fg'
                      }
                    />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
