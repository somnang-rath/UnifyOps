'use client';
import { useState } from 'react';
import { Save } from 'lucide-react';
import { useRetentionSettings, useErrorLogMutations } from '@/hooks/use-error-logs';

const RETENTION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
];

export function RetentionSettings() {
  const { data } = useRetentionSettings();
  const { updateRetention } = useErrorLogMutations();
  const [value, setValue] = useState<number | null>(null);

  const current = value ?? data?.retentionDays ?? 90;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4">
      <h3 className="text-[12px] font-semibold text-text mb-3">Auto-Cleanup Settings</h3>
      <p className="text-[11px] text-text-muted mb-3">
        Logs older than the retention period are automatically deleted every night.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={current}
          onChange={(e) => setValue(Number(e.target.value))}
          className="h-8 rounded-sm border border-border bg-bg-card px-2 text-[12px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {RETENTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => updateRetention.mutate(current)}
          disabled={updateRetention.isPending}
          className="flex items-center gap-1.5 h-8 px-3 rounded bg-accent hover:bg-accent-600 text-white text-[12px] font-medium disabled:opacity-40 transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {updateRetention.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
