'use client';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import type { ErrorLog } from '@/schemas/error-log';

interface ErrorDetailDrawerProps {
  log: ErrorLog | null;
  onClose: () => void;
  onResolve: (id: string) => void;
  resolving: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4 mt-4 first:border-t-0 first:mt-0 first:pt-0">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex gap-2 mb-2 text-[12px]">
      <span className="w-32 flex-shrink-0 text-text-muted">{label}</span>
      <span className="text-text break-all">{String(value)}</span>
    </div>
  );
}

function CodeBlock({ label, content }: { label: string; content?: string | null }) {
  if (!content) return null;
  return (
    <div className="mb-3">
      <div className="text-[10px] font-semibold text-text-muted mb-1 uppercase tracking-wider">{label}</div>
      <pre className="bg-bg-subtle border border-border rounded p-3 text-[11px] text-text overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
        {content}
      </pre>
    </div>
  );
}

function JsonBlock({ label, data }: { label: string; data?: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <CodeBlock label={label} content={JSON.stringify(data, null, 2)} />
  );
}

export function ErrorDetailDrawer({ log, onClose, onResolve, resolving }: ErrorDetailDrawerProps) {
  const f = useFormat();
  const fmtDate = (iso?: string) => (iso ? f.dateTime(iso) : '—');

  if (!log) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-bg-card border-l border-border shadow-lg flex flex-col animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text truncate">{log.errorTitle}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{fmtDate(log.createdAt)}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!log.resolvedStatus && (
              <button
                type="button"
                onClick={() => onResolve(log._id)}
                disabled={resolving}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-medium disabled:opacity-40 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Resolve
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-[12px]">
          <Section title="Error Details">
            <Row label="Source" value={log.source} />
            <Row label="Type" value={log.logType} />
            <Row label="Status Code" value={log.statusCode} />
            <Row label="Status" value={log.resolvedStatus ? 'Resolved' : 'Open'} />
            <CodeBlock label="Error Message" content={log.errorMessage} />
            <CodeBlock label="Stack Trace" content={log.stackTrace} />
          </Section>

          <Section title="Request Information">
            <Row label="Endpoint" value={log.endpointUrl} />
            <Row label="Page Route" value={log.pageRoute} />
            <JsonBlock label="Request Payload" data={log.requestPayload} />
            <JsonBlock label="Response Payload" data={log.responsePayload} />
          </Section>

          <Section title="User Information">
            <Row label="User ID" value={log.userId} />
            <Row label="Email" value={log.userEmail} />
          </Section>

          <Section title="Device Information">
            <Row label="Browser" value={log.browser} />
            <Row label="OS" value={log.operatingSystem} />
            <Row label="Device" value={log.deviceType} />
            <Row label="App Version" value={log.applicationVersion} />
          </Section>

          <Section title="Resolution">
            <Row label="Resolved" value={log.resolvedStatus ? 'Yes' : 'No'} />
            <Row label="Resolved At" value={fmtDate(log.resolvedAt)} />
            <Row label="Resolved By" value={log.resolvedBy} />
          </Section>

          <Section title="Timeline">
            <Row label="Created" value={fmtDate(log.createdAt)} />
            <Row label="Updated" value={fmtDate(log.updatedAt)} />
          </Section>
        </div>
      </div>
    </>
  );
}
