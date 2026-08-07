'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Trash2,
  Globe,
  Server,
  AlertCircle,
  AlertTriangle,
  Bug,
  Info,
  Monitor,
  Smartphone,
  Tablet,
  Clock,
  User,
  MapPin,
  Activity,
} from 'lucide-react';
import { useErrorLogById, useErrorLogMutations } from '@/hooks/use-error-logs';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import type { ErrorLog } from '@/schemas/error-log';

// ── Helpers ────────────────────────────────────────────────────────────────

const SOURCE_STYLES = {
  frontend: {
    icon: Globe,
    cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    label: 'Frontend',
  },
  backend: {
    icon: Server,
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
    label: 'Backend',
  },
} as const;

const TYPE_STYLES = {
  error: { icon: AlertCircle, cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', label: 'Error' },
  warning: { icon: AlertTriangle, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', label: 'Warning' },
  debug: { icon: Bug, cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', label: 'Debug' },
  info: { icon: Info, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', label: 'Info' },
} as const;

const DEVICE_ICONS = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  unknown: Monitor,
} as const;

/**
 * Error logs are read against a clock — the second matters — so this is the one
 * screen that pairs the locale's date with a seconds-precision time.
 */
function useFmtDate() {
  const f = useFormat();
  return (iso?: string) => (iso ? `${f.date(iso)}, ${f.timeWithSeconds(iso)}` : '—');
}

// ── UI primitives ──────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-bg-card', className)}>
      {children}
    </div>
  );
}

function CardHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border">
      <div className="text-text-muted">{icon}</div>
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
    </div>
  );
}

function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4">{children}</div>;
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-4 py-1.5 border-b border-border/40 last:border-b-0">
      <span className="text-[12px] text-text-muted self-start pt-px">{label}</span>
      <span className="text-[12px] text-text break-all">{value != null && value !== '' ? String(value) : '—'}</span>
    </div>
  );
}

function CodeBlock({ title, content }: { title: string; content?: string | null }) {
  if (!content) return null;
  return (
    <div className="mt-4 first:mt-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">{title}</div>
      <pre className="bg-bg-subtle border border-border rounded-lg p-4 text-[11px] leading-relaxed text-text overflow-x-auto whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
        {content}
      </pre>
    </div>
  );
}

function JsonBlock({ title, data }: { title: string; data?: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return null;
  return <CodeBlock title={title} content={JSON.stringify(data, null, 2)} />;
}

function StatusBadge({ resolved }: { resolved: boolean }) {
  return resolved ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      <CheckCircle2 className="w-3.5 h-3.5" /> Resolved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertCircle className="w-3.5 h-3.5" /> Open
    </span>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────

function Timeline({ log }: { log: ErrorLog }) {
  const fmtDate = useFmtDate();
  const events: { label: string; date?: string; icon: React.ReactNode; active?: boolean }[] = [
    {
      label: 'Error occurred',
      date: log.createdAt,
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      active: true,
    },
    {
      label: 'Last updated',
      date: log.updatedAt,
      icon: <Activity className="w-3.5 h-3.5" />,
    },
    ...(log.resolvedAt
      ? [
          {
            label: 'Resolved',
            date: log.resolvedAt,
            icon: <CheckCircle2 className="w-3.5 h-3.5" />,
            active: true,
          },
        ]
      : []),
  ];

  return (
    <div className="relative pl-5 space-y-4">
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />
      {events.map((e, i) => (
        <div key={i} className="flex gap-3 items-start">
          <div
            className={cn(
              'relative z-10 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center -ml-5 mt-0.5',
              e.active
                ? 'bg-accent text-white'
                : 'bg-bg-subtle border border-border text-text-muted',
            )}
          >
            {e.icon}
          </div>
          <div>
            <div className="text-[12px] font-medium text-text">{e.label}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{fmtDate(e.date)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ErrorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const fmtDate = useFmtDate();
  const router = useRouter();
  const { data: log, isLoading } = useErrorLogById(id);
  const { resolve, remove } = useErrorLogMutations();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-text-muted text-[13px]">
        Loading…
      </div>
    );
  }

  if (!log) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <AlertCircle className="w-10 h-10 text-text-muted" />
        <div className="text-[13px] text-text-muted">Log not found.</div>
        <Link href="/debug" className="text-[12px] text-accent hover:underline">
          Back to Debug
        </Link>
      </div>
    );
  }

  const src = SOURCE_STYLES[log.source] ?? SOURCE_STYLES.backend;
  const typ = TYPE_STYLES[log.logType] ?? TYPE_STYLES.error;
  const SrcIcon = src.icon;
  const TypIcon = typ.icon;
  const DeviceIcon = DEVICE_ICONS[log.deviceType ?? 'unknown'];

  const handleResolve = async () => {
    await resolve.mutateAsync(id);
  };

  const handleDelete = async () => {
    await remove.mutateAsync(id);
    router.push('/debug');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fade-in">

      {/* ── Back + Actions ── */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/debug"
          className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Debug
        </Link>
        <div className="flex items-center gap-2">
          {!log.resolvedStatus && (
            <button
              type="button"
              onClick={handleResolve}
              disabled={resolve.isPending}
              className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-medium disabled:opacity-40 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {resolve.isPending ? 'Resolving…' : 'Mark Resolved'}
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={remove.isPending}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-red-500 hover:bg-red-600 text-white text-[12px] font-medium disabled:opacity-40 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* ── Hero header ── */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide', src.cls)}>
                  <SrcIcon className="w-3 h-3" />{src.label}
                </span>
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide', typ.cls)}>
                  <TypIcon className="w-3 h-3" />{typ.label}
                </span>
                {log.statusCode && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-bg-subtle border border-border text-text-muted">
                    HTTP {log.statusCode}
                  </span>
                )}
                <StatusBadge resolved={log.resolvedStatus} />
              </div>
              <h1 className="text-[18px] font-bold text-text leading-tight">{log.errorTitle}</h1>
              <p className="text-[13px] text-text-muted mt-1">{log.errorMessage}</p>
            </div>
            <div className="text-right text-[11px] text-text-muted flex-shrink-0">
              <div className="flex items-center gap-1 justify-end">
                <Clock className="w-3 h-3" />
                {fmtDate(log.createdAt)}
              </div>
              <div className="mt-0.5 font-mono text-[10px]">{log._id}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left column (2/3) ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Error detail */}
          <Card>
            <CardHeader title="Error Detail" icon={<AlertCircle className="w-4 h-4" />} />
            <CardBody>
              <CodeBlock title="Error Message" content={log.errorMessage} />
              <CodeBlock title="Stack Trace" content={log.stackTrace} />
            </CardBody>
          </Card>

          {/* Request / Response */}
          <Card>
            <CardHeader title="Request & Response" icon={<Activity className="w-4 h-4" />} />
            <CardBody>
              <div className="space-y-1 mb-4">
                <Field label="Endpoint URL" value={log.endpointUrl} />
                <Field label="Page Route" value={log.pageRoute} />
              </div>
              <JsonBlock title="Request Payload" data={log.requestPayload} />
              <JsonBlock title="Response Payload" data={log.responsePayload} />
              {!log.endpointUrl && !log.pageRoute && !log.requestPayload && !log.responsePayload && (
                <div className="text-[12px] text-text-muted">No request data captured.</div>
              )}
            </CardBody>
          </Card>

        </div>

        {/* ── Right column (1/3) ── */}
        <div className="space-y-5">

          {/* User info */}
          <Card>
            <CardHeader title="User" icon={<User className="w-4 h-4" />} />
            <CardBody>
              <div className="space-y-0">
                <Field label="User ID" value={log.userId} />
                <Field label="Email" value={log.userEmail} />
              </div>
            </CardBody>
          </Card>

          {/* Device */}
          <Card>
            <CardHeader title="Device" icon={<DeviceIcon className="w-4 h-4" />} />
            <CardBody>
              <div className="space-y-0">
                <Field label="Device Type" value={log.deviceType} />
                <Field label="Browser" value={log.browser} />
                <Field label="Operating System" value={log.operatingSystem} />
                <Field label="App Version" value={log.applicationVersion} />
              </div>
            </CardBody>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader title="Location" icon={<MapPin className="w-4 h-4" />} />
            <CardBody>
              <div className="space-y-0">
                <Field label="Source" value={log.source} />
                <Field label="Page Route" value={log.pageRoute} />
                <Field label="Endpoint" value={log.endpointUrl} />
              </div>
            </CardBody>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Timeline" icon={<Clock className="w-4 h-4" />} />
            <CardBody>
              <Timeline log={log} />
              {log.resolvedStatus && (
                <div className="mt-4 pt-4 border-t border-border space-y-0">
                  <Field label="Resolved by" value={log.resolvedBy} />
                  <Field label="Resolved at" value={fmtDate(log.resolvedAt)} />
                </div>
              )}
            </CardBody>
          </Card>

        </div>
      </div>
    </div>
  );
}
