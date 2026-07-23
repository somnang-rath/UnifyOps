"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  AlertCircle,
  Bell,
  BookOpen,
  Bug,
  Calendar,
  CheckSquare,
  Database,
  FileBarChart2,
  FileText,
  Grid3x3,
  Home,
  PanelLeft,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  StickyNote,
  Trello,
  GitMerge,
  MessageSquare,
  Users,
  Zap,
  Activity,
  BarChart3,
  ShieldCheck,
} from "lucide-react"
import { SidebarNav, SidebarSection, SidebarItem } from "@prism/ui"
import { UnifyOpsLogo } from "@/components/icons/logo"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { useWorkspaceHref } from "@/hooks/use-workspaces"
import { useAuthStore } from "@/stores/auth-store"
import { useUIStore } from "@/stores/ui-store"
import { useAssistantStore } from "@/stores/assistant-store"
import { useAssistantConfig } from "@/hooks/use-assistant"
import { useBadges } from "@/hooks/use-badges"
import { useIsInstanceAdmin } from "@/hooks/use-instance-admin"
import { cn } from "@/lib/utils"

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001"

const SUPER_ADMIN_EMAILS = new Set(['somnang.rath12@gmail.com', 'admin@demo.com'])

type BadgeKey = 'issues' | 'mywork' | 'approvals' | 'notifications' | 'chat'

interface NavItem {
  href: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
  superAdminOnly?: boolean
  assistantOnly?: boolean
  badge?: BadgeKey
  /**
   * Lives under /[workspaceSlug] — Tier W in the ADR 0011 route census.
   * All Tier W routes are migrated (projects: ADR 0006 · chat: Phase 9 ·
   * analytics: Phase 7b part A · issues/calendar/timeline/wiki: part B).
   * Per-user views (Board/My Work/Approvals/…) are Tier P and stay flat
   * forever — nesting them would imply scoping the data doesn't have.
   */
  workspaceScoped?: boolean
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Workspace",
    items: [
      { href: "/home", label: "Home", Icon: Home },
      { href: "/my-work", label: "My Work", Icon: CheckSquare, badge: "mywork" },
      { href: "/projects", label: "Projects", Icon: Grid3x3, workspaceScoped: true },
      { href: "/chat", label: "Chat", Icon: MessageSquare, badge: "chat", workspaceScoped: true },
    ],
  },
  {
    section: "Plan & Track",
    items: [
      { href: "/issues", label: "Tasks", Icon: AlertCircle, badge: "issues", workspaceScoped: true },
      { href: "/kanban", label: "Board", Icon: Trello },
      { href: "/calendar", label: "Calendar", Icon: Calendar, workspaceScoped: true },
      { href: "/approvals", label: "Approvals", Icon: GitMerge, badge: "approvals" },
      { href: "/analytics", label: "Analytics", Icon: BarChart3, workspaceScoped: true },
    ],
  },
  {
    section: "Knowledge",
    items: [
      { href: "/files", label: "Storage", Icon: FileText },
      { href: "/wiki", label: "Wiki", Icon: BookOpen, workspaceScoped: true },
      { href: "/notes", label: "Notes", Icon: StickyNote },
      { href: "/tables", label: "Tables", Icon: Database },
      { href: "/reports", label: "Reports", Icon: FileBarChart2 },
      { href: "/assistant", label: "Assistant", Icon: Sparkles, assistantOnly: true },
    ],
  },
  {
    section: "People & Tools",
    items: [
      { href: "/notifications", label: "Notifications", Icon: Bell, badge: "notifications" },
      { href: "/automations", label: "Automations", Icon: Zap },
      { href: "/timeline", label: "Timeline", Icon: Activity, workspaceScoped: true },
      { href: "/users", label: "People", Icon: Users, adminOnly: true },
      { href: "/debug", label: "Debug & Errors", Icon: Bug, superAdminOnly: true },
      { href: "/settings", label: "Settings", Icon: SettingsIcon },
    ],
  },
]

/**
 * Sidebar column *content* — the fixed positioning, width, and slide
 * transitions belong to the shared AppShell in the (app) layout.
 */
export function Sidebar() {
  const pathname = usePathname()
  const ws = useWorkspaceHref()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggle = useUIStore((s) => s.toggleSidebar)
  const setPalette = useUIStore((s) => s.setPalette)
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const isSuperAdmin = !!user?.email && SUPER_ADMIN_EMAILS.has(user.email)
  const isInstanceAdmin = useIsInstanceAdmin()
  const { data: badges } = useBadges()
  const { data: assistant } = useAssistantConfig()
  const openAssistant = useAssistantStore((s) => s.openPanel)

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3.5 py-4",
          collapsed && "justify-center",
        )}
      >
        {!collapsed && <UnifyOpsLogo className="w-10 h-10 flex-shrink-0" />}
        {!collapsed && (
          <div className="flex flex-col flex-1 min-w-0 leading-[1.2]">
            <span
              className="text-[12px] font-bold tracking-[-.01em] truncate"
              style={{ color: "#54A6DB" }}
            >
             UnifyOps
            </span>
            <span className="text-[11px] text-text-muted">Workspace</span>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand" : "Collapse"}
          className={cn(
            "rounded-[4px] flex items-center justify-center text-text-muted transition-all duration-[var(--dur)] hover:bg-bg-hover hover:text-text",
            collapsed ? "w-8 h-8" : "w-6 h-6",
          )}
        >
          <PanelLeft className={cn(collapsed ? "w-4 h-4" : "w-3.5 h-3.5")} />
        </button>
      </div>

      <WorkspaceSwitcher collapsed={collapsed} />

      <button
        type="button"
        onClick={() => setPalette(true)}
        className={cn(
          "flex items-center gap-2 mx-2.5 mb-2.5 px-2.5 py-1.5 bg-bg-subtle border border-border rounded-sm text-[12px] text-text-muted",
          "transition-colors duration-[var(--dur)] hover:border-accent hover:text-text",
          collapsed && "justify-center px-0 py-2",
        )}
      >
        <Search className="w-3 h-3" />
        {!collapsed && <span className="flex-1 text-left">Quick jump</span>}
        {!collapsed && (
          <kbd className="font-mono text-[11px] bg-bg-hover border border-border rounded px-1.5 py-px text-text-muted">
            ⌘K
          </kbd>
        )}
      </button>

      {assistant?.enabled && (
        <button
          type="button"
          onClick={() => openAssistant()}
          title="Ask AI"
          className={cn(
            "flex items-center gap-2 mx-2.5 mb-2.5 px-2.5 py-1.5 rounded-sm text-[12px] font-medium text-accent-700 dark:text-[var(--a-200)]",
            "bg-accent-50 dark:bg-[rgba(99,102,241,.15)] border border-accent/30",
            "transition-colors duration-[var(--dur)] hover:border-accent",
            collapsed && "justify-center px-0 py-2",
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {!collapsed && <span className="flex-1 text-left">Ask AI</span>}
          {!collapsed && (
            <kbd className="font-mono text-[11px] bg-bg-hover border border-border rounded px-1.5 py-px text-text-muted">
              ⌘/
            </kbd>
          )}
        </button>
      )}

      <SidebarNav>
        {NAV.map(({ section, items }) => {
          const visible = items.filter(
            (i) =>
              (!i.adminOnly || isAdmin) &&
              (!i.superAdminOnly || isSuperAdmin) &&
              (!i.assistantOnly || !!assistant?.enabled),
          )
          if (visible.length === 0) return null
          return (
            <SidebarSection key={section} label={section} collapsed={collapsed}>
              {visible.map((item) => {
                // Workspace-scoped items render as /[slug]/… , and must stay
                // active on both that and the legacy flat path (which redirects).
                const href = item.workspaceScoped ? ws(item.href) : item.href
                const active =
                  pathname === href ||
                  pathname.startsWith(href + "/") ||
                  (item.workspaceScoped &&
                    (pathname === item.href ||
                      pathname.startsWith(item.href + "/")))
                return (
                  <SidebarItem
                    key={item.href}
                    as={Link}
                    href={href}
                    icon={<item.Icon className="w-4 h-4" />}
                    label={item.label}
                    active={!!active}
                    collapsed={collapsed}
                    badge={item.badge ? (badges?.[item.badge] ?? 0) : 0}
                  />
                )
              })}
            </SidebarSection>
          )
        })}
      </SidebarNav>

      {isInstanceAdmin && (
        <div className="px-2.5 pb-3 pt-1 border-t border-[color:var(--sidebar-border)]">
          <SidebarItem
            as="a"
            href={`${ADMIN_URL}/god-mode`}
            target="_blank"
            rel="noopener noreferrer"
            title="God Mode — instance admin"
            icon={<ShieldCheck className="w-4 h-4" />}
            label="God Mode"
            collapsed={collapsed}
          />
        </div>
      )}
    </>
  )
}
