'use client';
import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  CheckSquare,
  Columns2,
  Database,
  FileText,
  GitMerge,
  Grid3x3,
  Home,
  type LucideIcon,
  LogOut,
  Moon,
  PanelLeft,
  Plus,
  RotateCcw,
  Rows2,
  Settings as SettingsIcon,
  StickyNote,
  Trello,
  Users,
} from 'lucide-react';
import {
  CommandPalette as UICommandPalette,
  type CommandPaletteItem,
} from '@prism/ui';
import { useIssues } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useDebounce } from '@/hooks/use-debounce';
import { useUIStore } from '@/stores/ui-store';
import { useLayoutStore } from '@/stores/layout-store';
import { useThemeStore } from '@/stores/theme-store';
import { useThemePrefs } from '@/hooks/use-theme-prefs';
import { useLogout } from '@/lib/auth';

const icon = (I: LucideIcon) => <I className="w-[15px] h-[15px]" />;

/**
 * The web app's ⌘K palette: builds the command list (navigation, create,
 * layout/theme actions, and async project/task search) and hands rendering +
 * keyboard handling to the shared @prism/ui CommandPalette.
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const setPalette = useUIStore((s) => s.setPalette);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleSidebarVisibility = useUIStore((s) => s.toggleSidebarVisibility);
  const splitActive = useLayoutStore((s) => s.splitActive);
  const resetLayout = useLayoutStore((s) => s.reset);
  const theme = useThemeStore((s) => s.theme);
  const { setTheme } = useThemePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 180);

  const { data: projects = [] } = useProjects();
  const { data: issuesResp } = useIssues({
    status: 'all',
    q: debouncedQ || undefined,
  });

  const close = () => {
    setPalette(false);
    setQ('');
  };

  const go = (href: string) => () => {
    router.push(href);
    close();
  };

  const items: CommandPaletteItem[] = useMemo(() => {
    const actions: CommandPaletteItem[] = [
      { group: 'Navigate', icon: icon(Home), title: 'Go to Home', onSelect: go('/home') },
      { group: 'Navigate', icon: icon(CheckSquare), title: 'Go to My Work', onSelect: go('/my-work') },
      { group: 'Navigate', icon: icon(Grid3x3), title: 'Go to Projects', onSelect: go('/projects') },
      { group: 'Navigate', icon: icon(AlertCircle), title: 'Go to Tasks', onSelect: go('/issues') },
      { group: 'Navigate', icon: icon(Trello), title: 'Go to Board', onSelect: go('/kanban') },
      { group: 'Navigate', icon: icon(Calendar), title: 'Go to Calendar', onSelect: go('/calendar') },
      { group: 'Navigate', icon: icon(GitMerge), title: 'Go to Approvals', onSelect: go('/approvals') },
      { group: 'Navigate', icon: icon(FileText), title: 'Go to Storage', onSelect: go('/files') },
      { group: 'Navigate', icon: icon(BookOpen), title: 'Go to Wiki', onSelect: go('/wiki') },
      { group: 'Navigate', icon: icon(StickyNote), title: 'Go to Notes', onSelect: go('/notes') },
      { group: 'Navigate', icon: icon(Database), title: 'Go to Tables', onSelect: go('/tables') },
      { group: 'Navigate', icon: icon(Users), title: 'Go to People', onSelect: go('/users') },
      { group: 'Navigate', icon: icon(SettingsIcon), title: 'Go to Settings', onSelect: go('/settings') },
      { group: 'Navigate', icon: icon(SettingsIcon), title: 'Go to Automations', onSelect: go('/automations') },
      { group: 'Create', icon: icon(Plus), title: 'New task', onSelect: go('/issues?new=1') },
      { group: 'Create', icon: icon(Plus), title: 'New project', onSelect: go('/projects?new=1') },
      { group: 'Create', icon: icon(StickyNote), title: 'New note', onSelect: go('/notes?new=1') },
      {
        group: 'Actions',
        icon: icon(Moon),
        title: 'Toggle theme',
        onSelect: () => {
          setTheme(theme === 'dark' ? 'light' : 'dark');
          close();
        },
      },
      {
        group: 'Actions',
        icon: icon(PanelLeft),
        title: 'Toggle sidebar',
        onSelect: () => {
          toggleSidebar();
          close();
        },
      },
      {
        group: 'Actions',
        icon: icon(PanelLeft),
        title: 'Toggle primary side bar',
        onSelect: () => {
          toggleSidebarVisibility();
          close();
        },
      },
      {
        group: 'Actions',
        icon: icon(Columns2),
        title: 'Split editor right',
        onSelect: () => {
          splitActive('right', pathname);
          close();
        },
      },
      {
        group: 'Actions',
        icon: icon(Rows2),
        title: 'Split editor down',
        onSelect: () => {
          splitActive('down', pathname);
          close();
        },
      },
      {
        group: 'Actions',
        icon: icon(RotateCcw),
        title: 'Reset editor layout',
        onSelect: () => {
          resetLayout();
          close();
        },
      },
      {
        group: 'Actions',
        icon: icon(LogOut),
        title: 'Sign out',
        onSelect: () => {
          close();
          logout();
        },
      },
    ];

    const needle = debouncedQ.toLowerCase().trim();
    const filteredActions = actions.filter(
      (a) => !needle || a.title.toLowerCase().includes(needle),
    );

    const projItems: CommandPaletteItem[] = needle
      ? projects
          .filter((p) => p.name.toLowerCase().includes(needle))
          .slice(0, 5)
          .map((p) => ({
            id: p._id,
            group: 'Projects',
            icon: icon(Grid3x3),
            title: p.name,
            badge: p.namespace || undefined,
            onSelect: go(`/projects/${p._id}`),
          }))
      : [];

    const issueItems: CommandPaletteItem[] = needle
      ? (issuesResp?.items ?? []).slice(0, 5).map((i) => ({
          id: i._id,
          group: 'Issues',
          icon: icon(AlertCircle),
          title: i.title,
          badge: '#' + i._id.slice(-4),
          onSelect: go(`/issues/${i._id}`),
        }))
      : [];

    return [...filteredActions, ...projItems, ...issueItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedQ,
    projects,
    issuesResp,
    theme,
    setTheme,
    toggleSidebar,
    toggleSidebarVisibility,
    splitActive,
    resetLayout,
    pathname,
    logout,
  ]);

  return (
    <UICommandPalette
      open={open}
      onClose={close}
      items={items}
      query={q}
      onQueryChange={setQ}
    />
  );
}
