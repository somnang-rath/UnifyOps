'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  Search,
  Settings as SettingsIcon,
  StickyNote,
  Trello,
  Users,
} from 'lucide-react';
import { useIssues } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useDebounce } from '@/hooks/use-debounce';
import { useUIStore } from '@/stores/ui-store';
import { useLayoutStore } from '@/stores/layout-store';
import { useThemeStore } from '@/stores/theme-store';
import { useThemePrefs } from '@/hooks/use-theme-prefs';
import { useLogout } from '@/lib/auth';
import { cn } from '@/lib/utils';

type CmdGroup = 'Navigate' | 'Create' | 'Actions' | 'Projects' | 'Issues';

interface CmdItem {
  group: CmdGroup;
  Icon: LucideIcon;
  title: string;
  badge?: string;
  run: () => void;
}

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
  const [sel, setSel] = useState(0);
  const debouncedQ = useDebounce(q, 180);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: projects = [] } = useProjects();
  const { data: issuesResp } = useIssues({
    status: 'all',
    q: debouncedQ || undefined,
  });

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  const close = () => setPalette(false);

  const go = (href: string) => () => {
    router.push(href);
    close();
  };

  const items: CmdItem[] = useMemo(() => {
    const actions: CmdItem[] = [
      { group: 'Navigate', Icon: Home, title: 'Go to Home', run: go('/home') },
      { group: 'Navigate', Icon: CheckSquare, title: 'Go to My Work', run: go('/my-work') },
      { group: 'Navigate', Icon: Grid3x3, title: 'Go to Projects', run: go('/projects') },
      { group: 'Navigate', Icon: AlertCircle, title: 'Go to Tasks', run: go('/issues') },
      { group: 'Navigate', Icon: Trello, title: 'Go to Board', run: go('/kanban') },
      { group: 'Navigate', Icon: Calendar, title: 'Go to Calendar', run: go('/calendar') },
      { group: 'Navigate', Icon: GitMerge, title: 'Go to Approvals', run: go('/approvals') },
      { group: 'Navigate', Icon: FileText, title: 'Go to Storage', run: go('/files') },
      { group: 'Navigate', Icon: BookOpen, title: 'Go to Wiki', run: go('/wiki') },
      { group: 'Navigate', Icon: StickyNote, title: 'Go to Notes', run: go('/notes') },
      { group: 'Navigate', Icon: Database, title: 'Go to Tables', run: go('/tables') },
      { group: 'Navigate', Icon: Users, title: 'Go to People', run: go('/users') },
      { group: 'Navigate', Icon: SettingsIcon, title: 'Go to Settings', run: go('/settings') },
      { group: 'Navigate', Icon: SettingsIcon, title: 'Go to Automations', run: go('/automations') },
      { group: 'Create', Icon: Plus, title: 'New task', run: go('/issues?new=1') },
      { group: 'Create', Icon: Plus, title: 'New project', run: go('/projects?new=1') },
      { group: 'Create', Icon: StickyNote, title: 'New note', run: go('/notes?new=1') },
      {
        group: 'Actions',
        Icon: Moon,
        title: 'Toggle theme',
        run: () => {
          setTheme(theme === 'dark' ? 'light' : 'dark');
          close();
        },
      },
      {
        group: 'Actions',
        Icon: PanelLeft,
        title: 'Toggle sidebar',
        run: () => {
          toggleSidebar();
          close();
        },
      },
      {
        group: 'Actions',
        Icon: PanelLeft,
        title: 'Toggle primary side bar',
        run: () => {
          toggleSidebarVisibility();
          close();
        },
      },
      {
        group: 'Actions',
        Icon: Columns2,
        title: 'Split editor right',
        run: () => {
          splitActive('right', pathname);
          close();
        },
      },
      {
        group: 'Actions',
        Icon: Rows2,
        title: 'Split editor down',
        run: () => {
          splitActive('down', pathname);
          close();
        },
      },
      {
        group: 'Actions',
        Icon: RotateCcw,
        title: 'Reset editor layout',
        run: () => {
          resetLayout();
          close();
        },
      },
      {
        group: 'Actions',
        Icon: LogOut,
        title: 'Sign out',
        run: () => {
          close();
          logout();
        },
      },
    ];

    const needle = debouncedQ.toLowerCase().trim();
    const filteredActions = actions.filter(
      (a) => !needle || a.title.toLowerCase().includes(needle),
    );

    const projItems: CmdItem[] = needle
      ? projects
          .filter((p) => p.name.toLowerCase().includes(needle))
          .slice(0, 5)
          .map((p) => ({
            group: 'Projects' as const,
            Icon: Grid3x3,
            title: p.name,
            badge: p.namespace || undefined,
            run: go(`/projects/${p._id}`),
          }))
      : [];

    const issueItems: CmdItem[] = needle
      ? (issuesResp?.items ?? [])
          .slice(0, 5)
          .map((i) => ({
            group: 'Issues' as const,
            Icon: AlertCircle,
            title: i.title,
            badge: '#' + i._id.slice(-4),
            run: go(`/issues/${i._id}`),
          }))
      : [];

    return [...filteredActions, ...projItems, ...issueItems];
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

  useEffect(() => {
    setSel(0);
  }, [debouncedQ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[sel]?.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, sel]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${sel}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const grouped = new Map<CmdGroup, { item: CmdItem; idx: number }[]>();
  items.forEach((item, idx) => {
    const list = grouped.get(item.group) ?? [];
    list.push({ item, idx });
    grouped.set(item.group, list);
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[700] flex items-start justify-center px-5 pt-[12vh] pb-5 bg-[color:var(--overlay,rgba(15,23,42,.55))] backdrop-blur-[6px] animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-[640px] bg-bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-modal-in">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Search className="w-[18px] h-[18px] text-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or search…"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent border-0 outline-none text-[16px] placeholder:text-text-muted"
          />
          <kbd className="font-mono text-[11px] text-text-muted bg-bg-hover border border-border rounded px-1.5 py-px">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[420px] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-text-muted">
              No results
            </div>
          ) : (
            Array.from(grouped.entries()).map(([group, list]) => (
              <div key={group} className="py-1">
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[.08em] text-text-muted">
                  {group}
                </div>
                {list.map(({ item, idx }) => {
                  const Icon = item.Icon;
                  const selected = idx === sel;
                  return (
                    <button
                      key={idx}
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => item.run()}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-[13px] text-left transition-colors duration-[var(--dur)]',
                        selected
                          ? 'bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)]'
                          : 'text-text hover:bg-bg-hover',
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-[15px] h-[15px] flex-shrink-0',
                          selected
                            ? 'text-accent'
                            : 'text-text-muted',
                        )}
                      />
                      <span className="flex-1 min-w-0 truncate">
                        {item.title}
                      </span>
                      {item.badge && (
                        <span className="text-[10px] px-1.5 py-px rounded-full bg-bg-hover text-text-muted">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border bg-bg-subtle text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            <kbd className="font-mono bg-bg-hover border border-border rounded px-1 py-px">↑</kbd>
            <kbd className="font-mono bg-bg-hover border border-border rounded px-1 py-px">↓</kbd>
            Navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="font-mono bg-bg-hover border border-border rounded px-1 py-px">↵</kbd>
            Open
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="font-mono bg-bg-hover border border-border rounded px-1 py-px">Esc</kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
