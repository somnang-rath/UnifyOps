'use client';
import type { ReportSchedule, ReportFrequency } from '@/schemas/report';
import { Calendar, Clock, Globe, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  schedule: ReportSchedule;
  onChange: (s: ReportSchedule) => void;
}

const FREQUENCIES: { value: ReportFrequency; label: string; sub: string }[] = [
  { value: 'daily',   label: 'Daily',   sub: 'Every day' },
  { value: 'weekly',  label: 'Weekly',  sub: 'Once a week' },
  { value: 'monthly', label: 'Monthly', sub: 'Once a month' },
  { value: 'yearly',  label: 'Yearly',  sub: 'Once a year' },
];

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Browser's UTC offset in whole hours (e.g. +7 for ICT, -5 for EST). */
function getLocalOffsetHours(): number {
  return -new Date().getTimezoneOffset() / 60;
}

/** Convert a UTC hour (0-23) → local-clock hour. */
function utcToLocal(utcH: number): number {
  const off = getLocalOffsetHours();
  return ((utcH + off) % 24 + 24) % 24;
}

/** Convert a local-clock hour (0-23) → UTC hour. */
function localToUtc(localH: number): number {
  const off = getLocalOffsetHours();
  return ((localH - off) % 24 + 24) % 24;
}

/** Friendly timezone label shown next to the time picker. */
function tzLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = getLocalOffsetHours();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    const hh = String(Math.floor(abs)).padStart(2, '0');
    const mm = String((abs % 1) * 60).padStart(2, '0');
    return `${tz} (UTC${sign}${hh}:${mm})`;
  } catch {
    return `UTC${getLocalOffsetHours() >= 0 ? '+' : ''}${getLocalOffsetHours()}`;
  }
}

function humanSummary(s: ReportSchedule): string {
  if (!s.enabled) return 'Disabled — run manually only';
  const localH = utcToLocal(s.hour);
  const suffix = localH < 12 ? 'AM' : 'PM';
  const h12 = localH % 12 === 0 ? 12 : localH % 12;
  const time = `${h12}:00 ${suffix}`;

  if (s.frequency === 'daily')   return `Every day at ${time}`;
  if (s.frequency === 'weekly') {
    const day = DAYS[s.dayOfWeek ?? 1];
    return `Every ${day} at ${time}`;
  }
  if (s.frequency === 'monthly') {
    const d = s.dayOfMonth ?? 1;
    const ord = d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`;
    return `${ord} of every month at ${time}`;
  }
  if (s.frequency === 'yearly') {
    const m = MONTHS[(s.month ?? 1) - 1];
    const d = s.dayOfMonth ?? 1;
    return `${m} ${d} every year at ${time}`;
  }
  return '';
}

export function SchedulePanel({ schedule, onChange }: Props) {
  const set = (patch: Partial<ReportSchedule>) => onChange({ ...schedule, ...patch });

  // Display value is LOCAL hour; we convert to UTC before saving
  const displayHour = utcToLocal(schedule.hour);

  const handleHourChange = (localH: number) => {
    set({ hour: localToUtc(localH) });
  };

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-bg-subtle/50">
        <div className="flex items-center gap-2">
          <Zap className={cn('w-4 h-4', schedule.enabled ? 'text-green-500' : 'text-text-muted')} />
          <div>
            <div className="text-xs font-semibold">Auto-schedule</div>
            <div className="text-[10px] text-text-muted">Send report automatically</div>
          </div>
        </div>
        <button
          onClick={() => set({ enabled: !schedule.enabled })}
          className={cn(
            'relative w-10 h-5 rounded-full transition-colors flex-shrink-0',
            schedule.enabled ? 'bg-accent-600' : 'bg-bg-subtle border border-border',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
              schedule.enabled ? 'left-[calc(100%-18px)]' : 'left-0.5',
            )}
          />
        </button>
      </div>

      {/* Summary pill */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors',
        schedule.enabled
          ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
          : 'bg-bg-subtle text-text-muted border border-border',
      )}>
        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium">{humanSummary(schedule)}</span>
      </div>

      {schedule.enabled && (
        <>
          {/* Frequency */}
          <div>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Frequency
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  onClick={() => set({ frequency: f.value })}
                  className={cn(
                    'text-left px-3 py-2 rounded-lg border transition-all',
                    schedule.frequency === f.value
                      ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 shadow-sm'
                      : 'border-border hover:border-accent-300 hover:bg-bg-hover',
                  )}
                >
                  <div className={cn(
                    'text-xs font-semibold',
                    schedule.frequency === f.value ? 'text-accent-700 dark:text-accent-400' : 'text-text',
                  )}>
                    {f.label}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">{f.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Send time — LOCAL timezone */}
          <div>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Send time
            </div>
            {/* Timezone hint */}
            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-2">
              <Globe className="w-3 h-3 flex-shrink-0" />
              <span>{tzLabel()}</span>
            </div>
            <select
              value={displayHour}
              onChange={(e) => handleHourChange(Number(e.target.value))}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, '0')}:00 — {i < 12 ? `${i === 0 ? 12 : i} AM` : `${i === 12 ? 12 : i - 12} PM`}
                </option>
              ))}
            </select>
            {/* UTC note */}
            <div className="mt-1 text-[10px] text-text-muted/70">
              Stored as {String(schedule.hour).padStart(2, '0')}:00 UTC on the server
            </div>
          </div>

          {/* Day of week (weekly) */}
          {schedule.frequency === 'weekly' && (
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                Day of week
              </div>
              <div className="flex gap-1">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => set({ dayOfWeek: i })}
                    className={cn(
                      'flex-1 text-[10px] py-1.5 rounded-md border font-medium transition-colors',
                      schedule.dayOfWeek === i
                        ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                        : 'border-border hover:border-accent-300 text-text-muted',
                    )}
                  >
                    {d[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Day of month */}
          {(schedule.frequency === 'monthly' || schedule.frequency === 'yearly') && (
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                Day of month
              </div>
              <select
                value={schedule.dayOfMonth ?? 1}
                onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
                className="w-full text-xs px-2 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              >
                {Array.from({ length: 31 }, (_, i) => {
                  const d = i + 1;
                  const ord = d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`;
                  return <option key={d} value={d}>{ord}</option>;
                })}
              </select>
            </div>
          )}

          {/* Month (yearly) */}
          {schedule.frequency === 'yearly' && (
            <div>
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                Month
              </div>
              <select
                value={schedule.month ?? 1}
                onChange={(e) => set({ month: Number(e.target.value) })}
                className="w-full text-xs px-2 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
