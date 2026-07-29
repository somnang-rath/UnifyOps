'use client';
import Link from 'next/link';
import { LogOut, Moon, Plus, Search, Sun, User } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { NotificationsBell } from '@/components/layout/notifications-panel';
import { LayoutControls } from '@/components/layout/layout-controls';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { useThemeStore } from '@/stores/theme-store';
import { useThemePrefs } from '@/hooks/use-theme-prefs';
import { useLogout } from '@/lib/auth';

/**
 * Topbar row *content* — the sticky 40px header element itself comes from the
 * shared AppShell in the (app) layout. The ⌘K binding lives in the layout too
 * (useCommandK), so it works even on screens that hide this bar.
 */
export function Topbar() {
  const user = useAuthStore((s) => s.user)!;
  const setPalette = useUIStore((s) => s.setPalette);
  const setUserMenu = useUIStore((s) => s.setUserMenu);
  const userMenuOpen = useUIStore((s) => s.userMenuOpen);
  const theme = useThemeStore((s) => s.theme);
  const { setTheme } = useThemePrefs();
  const logout = useLogout();

  return (
    <div className="h-full flex items-center gap-3 px-5 ">
        <div className="flex-1 max-w-[560px] mx-auto w-full">
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 bg-bg-subtle border border-border rounded-sm text-[13px] text-text-muted transition-all duration-[var(--dur)] hover:border-accent hover:text-text"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="font-mono text-[11px] bg-bg-hover border border-border rounded px-1.5 py-px">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* <Link
          href="/issues?new=1"
          className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-white rounded-sm bg-grad shadow-a transition-all duration-[var(--dur)] hover:-translate-y-px"
        >
          <Plus className="w-3.5 h-3.5" /> New task
        </Link> */}

        <button
          type="button"
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="w-9 h-9 rounded-sm flex items-center justify-center text-text-muted transition-colors duration-[var(--dur)] hover:bg-bg-hover hover:text-text"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        <LayoutControls />

        <NotificationsBell />

        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenu(!userMenuOpen)}
            className="flex items-center gap-2 px-1.5 py-1 rounded-sm transition-colors hover:bg-bg-hover"
          >
            <Avatar name={user.name} src={user.avatar} size="md" />
          </button>
          {userMenuOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-[220px] bg-bg-card border border-border rounded-md shadow-lg p-1 animate-slide-up"
              onMouseLeave={() => setUserMenu(false)}
            >
              <div className="flex items-center gap-2 px-2.5 py-2 mb-1 border-b border-border">
                <Avatar name={user.name} src={user.avatar} size="md" />
                <div className="flex flex-col leading-tight min-w-0">
                  <strong className="text-[12.5px] truncate">
                    {user.name}
                  </strong>
                  <span className="text-[11px] text-text-muted truncate">
                    {user.email}
                  </span>
                </div>
              </div>
              <Link
                href="/settings"
                onClick={() => setUserMenu(false)}
                className="flex items-center gap-2 px-2.5 py-2 rounded-sm text-[13px] hover:bg-bg-hover"
              >
                <User className="w-3.5 h-3.5" /> Settings
              </Link>
              <button
                onClick={() => {
                  setUserMenu(false);
                  logout();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-sm text-[13px] text-red hover:bg-bg-hover"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          )}
        </div>
    </div>
  );
}
