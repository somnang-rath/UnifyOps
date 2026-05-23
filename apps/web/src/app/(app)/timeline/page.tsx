'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, AlertCircle, BookOpen, ChevronDown, ChevronRight,
  Clock, Database, FileText, GitMerge,
  LayoutGrid, Search, Sheet, StickyNote, Users, X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useProjects } from '@/hooks/use-projects';
import { useActivity, type ActivityItem, type ActivityActor } from '@/hooks/use-activity';
import { useWorkbookMutations } from '@/hooks/use-workbooks';
import { rcToA1 } from '@/lib/sheets/a1';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Project } from '@/schemas/project';
import type { Cell, CellStyle, SheetRange } from '@/schemas/workbook';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_META: Record<string, {
  Icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string; dot: string; label: string;
}> = {
  issue:    { Icon: AlertCircle, color: 'text-blue-500',   bg: 'bg-blue-500/10',   dot: 'bg-blue-500',   label: 'Issue' },
  mr:       { Icon: GitMerge,   color: 'text-purple-500', bg: 'bg-purple-500/10', dot: 'bg-purple-500', label: 'MR' },
  note:     { Icon: StickyNote, color: 'text-green-500',  bg: 'bg-green-500/10',  dot: 'bg-green-500',  label: 'Note' },
  wiki:     { Icon: BookOpen,   color: 'text-amber-500',  bg: 'bg-amber-500/10',  dot: 'bg-amber-500',  label: 'Wiki' },
  project:  { Icon: LayoutGrid, color: 'text-indigo-500', bg: 'bg-indigo-500/10', dot: 'bg-indigo-500', label: 'Project' },
  file:     { Icon: FileText,   color: 'text-rose-400',   bg: 'bg-rose-400/10',   dot: 'bg-rose-400',   label: 'File' },
  workbook: { Icon: Database,   color: 'text-teal-500',   bg: 'bg-teal-500/10',   dot: 'bg-teal-500',   label: 'Table' },
};
const entityMeta = (t: string) =>
  ENTITY_META[t] ?? { Icon: Clock, color: 'text-text-muted', bg: 'bg-bg-hover', dot: 'bg-text-muted', label: t };

const PALETTE = ['#6366f1','#8b5cf6','#3b82f6','#06b6d4','#10b981','#f59e0b','#ec4899','#f43f5e'];
const userColor = (id: string) =>
  PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

type Preset = 'today' | 'week' | 'month' | 'custom';
type TabId  = 'people' | 'projects';

// ─────────────────────────────────────────────────────────────────────────────
// Date utilities
// ─────────────────────────────────────────────────────────────────────────────

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const to  = new Date(now); to.setHours(23, 59, 59, 999);
  if (p === 'today') {
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (p === 'week') {
    const from = new Date(now); from.setDate(now.getDate() - 6); from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const from = new Date(now); from.setDate(1); from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

function getDaysInRange(from: string, to: string): string[] {
  if (!from || !to) return [];
  const days: string[] = [];
  const end = new Date(to);  end.setHours(12);
  const cur = new Date(from); cur.setHours(12);
  while (cur <= end) { days.push(cur.toLocaleDateString('en-CA')); cur.setDate(cur.getDate() + 1); }
  return days;
}

function dayLabel(key: string, total: number) {
  const d = new Date(key + 'T12:00:00');
  return total <= 7
    ? d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
    : String(d.getDate());
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const ACTION_VERB: Record<string, string> = {
  created:'created', updated:'updated', deleted:'deleted', closed:'closed',
  reopened:'reopened', commented:'commented on', merged:'merged', approved:'approved',
};
const verb = (a: string) => ACTION_VERB[a] ?? a;

// ─────────────────────────────────────────────────────────────────────────────
// Data builders
// ─────────────────────────────────────────────────────────────────────────────

interface GanttRow { actor: ActivityActor; color: string; days: Map<string, number>; total: number }

function buildGantt(items: ActivityItem[]): { rows: GanttRow[]; maxCount: number } {
  const actors = new Map<string, ActivityActor>();
  const dayCounts = new Map<string, Map<string, number>>();
  for (const item of items) {
    const actor = item.actorId;
    if (!actor?._id) continue;
    actors.set(actor._id, actor);
    if (!dayCounts.has(actor._id)) dayCounts.set(actor._id, new Map());
    const day = new Date(item.createdAt).toLocaleDateString('en-CA');
    const m = dayCounts.get(actor._id)!;
    m.set(day, (m.get(day) ?? 0) + 1);
  }
  let maxCount = 0;
  const rows: GanttRow[] = [];
  for (const [id, dayMap] of dayCounts) {
    const total = [...dayMap.values()].reduce((a, b) => a + b, 0);
    const peak  = Math.max(...dayMap.values());
    if (peak > maxCount) maxCount = peak;
    rows.push({ actor: actors.get(id)!, color: userColor(id), days: dayMap, total });
  }
  return { rows: rows.sort((a, b) => b.total - a.total), maxCount };
}

function groupByDay(items: ActivityItem[]) {
  const map = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = new Date(item.createdAt).toLocaleDateString('en-CA');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const today     = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, its]) => ({
      key,
      label: key === today ? 'Today'
           : key === yesterday ? 'Yesterday'
           : new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      items: its,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function EventRow({ item, showActor }: { item: ActivityItem; showActor?: boolean }) {
  const { Icon, color, bg, label } = entityMeta(item.entityType);
  const actor = item.actorId;
  return (
    <div className="relative flex items-start gap-3 py-2 group">
      {/* Icon dot — sits on top of the vertical line */}
      <div className={cn('shrink-0 w-[26px] h-[26px] rounded-full flex items-center justify-center ring-2 ring-bg-card z-10 mt-px', bg)}>
        <Icon className={cn('w-3 h-3', color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 leading-snug">
          {showActor && actor && (
            <span className="text-[13px] font-semibold text-text">{actor.name}</span>
          )}
          <span className="text-[12px] text-text-muted">{verb(item.action)}</span>
          <span className={cn(
            'inline-block text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded',
            color, bg,
          )}>
            {label}
          </span>
          <span className="text-[13px] font-medium text-text truncate">{item.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {showActor && actor && (
            <div className="flex items-center gap-1.5">
              <Avatar src={actor.avatar} name={actor.name} size="sm" />
              <span className="text-[10px] text-text-muted capitalize">{actor.role}</span>
            </div>
          )}
          <span className="text-[11px] text-text-muted font-mono tabular-nums">{fmtTime(item.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  value, label, sub, accent,
}: {
  value: string; label: string; sub?: string; accent?: string;
}) {
  return (
    <div
      className="flex-1 min-w-[130px] bg-bg-card border border-border rounded-xl px-5 py-4 shadow-sm relative overflow-hidden"
      style={accent ? { borderTopColor: accent, borderTopWidth: 3 } : {}}
    >
      <p className="text-[30px] font-extrabold tracking-tighter text-text leading-none truncate">{value}</p>
      <p className="text-[12.5px] font-semibold text-text-sub mt-2 leading-tight">{label}</p>
      {sub && <p className="text-[11px] text-text-muted mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gantt chart
// ─────────────────────────────────────────────────────────────────────────────

const GANTT_PAGE = 8;

function GanttChart({
  rows, days, maxCount, selectedUserId, onSelect,
}: {
  rows: GanttRow[]; days: string[]; maxCount: number;
  selectedUserId: string; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const BAR_MAX = 56;
  const colW = days.length <= 7 ? 72 : days.length <= 14 ? 48 : 32;

  const isWeekend = (key: string) => {
    const dow = new Date(key + 'T12:00:00').getDay();
    return dow === 0 || dow === 6;
  };

  const filtered = search.trim()
    ? rows.filter((r) => r.actor.name.toLowerCase().includes(search.trim().toLowerCase()))
    : rows;

  const visible = showAll ? filtered : filtered.slice(0, GANTT_PAGE);
  const hiddenCount = filtered.length - visible.length;

  if (rows.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Activity className="w-4 h-4 text-accent" />
          <span className="text-[13px] font-semibold text-text">Team Activity</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-bg-subtle border border-border text-text-muted">
            {rows.length} member{rows.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Search box — only visible when there are enough members to warrant it */}
          {rows.length > GANTT_PAGE && (
            <div className="relative flex items-center">
              <Search className="absolute left-2 w-3 h-3 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search member…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setShowAll(false); }}
                className="h-7 pl-6 pr-3 text-[11px] bg-bg-subtle border border-border rounded-lg text-text placeholder:text-text-muted outline-none focus:border-accent transition-colors w-36"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')}
                  className="absolute right-2 text-text-muted hover:text-text transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {selectedUserId && (
            <button type="button" onClick={() => onSelect('')}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline transition-colors">
              <X className="w-3 h-3" /> Clear filter
            </button>
          )}
          <span className="text-[11px] text-text-muted">{days.length} day{days.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="p-5 min-w-fit">
          {/* Day header row */}
          <div className="flex" style={{ paddingLeft: 176 }}>
            {days.map((d) => (
              <div key={d} style={{ width: colW }}
                className={cn(
                  'shrink-0 text-center text-[10px] font-medium pb-2 truncate px-0.5',
                  isWeekend(d) ? 'text-accent/50' : 'text-text-muted',
                )}>
                {dayLabel(d, days.length)}
              </div>
            ))}
          </div>

          {/* User rows */}
          <div className="flex flex-col gap-1">
            {visible.length === 0 && (
              <p className="py-6 text-center text-[12px] text-text-muted">
                No member matches &ldquo;{search}&rdquo;
              </p>
            )}
            {visible.map((row) => {
              const isSelected = selectedUserId === row.actor._id;
              const dimmed     = !!selectedUserId && !isSelected;
              return (
                <button
                  key={row.actor._id}
                  type="button"
                  onClick={() => onSelect(row.actor._id)}
                  className={cn(
                    'flex items-end w-full rounded-xl px-2 py-2 text-left transition-all duration-200',
                    isSelected
                      ? 'bg-accent/[0.06] ring-1 ring-accent/25'
                      : dimmed
                      ? 'opacity-35 hover:opacity-55'
                      : 'hover:bg-bg-subtle',
                  )}
                >
                  {/* User info column */}
                  <div className="flex items-center gap-2.5 w-[164px] shrink-0 pb-0.5">
                    <Avatar src={row.actor.avatar} name={row.actor.name} size="sm" />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[12px] font-semibold text-text truncate leading-tight">{row.actor.name}</p>
                      <p className="text-[10px] text-text-muted leading-tight">{row.total} events</p>
                    </div>
                  </div>

                  {/* Bar columns */}
                  <div className="flex items-end" style={{ height: BAR_MAX + 2 }}>
                    {days.map((d) => {
                      const count = row.days.get(d) ?? 0;
                      const h = count === 0 ? 0 : Math.max(4, Math.round((count / (maxCount || 1)) * BAR_MAX));
                      return (
                        <div key={d} style={{ width: colW }}
                          className={cn(
                            'shrink-0 flex items-end justify-center h-full',
                            isWeekend(d) ? 'bg-bg-subtle/50' : '',
                          )}>
                          <div className="relative flex items-end justify-center w-full px-[3px]"
                            style={{ height: BAR_MAX }}>
                            {count > 0 ? (
                              <div
                                title={`${count} event${count > 1 ? 's' : ''} · ${d}`}
                                style={{
                                  height: h,
                                  borderRadius: '3px 3px 0 0',
                                  background: dimmed
                                    ? 'var(--border)'
                                    : `linear-gradient(to top, ${row.color}99, ${row.color})`,
                                }}
                                className="w-full shadow-sm transition-all duration-300"
                              />
                            ) : (
                              <div className="w-full rounded-sm" style={{ height: 1, background: 'var(--border)', opacity: 0.4 }} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Show more / less toggle */}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-text-muted hover:text-accent hover:bg-bg-subtle rounded-lg transition-all"
              style={{ paddingLeft: 176 }}
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Show {hiddenCount} more member{hiddenCount !== 1 ? 's' : ''}
            </button>
          )}
          {showAll && filtered.length > GANTT_PAGE && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-text-muted hover:text-accent hover:bg-bg-subtle rounded-lg transition-all"
              style={{ paddingLeft: 176 }}
            >
              <ChevronDown className="w-3.5 h-3.5 rotate-180" />
              Show less
            </button>
          )}

          <p className="mt-2.5 text-[10px] text-text-muted" style={{ paddingLeft: 176 }}>
            Click a member to filter the event log · Weekend columns are shaded
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Project card
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectContributor { actor: ActivityActor; count: number; types: Record<string, number> }

function ProjectCard({
  project, contributors, events,
}: {
  project: Project;
  contributors: ProjectContributor[];
  events: ActivityItem[];
}) {
  const [expanded, setExpanded] = useState(false);

  const total    = project.issueCount ?? 0;
  const done     = project.doneCount  ?? 0;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  const maxCount = contributors[0]?.count ?? 1;
  const visible  = expanded ? events : events.slice(0, 5);
  const accent   = project.color ?? '#6366f1';

  return (
    <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden"
      style={{ borderLeft: `3px solid ${accent}` }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ background: accent }} />
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-text leading-snug">{project.name}</h3>
            {project.desc && (
              <p className="text-[12px] text-text-muted mt-0.5 line-clamp-1">{project.desc}</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-[24px] font-extrabold tracking-tighter text-text leading-none">{pct}%</span>
          <p className="text-[11px] text-text-muted mt-0.5">{done} / {total} done</p>
        </div>
      </div>

      {/* Progress */}
      <div className="px-5 pb-4">
        <div className="h-1.5 bg-bg-subtle rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(to right, ${accent}77, ${accent})`,
            }} />
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 text-[11px] text-green-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            {done} done
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
            {Math.max(0, total - done)} open
          </span>
          <span className="text-[11px] text-text-muted ml-auto">{events.length} events this period</span>
        </div>
      </div>

      {/* Contributors */}
      {contributors.length > 0 && (
        <>
          <div className="border-t border-border/70" />
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-text-muted mb-3">Contributors</p>
            <div className="flex flex-col gap-2.5">
              {contributors.map((c) => (
                <div key={c.actor._id} className="flex items-center gap-3">
                  <Avatar src={c.actor.avatar} name={c.actor.name} size="sm" />
                  <div className="w-[88px] shrink-0">
                    <p className="text-[12px] font-medium text-text truncate leading-tight">{c.actor.name}</p>
                    <p className="text-[10px] text-text-muted capitalize leading-tight">{c.actor.role}</p>
                  </div>
                  <div className="flex-1 h-1.5 bg-bg-subtle rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(c.count / maxCount) * 100}%`,
                        background: userColor(c.actor._id),
                      }} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-semibold text-text-sub tabular-nums">{c.count}</span>
                    <div className="flex gap-0.5">
                      {Object.keys(c.types).slice(0, 3).map((type) => (
                        <div key={type} className={cn('w-1.5 h-1.5 rounded-full', entityMeta(type).dot)} title={type} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Recent events */}
      {events.length > 0 && (
        <>
          <div className="border-t border-border/70" />
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-[.08em] text-text-muted">Recent Events</p>
              {events.length > 5 && (
                <button type="button" onClick={() => setExpanded((p) => !p)}
                  className="flex items-center gap-1 text-[11px] text-accent hover:underline transition-colors">
                  {expanded
                    ? <><ChevronDown className="w-3 h-3" /> Show less</>
                    : <><ChevronRight className="w-3 h-3" /> {events.length - 5} more</>
                  }
                </button>
              )}
            </div>
            {/* Timeline-style list */}
            <div className="relative pl-3" style={{ borderLeft: '2px solid var(--border)' }}>
              {visible.map((item) => (
                <EventRow key={item._id} item={item} showActor />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function TimelinePage() {
  const me      = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'admin';
  const router  = useRouter();

  const [tab,        setTab]        = useState<TabId>('people');
  const [preset,     setPreset]     = useState<Preset>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [exporting,  setExporting]  = useState(false);

  const { create, update } = useWorkbookMutations();

  // Date range
  const { from, to } = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    return {
      from: customFrom ? new Date(customFrom).toISOString() : '',
      to:   customTo   ? new Date(customTo + 'T23:59:59').toISOString() : '',
    };
  }, [preset, customFrom, customTo]);

  // Query params
  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: 200 };
    if (from) p.from = from;
    if (to)   p.to   = to;
    if (!isAdmin && me) p.userId = me.id;
    return p;
  }, [from, to, isAdmin, me]);

  const { data: items = [], isFetching } = useActivity(queryParams as Parameters<typeof useActivity>[0]);
  const { data: projects = [] } = useProjects();

  const days = useMemo(() => getDaysInRange(from, to), [from, to]);
  const { rows: ganttRows, maxCount } = useMemo(() => buildGantt(items), [items]);

  // Filtered for event log
  const filteredItems = useMemo(() =>
    selectedUser ? items.filter((i) => i.actorId?._id === selectedUser) : items,
  [items, selectedUser]);

  const groups = useMemo(() => groupByDay(filteredItems), [filteredItems]);

  // Stats
  const stats = useMemo(() => {
    const topUser = ganttRows[0];
    const typeMap: Record<string, number> = {};
    for (const i of items) typeMap[i.entityType] = (typeMap[i.entityType] ?? 0) + 1;
    const topType = Object.entries(typeMap).sort(([, a], [, b]) => b - a)[0];
    return { total: items.length, topUser, topType };
  }, [items, ganttRows]);

  // Per-project breakdown
  const projectData = useMemo(() => {
    const projectMap = new Map(projects.map((p) => [p._id, p]));
    const byProject  = new Map<string, ActivityItem[]>();

    for (const item of items) {
      if (!item.projectId) continue;
      if (!byProject.has(item.projectId)) byProject.set(item.projectId, []);
      byProject.get(item.projectId)!.push(item);
    }

    return [...byProject.entries()]
      .map(([projectId, projectItems]) => {
        const project = projectMap.get(projectId);
        if (!project) return null;

        const contribMap = new Map<string, { actor: ActivityActor; count: number; types: Record<string, number> }>();
        for (const it of projectItems) {
          const actor = it.actorId;
          if (!actor?._id) continue;
          if (!contribMap.has(actor._id)) contribMap.set(actor._id, { actor, count: 0, types: {} });
          const c = contribMap.get(actor._id)!;
          c.count++;
          c.types[it.entityType] = (c.types[it.entityType] ?? 0) + 1;
        }
        const contributors = [...contribMap.values()].sort((a, b) => b.count - a.count);
        return { project, contributors, events: projectItems };
      })
      .filter(Boolean)
      .sort((a, b) => b!.events.length - a!.events.length) as {
        project: Project;
        contributors: ProjectContributor[];
        events: ActivityItem[];
      }[];
  }, [items, projects]);

  const untrackedItems = useMemo(() => items.filter((i) => !i.projectId), [items]);

  const selectedUserName = ganttRows.find((r) => r.actor._id === selectedUser)?.actor.name;

  // ── Export dashboard report to Spreadsheet ─────────────────────────────
  const exportToSpreadsheet = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const cells: Record<string, Cell> = {};
      const merges: SheetRange[] = [];

      const sGroup = (bg: string): CellStyle => ({ b: true, bg, fg: '#ffffff', ha: 'center', va: 'middle', fs: 10, wrap: false });
      const sSub   = (bg: string): CellStyle => ({ b: true, bg, fg: '#ffffff', ha: 'center', va: 'middle', fs: 9 });
      const sLeft  = (bg?: string): CellStyle => ({ bg: bg ?? '#ffffff', va: 'middle', ha: 'left' });
      const sCenter= (bg?: string): CellStyle => ({ bg: bg ?? '#ffffff', va: 'middle', ha: 'center' });
      const sTotalL= (): CellStyle => ({ b: true, bg: '#f1f5f9', fg: '#1a237e', ha: 'left', va: 'middle' });
      const sTotalN= (fg: string): CellStyle => ({ b: true, bg: '#f1f5f9', fg, ha: 'center', va: 'middle' });

      const fill = (row: number, col: number, v: string | number, s: CellStyle) => {
        cells[rcToA1(row, col)] = { v, s };
      };
      const fillRange = (row: number, c1: number, c2: number, v: string, s: CellStyle) => {
        for (let c = c1; c <= c2; c++) fill(row, c, c === c1 ? v : '', s);
        if (c2 > c1) merges.push({ r1: row, c1, r2: row, c2 });
      };

      const TOTAL_COLS = 14;
      const presetLabel = preset === 'today' ? 'Today'
        : preset === 'week' ? 'This Week' : preset === 'month' ? 'This Month'
        : `${from.slice(0, 10)} – ${to.slice(0, 10)}`;
      fillRange(0, 0, TOTAL_COLS - 1,
        `ACTIVITY DASHBOARD REPORT  ·  ${presetLabel}`,
        { b: true, bg: '#1a237e', fg: '#ffffff', ha: 'center', va: 'middle', fs: 13 });

      fill(1, 0, 'PROJECT NAME',       sGroup('#1a237e'));
      fillRange(1, 1, 4, 'TIMELINE',   sGroup('#1565c0'));
      fill(1, 5, 'TEAM MEMBERS',       sGroup('#4a148c'));
      fillRange(1, 6, 9, 'ISSUES',     sGroup('#1b5e20'));
      fillRange(1, 10, 13, 'ACTIVITY LOG', sGroup('#b71c1c'));

      const SUB: [string, string][] = [
        ['PROJECT',     '#283593'],
        ['FIRST EVENT', '#1976d2'], ['LAST EVENT', '#1976d2'],
        ['ACTIVE DAYS', '#1976d2'], ['EVENTS',     '#1976d2'],
        ['MEMBERS',     '#7b1fa2'],
        ['OPEN',        '#2e7d32'], ['DONE',   '#2e7d32'],
        ['TOTAL',       '#2e7d32'], ['% DONE', '#2e7d32'],
        ['ISSUES',      '#c62828'], ['MR',    '#c62828'],
        ['NOTES',       '#c62828'], ['OTHER', '#c62828'],
      ];
      SUB.forEach(([label, bg], ci) => fill(2, ci, label, sSub(bg)));

      let dataRow = 3;
      let tEvents = 0, tOpen = 0, tDone = 0, tTotal = 0;
      let tIssues = 0, tMr = 0, tNotes = 0, tOther = 0;

      const writeProject = (
        name: string,
        evts: ActivityItem[],
        memberCount: number | string,
        open: number | string,
        done: number | string,
        total: number | string,
      ) => {
        const bg = dataRow % 2 === 0 ? '#eef2ff' : '#ffffff';
        const ts = evts.map((e) => new Date(e.createdAt).getTime());
        const first = ts.length ? new Date(Math.min(...ts)).toLocaleDateString('en-CA') : '—';
        const last  = ts.length ? new Date(Math.max(...ts)).toLocaleDateString('en-CA') : '—';
        const daysSpan = ts.length > 0
          ? Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / 86400000) + 1)
          : '—';
        const byType = (t: string) => evts.filter((e) => e.entityType === t).length;
        const issues = byType('issue'), mr = byType('mr'), notes = byType('note');
        const other  = evts.length - issues - mr - notes;
        const pctDone = typeof done === 'number' && typeof total === 'number' && total > 0
          ? `${Math.round((done / total) * 100)}%` : '—';

        const row: (string | number)[] = [
          name, first, last, daysSpan, evts.length,
          memberCount,
          open, done, total, pctDone,
          issues, mr, notes, other,
        ];
        row.forEach((val, ci) =>
          fill(dataRow, ci, val, ci === 0 ? sLeft(bg) : sCenter(bg)));

        if (typeof evts.length === 'number') tEvents += evts.length;
        if (typeof open  === 'number') tOpen  += open;
        if (typeof done  === 'number') tDone  += done;
        if (typeof total === 'number') tTotal += total;
        tIssues += issues; tMr += mr; tNotes += notes; tOther += other;
        dataRow++;
      };

      for (const { project, contributors, events: evts } of projectData) {
        const open = Math.max(0, (project.issueCount ?? 0) - (project.doneCount ?? 0));
        writeProject(project.name, evts, contributors.length, open, project.doneCount ?? 0, project.issueCount ?? 0);
      }
      if (untrackedItems.length > 0) {
        writeProject('(General — no project)', untrackedItems, '—', '—', '—', '—');
      }

      const pctTotal = tTotal > 0 ? `${Math.round((tDone / tTotal) * 100)}%` : '—';
      const totalVals: (string | number)[] = [
        'TOTAL', '', '', '', tEvents, '',
        tOpen, tDone, tTotal, pctTotal,
        tIssues, tMr, tNotes, tOther,
      ];
      const totalFg = ['#1a237e','#1565c0','#1565c0','#1565c0','#1565c0',
        '#4a148c','#1b5e20','#1b5e20','#1b5e20','#1b5e20',
        '#b71c1c','#b71c1c','#b71c1c','#b71c1c'];
      totalVals.forEach((val, ci) =>
        fill(dataRow, ci, val, ci === 0 ? sTotalL() : sTotalN(totalFg[ci])));

      const colWidths: Record<string, number> = {
        A: 190, B: 100, C: 100, D: 90, E: 70,
        F: 80,  G: 60,  H: 60,  I: 60, J: 65,
        K: 70,  L: 60,  M: 70,  N: 70,
      };
      const rowHeights: Record<string, number> = { '0': 34, '1': 30, '2': 24 };

      const sheetId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });

      const wb = await create.mutateAsync({ name: `Activity Dashboard · ${presetLabel}` });
      await update.mutateAsync({
        id: wb._id,
        body: {
          sheets: [{
            id: sheetId, name: 'Dashboard',
            rowCount: Math.max(50, dataRow + 5),
            colCount: 26,
            cells, colWidths, rowHeights, merges,
            frozen: { rows: 3, cols: 1 },
            hiddenRows: [], hiddenCols: [],
            gridlines: true, filter: null, condFmt: [], validations: [],
            color: null, hidden: false, index: 0,
          }],
          activeSheetId: sheetId,
        },
      });
      router.push(`/tables?open=${wb._id}`);
    } finally {
      setExporting(false);
    }
  };

  const PRESETS: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week',  label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'custom',label: 'Custom' },
  ];

  const TABS: { id: TabId; label: string; count?: number }[] = [
    { id: 'people',   label: 'By People',   count: ganttRows.length },
    { id: 'projects', label: 'By Projects', count: projectData.length },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 bg-bg">

      {/* ── Compact page header ─────────────────────────────────────────────── */}
      <div className="shrink-0 bg-bg-card border-b border-border">
        {/* Title row */}
        <div className="flex items-center justify-between gap-3 px-5 py-2.5">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="text-[13px] font-semibold text-text">Activity Timeline</span>
            <span className="text-[11px] text-text-muted hidden sm:block">
              {isAdmin ? '· team activity & project progress' : '· your activity'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isFetching && (
              <div className="w-3 h-3 border-[2px] border-accent border-t-transparent rounded-full animate-spin" />
            )}

            <button
              type="button"
              onClick={exportToSpreadsheet}
              disabled={exporting || items.length === 0}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all border',
                'bg-bg border-border text-text-sub hover:border-accent hover:text-accent hover:bg-accent/5',
                (exporting || items.length === 0) && 'opacity-40 cursor-not-allowed pointer-events-none',
              )}
            >
              {exporting ? (
                <div className="w-3 h-3 border-[2px] border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Sheet className="w-3 h-3" />
              )}
              {exporting ? 'Exporting…' : 'Export to Spreadsheet'}
            </button>
          </div>
        </div>

        {/* Filter + tabs row */}
        <div className="px-5 pb-0">
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {/* Preset selector */}
            <div className="flex items-center gap-px bg-bg-subtle border border-border rounded-lg p-0.5">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => setPreset(p.key)}
                  className={cn(
                    'px-3 py-1.5 text-[12px] font-medium rounded-md transition-all',
                    preset === p.key
                      ? 'bg-bg-card text-text shadow-sm border border-border/60'
                      : 'text-text-muted hover:text-text',
                  )}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 px-2.5 text-[12px] bg-bg-card border border-border rounded-lg text-text outline-none focus:border-accent transition-colors" />
                <span className="text-text-muted text-[12px]">—</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 px-2.5 text-[12px] bg-bg-card border border-border rounded-lg text-text outline-none focus:border-accent transition-colors" />
              </div>
            )}

            {/* Summary pill */}
            {items.length > 0 && (
              <span className="ml-auto text-[11px] text-text-muted">
                <span className="font-semibold text-text">{items.length}</span> events · {days.length} days
              </span>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-0 -mb-px">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-all',
                  tab === t.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text hover:border-border',
                )}>
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1',
                    tab === t.id
                      ? 'bg-accent text-white'
                      : 'bg-bg-subtle text-text-muted',
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">

        {/* ═══ BY PEOPLE ════════════════════════════════════════════════════ */}
        {tab === 'people' && (
          <div className="flex flex-col gap-5 max-w-5xl">

            {/* Stat cards */}
            {items.length > 0 && (
              <div className="flex gap-3">
                <StatCard
                  value={String(stats.total)}
                  label="Total Events"
                  sub="in selected period"
                  accent="#6366f1"
                />
                {stats.topUser && (
                  <StatCard
                    value={stats.topUser.actor.name.split(' ')[0]}
                    label="Most Active"
                    sub={`${stats.topUser.total} events · ${stats.topUser.actor.role}`}
                    accent={stats.topUser.color}
                  />
                )}
                {stats.topType && (
                  <StatCard
                    value={entityMeta(stats.topType[0]).label}
                    label="Top Activity"
                    sub={`${stats.topType[1]} event${stats.topType[1] !== 1 ? 's' : ''} recorded`}
                    accent="#06b6d4"
                  />
                )}
              </div>
            )}

            {/* Gantt chart */}
            {days.length > 0 && ganttRows.length > 0 && (
              <GanttChart
                rows={ganttRows}
                days={days}
                maxCount={maxCount}
                selectedUserId={selectedUser}
                onSelect={(id) => setSelectedUser((p) => p === id ? '' : id)}
              />
            )}

            {/* Event log */}
            <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {/* Log header */}
              <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border">
                <Clock className="w-4 h-4 text-text-muted shrink-0" />
                <span className="text-[13px] font-semibold text-text">Event Log</span>
                {selectedUser && selectedUserName && (
                  <button type="button" onClick={() => setSelectedUser('')}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 text-accent text-[11px] font-semibold rounded-full hover:bg-accent/20 transition-colors">
                    <Users className="w-3 h-3" />
                    {selectedUserName}
                    <X className="w-2.5 h-2.5 opacity-60" />
                  </button>
                )}
                <span className="text-[11px] text-text-muted ml-auto tabular-nums">
                  {filteredItems.length} event{filteredItems.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Empty state */}
              {!isFetching && items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-12 h-12 rounded-full bg-bg-subtle flex items-center justify-center">
                    <Clock className="w-6 h-6 text-text-muted/40" />
                  </div>
                  <div className="text-center">
                    <p className="text-[14px] font-medium text-text-sub">No activity found</p>
                    <p className="text-[12px] text-text-muted mt-0.5">Try selecting a different time period</p>
                  </div>
                </div>
              )}

              {/* Groups */}
              <div className="px-5 py-4 flex flex-col gap-6">
                {groups.map((group) => (
                  <div key={group.key}>
                    {/* Day label */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-[11px] font-bold uppercase tracking-[.07em] text-text-muted">
                        {group.label}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] font-medium text-text-muted tabular-nums">
                        {group.items.length}
                      </span>
                    </div>
                    {/* Timeline events */}
                    <div className="relative" style={{ borderLeft: '2px solid var(--border)', marginLeft: 12 }}>
                      <div className="pl-4 flex flex-col">
                        {group.items.map((item) => (
                          <EventRow key={item._id} item={item} showActor={!selectedUser} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ BY PROJECTS ══════════════════════════════════════════════════ */}
        {tab === 'projects' && (
          <div className="flex flex-col gap-5 max-w-3xl">

            {/* Empty state */}
            {projectData.length === 0 && !isFetching && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 bg-bg-card border border-border rounded-xl">
                <div className="w-12 h-12 rounded-full bg-bg-subtle flex items-center justify-center">
                  <LayoutGrid className="w-6 h-6 text-text-muted/40" />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-medium text-text-sub">No project activity</p>
                  <p className="text-[12px] text-text-muted mt-0.5">No events linked to projects in this period</p>
                </div>
              </div>
            )}

            {/* Project cards */}
            {projectData.map(({ project, contributors, events }) => (
              <ProjectCard
                key={project._id}
                project={project}
                contributors={contributors}
                events={events}
              />
            ))}

            {/* Untracked events */}
            {untrackedItems.length > 0 && (
              <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden"
                style={{ borderLeft: '3px solid var(--border)' }}>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                  <div className="w-3 h-3 rounded-full bg-text-muted/30 shrink-0" />
                  <span className="text-[14px] font-semibold text-text">General</span>
                  <span className="text-[11px] text-text-muted ml-auto">
                    {untrackedItems.length} event{untrackedItems.length !== 1 ? 's' : ''} · not linked to a project
                  </span>
                </div>
                <div className="px-5 py-4">
                  <div className="relative" style={{ borderLeft: '2px solid var(--border)', marginLeft: 12 }}>
                    <div className="pl-4 flex flex-col">
                      {untrackedItems.slice(0, 10).map((item) => (
                        <EventRow key={item._id} item={item} showActor />
                      ))}
                    </div>
                  </div>
                  {untrackedItems.length > 10 && (
                    <p className="text-[11px] text-text-muted text-center pt-3 border-t border-border mt-2">
                      +{untrackedItems.length - 10} more events
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
