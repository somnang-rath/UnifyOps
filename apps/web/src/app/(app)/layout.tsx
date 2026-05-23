'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { CommandPalette } from '@/components/layout/command-palette';
import { NavigationProgress } from '@/components/layout/navigation-progress';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { useNotificationsSocket } from '@/hooks/use-notifications-socket';
import { useTabBadge } from '@/hooks/use-tab-badge';
import { refreshAuth } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LoadingScreen } from '@/components/ui/loading-screen';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
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

  if (!booted || !user) return <LoadingScreen />;

  return (
    <div className="min-h-screen">
      <NavigationProgress />
      <Sidebar />
      <div
        className={cn(
          'transition-[margin] duration-300 ease-[cubic-bezier(.4,0,.2,1)]',
          collapsed ? 'ml-sb-collapsed' : 'ml-sb',
        )}
      >
        <Topbar />
        <main className="px-6 py-5">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
