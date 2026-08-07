'use client';
import { AlertCircle, AlertTriangle, Bug, CheckCircle2, Globe, Monitor, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import type { ErrorLogStats } from '@/schemas/error-log';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  const f = useFormat();
  return (
    <div className={cn('rounded-lg border border-border bg-bg-card p-4 flex items-center gap-3')}>
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-text tabular-nums">{f.number(value)}</div>
        <div className="text-xs text-text-muted mt-0.5 truncate">{label}</div>
      </div>
    </div>
  );
}

export function ErrorStats({ stats }: { stats: ErrorLogStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      <StatCard
        label="Total Errors"
        value={stats.totalErrors}
        icon={<AlertCircle className="w-5 h-5 text-red-500" />}
        color="bg-red-50 dark:bg-red-950/30"
      />
      <StatCard
        label="Warnings"
        value={stats.totalWarning}
        icon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
        color="bg-amber-50 dark:bg-amber-950/30"
      />
      <StatCard
        label="Debug Logs"
        value={stats.totalDebug}
        icon={<Bug className="w-5 h-5 text-blue-500" />}
        color="bg-blue-50 dark:bg-blue-950/30"
      />
      <StatCard
        label="Frontend"
        value={stats.frontendErrors}
        icon={<Globe className="w-5 h-5 text-violet-500" />}
        color="bg-violet-50 dark:bg-violet-950/30"
      />
      <StatCard
        label="Backend"
        value={stats.backendErrors}
        icon={<Server className="w-5 h-5 text-indigo-500" />}
        color="bg-indigo-50 dark:bg-indigo-950/30"
      />
      <StatCard
        label="Resolved"
        value={stats.resolved}
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
        color="bg-emerald-50 dark:bg-emerald-950/30"
      />
      <StatCard
        label="Unresolved"
        value={stats.unresolved}
        icon={<Monitor className="w-5 h-5 text-orange-500" />}
        color="bg-orange-50 dark:bg-orange-950/30"
      />
    </div>
  );
}
