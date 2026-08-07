'use client';
import { useEffect, useState } from 'react';
import { CalendarClock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Confirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import {
  ALL_BACKUP_SCOPES,
  BACKUP_SCOPE_LABELS,
  type BackupFrequency,
  type BackupScope,
} from '@/schemas/backup';
import { useBackupSchedule, useBackupMutations } from '@/hooks/use-backup';

const FREQ_OPTS = [
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

const DOW_OPTS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const DOM_OPTS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

// Build timezone list from the browser
const TZ_OPTS = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] })
      .supportedValuesOf('timeZone')
      .map((tz) => ({ value: tz, label: tz }));
  } catch {
    return [{ value: 'UTC', label: 'UTC' }];
  }
})();

export function BackupScheduleCard() {
  const f = useFormat();
  const { data: schedule, isLoading } = useBackupSchedule();
  const { upsertSchedule, deleteSchedule } = useBackupMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [enabled,      setEnabled]      = useState(false);
  const [frequency,    setFrequency]    = useState<BackupFrequency>('weekly');
  const [time,         setTime]         = useState('02:00');
  const [dayOfWeek,    setDayOfWeek]    = useState(0);
  const [dayOfMonth,   setDayOfMonth]   = useState(1);
  const [timezone,     setTimezone]     = useState('UTC');
  const [scopes,       setScopes]       = useState<BackupScope[]>([...ALL_BACKUP_SCOPES]);
  const [fileName,     setFileName]     = useState('Backup UnifyOps');

  // Populate form from saved schedule on load
  useEffect(() => {
    if (!schedule) return;
    setEnabled(schedule.enabled);
    setFrequency(schedule.frequency);
    setTime(schedule.time);
    setDayOfWeek(schedule.dayOfWeek);
    setDayOfMonth(schedule.dayOfMonth);
    setTimezone(schedule.timezone);
    setScopes(schedule.scopes);
    setFileName(schedule.fileName);
  }, [schedule]);

  const toggleScope = (scope: BackupScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const handleSave = () => {
    upsertSchedule.mutate({
      enabled,
      frequency,
      time,
      dayOfWeek,
      dayOfMonth,
      timezone,
      scopes,
      passwordMode: 'none',
      fileName: fileName.trim() || 'Backup UnifyOps',
    });
  };

  const fmtDate = (iso?: string) => (iso ? f.dateTime(iso) : '—');

  return (
    <>
      <Confirm
        open={confirmDelete}
        title="Disable auto-backup?"
        body="This will remove your backup schedule. Stored backup files are not affected."
        danger
        onConfirm={() => { deleteSchedule.mutate(undefined); setConfirmDelete(false); }}
        onClose={() => setConfirmDelete(false)}
      />

      <section className="bg-bg-card border border-border rounded-lg p-6 flex flex-col gap-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-text-muted" />
              Auto-Backup Schedule
            </h3>
            <p className="text-[13px] text-text-muted mt-0.5">
              Generate and store backup files automatically.
            </p>
          </div>
          {schedule?.lastRunAt && (
            <span className="text-[11.5px] text-text-muted whitespace-nowrap mt-1">
              Last run: {fmtDate(schedule.lastRunAt)}
            </span>
          )}
        </header>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => <div key={i} className="h-9 rounded bg-bg-hover" />)}
          </div>
        ) : (
          <>
            {/* Enable toggle */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((e) => !e)}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors duration-[var(--dur)]',
                  enabled ? 'bg-accent' : 'bg-bg-hover',
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-[var(--dur)]',
                  enabled && 'translate-x-4',
                )} />
              </button>
              <span className="text-[13px] font-medium">
                {enabled ? 'Auto-backup enabled' : 'Auto-backup disabled'}
              </span>
            </label>

            {enabled && (
              <>
                {/* Frequency + time */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Frequency">
                    <Select
                      value={frequency}
                      onValueChange={(v) => setFrequency(v as BackupFrequency)}
                      options={FREQ_OPTS as unknown as { value: string; label: string }[]}
                    />
                  </Field>

                  {frequency === 'weekly' && (
                    <Field label="Day of week">
                      <Select
                        value={String(dayOfWeek)}
                        onValueChange={(v) => setDayOfWeek(Number(v))}
                        options={DOW_OPTS}
                      />
                    </Field>
                  )}

                  {frequency === 'monthly' && (
                    <Field label="Day of month">
                      <Select
                        value={String(dayOfMonth)}
                        onValueChange={(v) => setDayOfMonth(Number(v))}
                        options={DOM_OPTS}
                      />
                    </Field>
                  )}

                  <Field label="Time (24h)">
                    <Input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </Field>

                  <Field label="Timezone">
                    <Select
                      value={timezone}
                      onValueChange={setTimezone}
                      options={TZ_OPTS}
                    />
                  </Field>
                </div>

                {/* File name */}
                <Field label="File name" hint=".prismback appended">
                  <Input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="Backup UnifyOps"
                    maxLength={120}
                    className="max-w-[320px]"
                  />
                </Field>

                {/* Scope picker */}
                <div className="flex flex-col gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-[.06em] text-text-muted">
                    Include data
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ALL_BACKUP_SCOPES.map((scope) => {
                      const checked = scopes.includes(scope);
                      return (
                        <label
                          key={scope}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer select-none transition-colors',
                            checked
                              ? 'border-accent bg-accent-50 dark:bg-[rgba(99,102,241,.1)]'
                              : 'border-border hover:border-accent/50',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-[var(--a)] w-3.5 h-3.5"
                            checked={checked}
                            onChange={() => toggleScope(scope)}
                          />
                          <span className="text-[12.5px] font-medium truncate">
                            {BACKUP_SCOPE_LABELS[scope]}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Next run */}
                {schedule?.nextRunAt && (
                  <p className="text-[12px] text-text-muted">
                    Next scheduled backup:{' '}
                    <span className="text-text font-medium">{fmtDate(schedule.nextRunAt)}</span>
                  </p>
                )}
              </>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={upsertSchedule.isPending}
              >
                {upsertSchedule.isPending ? 'Saving…' : 'Save schedule'}
              </Button>
              {schedule && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleteSchedule.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove schedule
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}
