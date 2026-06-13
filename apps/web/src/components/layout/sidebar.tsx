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
  StickyNote,
  Trello,
  GitMerge,
  Users,
  Zap,
  Activity,
} from "lucide-react"
import { UnifyOpsLogo } from "@/components/icons/logo"
import { useAuthStore } from "@/stores/auth-store"
import { useUIStore } from "@/stores/ui-store"
import { useBadges } from "@/hooks/use-badges"
import { cn } from "@/lib/utils"

const SUPER_ADMIN_EMAILS = new Set(['somnang.rath12@gmail.com', 'admin@demo.com'])

type BadgeKey = 'issues' | 'mywork' | 'approvals' | 'notifications'

interface NavItem {
  href: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
  superAdminOnly?: boolean
  badge?: BadgeKey
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Workspace",
    items: [
      { href: "/home", label: "Home", Icon: Home },
      { href: "/my-work", label: "My Work", Icon: CheckSquare, badge: "mywork" },
      { href: "/projects", label: "Projects", Icon: Grid3x3 },
    ],
  },
  {
    section: "Plan & Track",
    items: [
      { href: "/issues", label: "Tasks", Icon: AlertCircle, badge: "issues" },
      { href: "/kanban", label: "Board", Icon: Trello },
      { href: "/calendar", label: "Calendar", Icon: Calendar },
      { href: "/approvals", label: "Approvals", Icon: GitMerge, badge: "approvals" },
    ],
  },
  {
    section: "Knowledge",
    items: [
      { href: "/files", label: "Storage", Icon: FileText },
      { href: "/wiki", label: "Wiki", Icon: BookOpen },
      { href: "/notes", label: "Notes", Icon: StickyNote },
      { href: "/tables", label: "Tables", Icon: Database },
      { href: "/reports", label: "Reports", Icon: FileBarChart2 },
    ],
  },
  {
    section: "People & Tools",
    items: [
      { href: "/notifications", label: "Notifications", Icon: Bell, badge: "notifications" },
      { href: "/automations", label: "Automations", Icon: Zap },
      { href: "/timeline", label: "Timeline", Icon: Activity },
      { href: "/users", label: "People", Icon: Users, adminOnly: true },
      { href: "/debug", label: "Debug & Errors", Icon: Bug, superAdminOnly: true },
      { href: "/settings", label: "Settings", Icon: SettingsIcon },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggle = useUIStore((s) => s.toggleSidebar)
  const setPalette = useUIStore((s) => s.setPalette)
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === "admin"
  const isSuperAdmin = !!user?.email && SUPER_ADMIN_EMAILS.has(user.email)
  const { data: badges } = useBadges()

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col h-screen border-r border-[color:var(--sidebar-border)]",
        "bg-[color:var(--sidebar-bg)] backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(.4,0,.2,1)]",
        collapsed ? "w-sb-collapsed" : "w-sb",
      )}
    >
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

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4 flex flex-col gap-0.5">
        {NAV.map(({ section, items }) => {
          const visible = items.filter(
            (i) =>
              (!i.adminOnly || isAdmin) &&
              (!i.superAdminOnly || isSuperAdmin),
          )
          if (visible.length === 0) return null
          return (
            <div key={section} className="flex flex-col gap-0.5">
              {!collapsed && (
                <span className="px-2.5 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-text-muted">
                  {section}
                </span>
              )}
              {visible.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/")
                const count = item.badge ? (badges?.[item.badge] ?? 0) : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-[13px] font-medium text-text-sub",
                      "transition-all duration-[var(--dur)] ease-[cubic-bezier(.4,0,.2,1)] hover:bg-bg-hover hover:text-text",
                      active &&
                        "bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.15)] dark:text-[var(--a-200)]",
                      collapsed && "justify-center px-2",
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {active && (
                      <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-[2px] bg-accent" />
                    )}
                    <div className="relative flex-shrink-0">
                      <item.Icon
                        className={cn(
                          "w-4 h-4 transition-colors duration-[var(--dur)]",
                          active
                            ? "text-accent dark:text-[var(--a-400)]"
                            : "text-text-muted group-hover:text-text",
                        )}
                      />
                      {collapsed && count > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-accent text-white text-[9px] font-bold px-[3px]">
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                    </div>
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {!collapsed && count > 0 && (
                      <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold px-1">
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
