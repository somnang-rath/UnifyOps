'use client';
import { type ReactNode, useEffect } from 'react';
import Link from 'next/link';
import {
  useParams,
  useRouter,
  useSelectedLayoutSegment,
} from 'next/navigation';
import {
  ArrowLeft,
  CircleDashed,
  FileText,
  Globe,
  Layers,
  LayoutGrid,
  Lock,
  RefreshCcw,
  Settings,
  Users,
} from 'lucide-react';
import { useProject } from '@/hooks/use-projects';
import { useWorkspaceHref, useWorkspaces } from '@/hooks/use-workspaces';
import { Avatar } from '@/components/ui/avatar';
import { useUsers } from '@/hooks/use-users';
import { initials } from '@/lib/format';
import { ProjectDetailSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** The Plane-style project sub-navigation. `soon` items render a placeholder page. */
const NAV = [
  { seg: 'overview', label: 'Overview', Icon: FileText },
  { seg: 'work-items', label: 'Work items', Icon: LayoutGrid },
  { seg: 'cycles', label: 'Cycles', Icon: RefreshCcw },
  { seg: 'modules', label: 'Modules', Icon: Layers },
  { seg: 'views', label: 'Views', Icon: CircleDashed },
  { seg: 'pages', label: 'Pages', Icon: FileText },
  { seg: 'settings', label: 'Settings', Icon: Settings },
] as const;

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id, workspaceSlug } = useParams<{ id: string; workspaceSlug: string }>();
  const router = useRouter();
  const ws = useWorkspaceHref();
  const activeSegment = useSelectedLayoutSegment();
  const { data: project, isLoading } = useProject(id);
  const { data: users = [] } = useUsers();
  const { data: workspaces = [] } = useWorkspaces();

  // Keep the URL honest (ADR 0006): reading a project only proves access, not
  // that it lives in the workspace the URL names — so /acme/projects/<gamma-id>
  // would otherwise render gamma's project under acme's address. Send it to the
  // workspace the project actually belongs to.
  const trueSlug = project?.workspaceId
    ? workspaces.find((w) => w.id === project.workspaceId)?.slug
    : undefined;
  const mismatched = !!trueSlug && trueSlug !== workspaceSlug;

  useEffect(() => {
    if (mismatched) router.replace(`/${trueSlug}/projects/${id}`);
  }, [mismatched, trueSlug, id, router]);

  if (isLoading || !project || mismatched) return <ProjectDetailSkeleton />;

  const userMap = new Map(users.map((u) => [u._id, u]));
  const members = [project.ownerId, ...project.members]
    .map((mid) => userMap.get(mid))
    .filter(Boolean) as Array<{ _id: string; name: string; avatar?: string }>;

  const VisibilityIcon =
    project.visibility === 'public'
      ? Globe
      : project.visibility === 'internal'
        ? Users
        : Lock;

  // The child segment under /[workspaceSlug]/projects/[id]/… . Read from the
  // router rather than by indexing the pathname — an index breaks the moment the
  // route's depth changes, which is exactly what the [workspaceSlug] move did.
  const active = activeSegment ?? 'overview';

  return (
    <div className="flex flex-col min-h-0">
      <Link
        href={ws('/projects')}
        className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text mb-4 w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All projects
      </Link>

      {/* Project header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-11 h-11 rounded-[11px] flex items-center justify-center text-white font-bold text-[16px] flex-shrink-0 shadow-[0_4px_12px_rgba(99,102,241,.25)]"
            style={{ background: project.color }}
          >
            {initials(project.name)}
          </div>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-[-.02em] leading-[1.2] truncate">
              {project.name}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[12px] text-text-muted font-mono">
                {project.namespace}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-text-muted capitalize px-1.5 py-0.5 bg-bg-subtle border border-border rounded-full">
                <VisibilityIcon className="w-3 h-3" />
                {project.visibility}
              </span>
            </div>
          </div>
        </div>
        {members.length > 0 && (
          <div className="flex items-center flex-shrink-0">
            {members.slice(0, 5).map((u) => (
              <Avatar
                key={u._id}
                name={u.name}
                src={u.avatar}
                size="sm"
                className="border-2 border-bg -ml-2 first:ml-0"
              />
            ))}
            {members.length > 5 && (
              <span className="ml-1 text-[11px] text-text-muted">
                +{members.length - 5}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sub-navigation */}
      <nav className="flex items-center gap-1 border-b border-border mb-5 overflow-x-auto">
        {NAV.map(({ seg, label, Icon }) => {
          const isActive = active === seg;
          return (
            <Link
              key={seg}
              href={ws(`/projects/${id}/${seg}`)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-accent text-text'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
