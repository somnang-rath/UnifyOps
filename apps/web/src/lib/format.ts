export const today = () => new Date().toISOString().slice(0, 10);

export const isoDay = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

export const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000,
  );

/*
 * `fmtDate`, `fmtDateShort`, `monthLabel` and `relTime` used to live here as
 * locale-blind helpers. They are gone on purpose (ADR 0016 §2.7): a date helper
 * with no locale argument is a helper that can only ever render English, and
 * keeping the names as thin wrappers would have let every one of their 93 call
 * sites keep compiling while quietly staying English.
 *
 * The replacement is `useFormat()` from `@prism/i18n` — `f.date`, `f.dateShort`,
 * `f.monthYear`, `f.relative`. Everything still here is genuinely locale-free:
 * ISO keys, arithmetic, initials, byte sizes, and the calendar grid builders.
 */

export const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const greetingTod = () => {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
};

export const fmtBytes = (n: number) => {
  if (!n) return '0 B';
  const k = 1024;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${(n / k ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

export interface CalendarCell {
  date: Date;
  iso: string;
  otherMonth: boolean;
  today: boolean;
}

export function buildCalendarMonth(
  year: number,
  month: number,
): CalendarCell[] {
  const todayIso = isoDay(new Date());
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let i = firstDay; i > 0; i--) {
    const d = new Date(year, month, 1 - i);
    cells.push({
      date: d,
      iso: isoDay(d),
      otherMonth: true,
      today: false,
    });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    const iso = isoDay(d);
    cells.push({
      date: d,
      iso,
      otherMonth: false,
      today: iso === todayIso,
    });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const d = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate() + 1,
    );
    cells.push({
      date: d,
      iso: isoDay(d),
      otherMonth: true,
      today: false,
    });
  }
  return cells.slice(0, 42);
}

/** Seven cells for the Sunday→Saturday week containing `anchor`. */
export function buildCalendarWeek(anchor: Date): CalendarCell[] {
  const todayIso = isoDay(new Date());
  const month = anchor.getMonth();
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - anchor.getDay()); // back to Sunday
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoDay(d);
    cells.push({
      date: d,
      iso,
      otherMonth: d.getMonth() !== month,
      today: iso === todayIso,
    });
  }
  return cells;
}
