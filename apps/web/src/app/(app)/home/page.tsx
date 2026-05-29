'use client';
import { useMemo } from 'react';
import { useDashboard } from '@/hooks/use-dashboard';
import { useIssueMutations } from '@/hooks/use-issues';
import { useProjects } from '@/hooks/use-projects';
import { useAuthStore } from '@/stores/auth-store';
import { AdminDashboard } from './home-admin';
import { UserDashboard } from './home-user';

export default function HomePage() {
  const user = useAuthStore((s) => s.user)!;
  const { data, isLoading } = useDashboard();
  const { data: projects = [] } = useProjects();
  const { update: updateIssue } = useIssueMutations();

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p._id, { _id: p._id, name: p.name, color: p.color }])),
    [projects],
  );

  if (user.role === 'admin') {
    return <AdminDashboard user={user} overview={data} isLoading={isLoading} />;
  }

  return (
    <UserDashboard
      user={user}
      overview={data}
      isLoading={isLoading}
      projectById={projectById}
      onQuickDone={(id) => updateIssue.mutate({ id, body: { status: 'done' } })}
    />
  );
}
