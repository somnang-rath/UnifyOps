'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { CommandPalette } from '@/components/layout/command-palette';
import { NavigationProgress } from '@/components/layout/navigation-progress';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { useAssistantStore } from '@/stores/assistant-store';
import { useLayoutStore } from '@/stores/layout-store';
import { useNotificationsSocket } from '@/hooks/use-notifications-socket';
import { useTabBadge } from '@/hooks/use-tab-badge';
import { refreshAuth } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LoadingScreen } from '@/components/ui/loading-screen'
import { ErrorCollector } from '@/components/feature/debug/error-collector';
import { PaneGroup } from '@/components/editor/pane-group';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const sidebarHidden = useUIStore((s) => s.sidebarHidden);
  const toggleSidebarVisibility = useUIStore((s) => s.toggleSidebarVisibility);
  const isSplit = useLayoutStore((s) => s.root.type === 'split');
  // Panes render sibling routes in an <iframe> with `?chrome=0`, which loads
  // this same layout without the sidebar/topbar/pane shell. The query is the
  // explicit signal, but it can be dropped by an in-app redirect (project index
  // → /overview, workspace-mismatch, legacy deep links). Being framed at all is
  // an unambiguous, redirect-proof signal that we're a pane, so fall back to it.
  const [inIframe, setInIframe] = useState(false);
  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      // Cross-origin access throws — that only happens when we *are* embedded.
      setInIframe(true);
    }
  }, []);
  const bare = searchParams.get('chrome') === '0' || inIframe;
  const [booted, setBooted] = useState(
    () => !!(useAuthStore.getState().user && useAuthStore.getState().accessToken),
  );
  const triedRef = useRef(false);
  useNotificationsSocket();
  useTabBadge();

  useEffect(() => {
    if (booted || triedRef.current) return;
    triedRef.current = true;
    refreshAuth().finally(() => setBooted(true));
  }, [booted]);

  useEffect(() => {
    if (booted && !user)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [booted, user, router, pathname]);

  // Global shortcuts: ⌘/ (Ctrl+/) toggles the AI assistant panel — ⌘K is the
  // command palette, so the assistant gets its own chord. ⌘B (Ctrl+B) toggles
  // the primary side bar, ⌘\ splits the editor, and ⌘1..9 focuses a pane —
  // matching VSCode.
  useEffect(() => {
    // Don't hijack Ctrl+B (and friends) while the user is typing in a text
    // field or rich editor — Ctrl+B there means "bold".
    const inEditable = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      return (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable === true
      );
    };

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === '/') {
        e.preventDefault();
        useAssistantStore.getState().togglePanel();
      } else if (e.key.toLowerCase() === 'b') {
        if (inEditable(e.target)) return;
        e.preventDefault();
        toggleSidebarVisibility();
      } else if (e.key === '\\') {
        // Split the active editor: Ctrl/⌘+\ → right, Alt+Ctrl/⌘+\ → down.
        // The new pane opens the current route (read from the live URL).
        e.preventDefault();
        useLayoutStore
          .getState()
          .splitActive(e.altKey ? 'down' : 'right', window.location.pathname);
      } else if (/^[1-9]$/.test(e.key)) {
        // Ctrl/⌘+1..9 → focus the Nth pane (only meaningful when split).
        const ids = useLayoutStore.getState().paneOrder();
        const id = ids[Number(e.key) - 1];
        if (ids.length > 1 && id) {
          e.preventDefault();
          useLayoutStore.getState().setActive(id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebarVisibility]);

  if (!booted || !user) return <LoadingScreen />;

  // Chrome-less mode: an editor pane loads this route inside an <iframe>. Strip
  // the sidebar/topbar/pane shell and render just the page, full-height.
  if (bare) {
    return (
      <ErrorCollector>
        <main className="h-screen overflow-auto px-6 py-5">{children}</main>
      </ErrorCollector>
    );
  }

  // Report editor gets a full-screen layout — no topbar overhead, no content padding
  const isReportEditor = /\/reports\/[^/]+\/edit/.test(pathname);

  return (
    <ErrorCollector>
      <div className="min-h-screen">
        <NavigationProgress />
        <Sidebar />
        <div
          className={cn(
            'transition-[margin] duration-300 ease-[cubic-bezier(.4,0,.2,1)]',
            sidebarHidden ? 'ml-0' : collapsed ? 'ml-sb-collapsed' : 'ml-sb',
          )}
        >
          {!isReportEditor && <Topbar />}
          <main
            className={cn(
              isReportEditor
                ? 'h-screen overflow-hidden'
                : isSplit
                  ? 'h-[calc(100vh-theme(spacing.tb))] overflow-hidden'
                  : 'px-6 py-5',
            )}
          >
            <PaneGroup>{children}</PaneGroup>
          </main>
        </div>
        <CommandPalette />
        <AssistantPanel />
      </div>
    </ErrorCollector>
  );
}
