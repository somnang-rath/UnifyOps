'use client';
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isoDay, monthLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { STATUS_DOT, STATUS_ORDER, type StatusId, type ViewProps } from './shared';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({ issues }: ViewProps) {
  const router = useRouter();
  const slug = useParams<{ workspaceSlug: string }>().workspaceSlug;
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDay = useMemo(() => {
    const map = new Map<string, typeof issues>();
    for (const i of issues) {
      if (!i.dueDate) continue;
      const key = isoDay(new Date(i.dueDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [issues]);

  // Build a 6-week grid starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      return d;
    });
  }, [cursor]);

  const todayKey = isoDay(new Date());

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold">{monthLabel(cursor)}</h3>
        <div className="flex items-center gap-1">
          <NavBtn
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
          >
            <ChevronLeft className="w-4 h-4" />
          </NavBtn>
          <button
            onClick={() => {
              const d = new Date();
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
            className="px-2.5 py-1 text-[12px] rounded-sm border border-border hover:bg-bg-hover"
          >
            Today
          </button>
          <NavBtn
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
          >
            <ChevronRight className="w-4 h-4" />
          </NavBtn>
        </div>
      </div>

      <div className="grid grid-cols-7 border-l border-t border-border rounded-lg overflow-hidden">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-1.5 text-[11px] font-semibold text-text-muted bg-bg-subtle border-r border-b border-border text-center"
          >
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const key = isoDay(d);
          const dayItems = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          return (
            <div
              key={key}
              className={cn(
                'min-h-[92px] p-1.5 border-r border-b border-border align-top',
                !inMonth && 'bg-bg-subtle/40',
              )}
            >
              <div
                className={cn(
                  'text-[11px] mb-1 w-5 h-5 flex items-center justify-center rounded-full',
                  key === todayKey
                    ? 'bg-accent text-white font-semibold'
                    : inMonth
                      ? 'text-text-sub'
                      : 'text-text-muted',
                )}
              >
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayItems.slice(0, 3).map((i) => {
                  const s = (STATUS_ORDER as readonly string[]).includes(
                    i.status,
                  )
                    ? (i.status as StatusId)
                    : 'todo';
                  return (
                    <button
                      key={i._id}
                      onClick={() => router.push(`/${slug}/issues/${i._id}`)}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-[11px] text-left hover:bg-bg-hover truncate w-full"
                    >
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full flex-shrink-0',
                          STATUS_DOT[s],
                        )}
                      />
                      <span className="truncate">{i.title}</span>
                    </button>
                  );
                })}
                {dayItems.length > 3 && (
                  <span className="px-1 text-[10px] text-text-muted">
                    +{dayItems.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded-sm border border-border text-text-muted hover:bg-bg-hover hover:text-text"
    >
      {children}
    </button>
  );
}
