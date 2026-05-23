export const today = () => new Date().toISOString().slice(0, 10);

export const isoDay = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

export const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000,
  );

export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export const fmtDateShort = (iso: string | Date) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

export const monthLabel = (d: Date) =>
  d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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

export const relTime = (iso: string | Date) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
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
