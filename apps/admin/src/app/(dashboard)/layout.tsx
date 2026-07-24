'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Settings,
  ShieldCheck,
  Mail,
  Sparkles,
  Image as ImageIcon,
  Building2,
  Send,
  LogOut,
  ArrowLeft,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import {
  AppShell,
  SidebarNav,
  SidebarSection,
  SidebarItem,
  CommandPalette,
  useCommandK,
  type CommandPaletteItem,
} from '@prism/ui';
import { getToken, setToken } from '@/lib/auth';
import { api, bootstrapSession } from '@/lib/api';
import { UnifyAdminLockup } from '@/components/logo';
import { ThemeToggle, useTheme } from '@/components/theme';

// The main web app lives on a different origin, so this is a plain cross-app
// link (not next/link). Defaults to the local web dev server.
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';

const NAV: {
  section: string;
  items: { href: string; label: string; icon: LucideIcon }[];
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
      { href: '/telegram', label: 'Telegram', icon: Send },
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
  const { toggle: toggleTheme } = useTheme();
  // 'checking' → verifying session + admin status; 'ok' → render dashboard;
  // 'forbidden' → authenticated but not an instance admin (show notice, no redirect
  // loop since the user already has a valid session).
  const [status, setStatus] = useState<'checking' | 'ok' | 'forbidden'>(
    'checking',
  );

  // ⌘K palette — same shared component as web (docs/plan/02-design-system.md §4).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQ, setPaletteQ] = useState('');
  useCommandK(useCallback(() => setPaletteOpen(true), []));

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

  const onLogout = useCallback(() => {
    setToken(null);
    router.replace('/login');
  }, [router]);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setPaletteQ('');
  }, []);

  const paletteItems: CommandPaletteItem[] = useMemo(() => {
    const go = (href: string) => () => {
      router.push(href);
      closePalette();
    };
    const items: CommandPaletteItem[] = [
      ...NAV.flatMap(({ items }) =>
        items.map(
          ({ href, label, icon: Icon }): CommandPaletteItem => ({
            id: href,
            group: 'Navigate',
            icon: <Icon className="w-[15px] h-[15px]" />,
            title: `Go to ${label}`,
            onSelect: go(href),
          }),
        ),
      ),
      {
        group: 'Actions',
        icon: <ArrowLeft className="w-[15px] h-[15px]" />,
        title: 'Back to UnifyOps',
        onSelect: () => {
          closePalette();
          window.location.href = WEB_URL;
        },
      },
      {
        group: 'Actions',
        icon: <Moon className="w-[15px] h-[15px]" />,
        title: 'Toggle theme',
        onSelect: () => {
          toggleTheme();
          closePalette();
        },
      },
      {
        group: 'Actions',
        icon: <LogOut className="w-[15px] h-[15px]" />,
        title: 'Sign out',
        onSelect: () => {
          closePalette();
          onLogout();
        },
      },
    ];
    const needle = paletteQ.toLowerCase().trim();
    return needle
      ? items.filter((i) => i.title.toLowerCase().includes(needle))
      : items;
  }, [router, paletteQ, closePalette, toggleTheme, onLogout]);

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
    <>
      <AppShell
        sidebar={
          <>
            <div className="flex h-16 items-center border-b border-[color:var(--sidebar-border,var(--border))] px-5">
              <UnifyAdminLockup />
            </div>

            <a
              href={WEB_URL}
              className="group mx-2.5 mt-3 mb-1 flex items-center gap-2 rounded-sm border border-border px-2.5 py-1.5 text-xs font-medium text-text-sub transition-colors hover:bg-bg-hover hover:text-text"
            >
              <ArrowLeft
                size={14}
                className="text-text-muted transition-transform group-hover:-translate-x-0.5 group-hover:text-text"
              />
              Back to UnifyOps
            </a>

            <SidebarNav>
              {NAV.map(({ section, items }) => (
                <SidebarSection key={section} label={section}>
                  {items.map(({ href, label, icon: Icon }) => (
                    <SidebarItem
                      key={href}
                      as={Link}
                      href={href}
                      icon={<Icon className="w-4 h-4" />}
                      label={label}
                      active={
                        pathname === href || pathname.startsWith(href + '/')
                      }
                    />
                  ))}
                </SidebarSection>
              ))}
            </SidebarNav>

            <div className="flex items-center justify-between border-t border-[color:var(--sidebar-border,var(--border))] px-4 py-3">
              <ThemeToggle />
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm font-medium text-text-sub transition-colors hover:bg-bg-hover hover:text-text"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </>
        }
        mainClassName="px-8 py-10"
      >
        <div className="mx-auto max-w-3xl">{children}</div>
      </AppShell>

      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        items={paletteItems}
        query={paletteQ}
        onQueryChange={setPaletteQ}
      />
    </>
  );
}
