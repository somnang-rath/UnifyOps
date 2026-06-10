'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReports } from '@/hooks/use-reports';
import type { ReportTemplate } from '@/schemas/report';
import { ArrowLeft, FileBarChart2, Layers, Pause, Play, Zap } from 'lucide-react';

const ROWS_PER_PAGE = 11;
const AUTO_ADVANCE_MS = 6000;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('km-KH', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function fmtFreq(r: ReportTemplate) {
  if (!r.schedule.enabled) return 'មិនកំណត់';
  const map: Record<string, string> = {
    daily: 'ប្រចាំថ្ងៃ',
    weekly: 'ប្រចាំសប្តាហ៍',
    monthly: 'ប្រចាំខែ',
    yearly: 'ប្រចាំឆ្នាំ',
  };
  return map[r.schedule.frequency] ?? r.schedule.frequency;
}

function useClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time.toLocaleTimeString('km-KH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Computes rowspan counts for a list of values.
 * Returns an array where:
 *   - spans[i] > 0  → render this cell with rowSpan = spans[i]
 *   - spans[i] === 0 → skip this cell (it is covered by the cell above)
 */
function computeSpans(values: string[]): number[] {
  const spans = new Array(values.length).fill(0);
  let i = 0;
  while (i < values.length) {
    let j = i + 1;
    while (j < values.length && values[j] === values[i]) j++;
    spans[i] = j - i;
    i = j;
  }
  return spans;
}

export default function ReportsDisplayPage() {
  const router = useRouter();
  const { data: reports = [], isLoading } = useReports();
  const clock = useClock();
  const [mergeCells, setMergeCells] = useState(false);

  const totalPages = Math.max(1, Math.ceil(reports.length / ROWS_PER_PAGE));
  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);

  const intervalRef  = useRef<NodeJS.Timeout | null>(null);
  const progressRef  = useRef<NodeJS.Timeout | null>(null);
  const pausedRef    = useRef(paused);
  pausedRef.current  = paused;

  const stopCycle = () => {
    if (intervalRef.current)  clearInterval(intervalRef.current);
    if (progressRef.current)  clearInterval(progressRef.current);
  };

  const startCycle = () => {
    stopCycle();
    if (pausedRef.current) return;

    setProgress(0);
    const step = 100 / (AUTO_ADVANCE_MS / 50);
    progressRef.current = setInterval(() => {
      setProgress((p) => Math.min(100, p + step));
    }, 50);

    intervalRef.current = setInterval(() => {
      setPage((p) => (p + 1) % totalPages);
      setProgress(0);
    }, AUTO_ADVANCE_MS);
  };

  useEffect(() => {
    if (reports.length === 0) return;
    if (paused) {
      stopCycle();
    } else {
      startCycle();
    }
    return stopCycle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports.length, totalPages, paused]);

  useEffect(() => {
    setProgress(0);
  }, [page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPage((p) => (p + 1) % totalPages);
        if (!pausedRef.current) startCycle();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPage((p) => (p - 1 + totalPages) % totalPages);
        if (!pausedRef.current) startCycle();
      }
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  const pageRows = reports.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  // Compute group numbers globally so they stay consistent across pages
  const groupNos = useMemo(() => {
    let g = 0;
    let last = '';
    return reports.map((r) => {
      if (r.name !== last) { g++; last = r.name; }
      return g;
    });
  }, [reports]);

  // Per-page rowspan maps (only needed when merge is on)
  const nameSpans = useMemo(
    () => mergeCells ? computeSpans(pageRows.map((r) => r.name)) : [],
    [mergeCells, pageRows],
  );
  const descSpans = useMemo(
    () => mergeCells ? computeSpans(pageRows.map((r) => r.description ?? '')) : [],
    [mergeCells, pageRows],
  );
  // Merge "no" column by group number (same group = same cell)
  const noSpans = useMemo(
    () => mergeCells
      ? computeSpans(pageRows.map((_, i) => String(groupNos[page * ROWS_PER_PAGE + i])))
      : [],
    [mergeCells, pageRows, groupNos, page],
  );

  const headerRow = [
    { key: 'no',       label: 'ល.រ',          align: 'center' as const, w: '5%'  },
    { key: 'name',     label: 'ឈ្មោះ',         align: 'left'   as const, w: '28%' },
    { key: 'desc',     label: 'ការពិពណ៌នា',    align: 'left'   as const, w: '27%' },
    { key: 'size',     label: 'ទំហំ',          align: 'center' as const, w: '10%' },
    { key: 'schedule', label: 'ម៉ោងវេន',       align: 'center' as const, w: '12%' },
    { key: 'status',   label: 'ស្ថានភាព',      align: 'center' as const, w: '10%' },
    { key: 'created',  label: 'ថ្ងៃបង្កើត',    align: 'center' as const, w: '12%' },
  ] as const;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f5f6fa]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-accent-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm">កំពុងផ្ទុក...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-border shadow-sm">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-text-sub hover:text-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          ត្រឡប់
        </button>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center">
              <FileBarChart2 className="w-4 h-4 text-accent-600" />
            </div>
            <span className="font-semibold text-sm">Reports Display</span>
          </div>
          {/* Live clock */}
          <span className="text-xs text-text-muted font-mono bg-[#f0f2f8] px-2 py-0.5 rounded-md border border-[#dde1ef]">
            {clock}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Merge cells toggle */}
          <button
            onClick={() => setMergeCells((v) => !v)}
            title="ច្របាច់ ក្រឡាដូចគ្នា"
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border transition-colors ${
              mergeCells
                ? 'bg-accent-100 border-accent-300 text-accent-700 hover:bg-accent-200'
                : 'bg-[#f0f2f8] border-[#dde1ef] text-[#6b7280] hover:bg-[#e5e8f3]'
            }`}
          >
            <Layers className="w-3 h-3" />
            ច្របាច់ ឈ្មោះ
          </button>

          {/* Pause/resume toggle */}
          <button
            onClick={() => setPaused((v) => !v)}
            title={paused ? 'បន្ត (Space)' : 'ផ្អាក (Space)'}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border transition-colors ${
              paused
                ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                : 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
            }`}
          >
            {paused ? <><Pause className="w-3 h-3" /> ផ្អាក</> : <><Play className="w-3 h-3" /> Auto</>}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-6">
        <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-sm border border-border overflow-hidden">

          {/* Report title header */}
          <div className="bg-gradient-to-r from-accent-600 to-accent-700 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-white text-lg font-bold tracking-wide">
                បញ្ជីរបាយការណ៍ — UnifyOps
              </h2>
              <p className="text-white/70 text-xs mt-0.5">
                ព័ត៌មានរបាយការណ៍ទាំងអស់ · {reports.length} របាយការណ៍
              </p>
            </div>
            {mergeCells && (
              <span className="text-white/80 text-[11px] bg-white/10 border border-white/20 rounded-full px-2.5 py-0.5 font-medium">
                ច្របាច់ ក្រឡាដូចគ្នា
              </span>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {headerRow.map((h) => (
                    <th
                      key={h.key}
                      style={{ width: h.w, textAlign: h.align }}
                      className="bg-[#f0f2f8] text-[#3c4a6b] font-semibold text-[11px] uppercase tracking-wide px-4 py-3 border-b border-[#dde1ef]"
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-text-muted text-sm">
                      មិនមានទិន្នន័យ
                    </td>
                  </tr>
                )}
                {pageRows.map((r, i) => {
                  const globalIdx = page * ROWS_PER_PAGE + i;
                  const isEven    = i % 2 === 0;
                  const rowBg     = isEven ? 'bg-white' : 'bg-[#f7f8fc]';

                  // Merge spans for this row
                  const noSpan   = mergeCells ? noSpans[i]   : 1;
                  const nameSpan = mergeCells ? nameSpans[i] : 1;
                  const descSpan = mergeCells ? descSpans[i] : 1;

                  return (
                    <tr key={r._id} className={rowBg}>

                      {/* No. — skip if covered by merged cell above */}
                      {(!mergeCells || noSpan > 0) && (
                        <td
                          rowSpan={mergeCells ? noSpan : undefined}
                          className={`px-4 py-2.5 text-center font-bold text-[#3c4a6b] border-b border-[#eef0f6] border-r border-r-[#dde1ef] ${
                            mergeCells && noSpan > 1 ? 'align-middle bg-[#f0f2f8]' : ''
                          }`}
                        >
                          {mergeCells ? groupNos[globalIdx] : globalIdx + 1}
                        </td>
                      )}

                      {/* Name — merged when same consecutive value */}
                      {(!mergeCells || nameSpan > 0) && (
                        <td
                          rowSpan={mergeCells ? nameSpan : undefined}
                          className={`px-4 py-2.5 border-b border-[#eef0f6] ${
                            mergeCells && nameSpan > 1
                              ? 'align-middle border-r border-r-[#dde1ef] bg-white'
                              : ''
                          }`}
                        >
                          <span
                            className={`font-semibold ${
                              mergeCells && nameSpan > 1
                                ? 'text-accent-600'
                                : 'text-[#1a2540]'
                            }`}
                          >
                            {r.name}
                          </span>
                        </td>
                      )}

                      {/* Description — merged when same consecutive value */}
                      {(!mergeCells || descSpan > 0) && (
                        <td
                          rowSpan={mergeCells ? descSpan : undefined}
                          className={`px-4 py-2.5 border-b border-[#eef0f6] text-[#6b7280] text-[12px] ${
                            mergeCells && descSpan > 1 ? 'align-middle' : ''
                          }`}
                        >
                          {r.description || '—'}
                        </td>
                      )}

                      {/* Size */}
                      <td className="px-4 py-2.5 border-b border-[#eef0f6] text-center">
                        <span className="text-[#3c4a6b] text-[12px]">
                          {r.pageSize} · {r.orientation === 'portrait' ? 'P' : 'L'}
                        </span>
                      </td>

                      {/* Schedule */}
                      <td className="px-4 py-2.5 border-b border-[#eef0f6] text-center text-[12px] text-[#3c4a6b]">
                        {fmtFreq(r)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5 border-b border-[#eef0f6] text-center">
                        {r.schedule.enabled ? (
                          <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                            សកម្ម
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-[#f1f3f9] text-[#8592ad] text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#c5ccd8] inline-block" />
                            អសកម្ម
                          </span>
                        )}
                      </td>

                      {/* Created */}
                      <td className="px-4 py-2.5 border-b border-[#eef0f6] text-center text-[12px] text-[#6b7280]">
                        {fmtDate(r.createdAt)}
                      </td>
                    </tr>
                  );
                })}

                {/* Filler rows — keep table height stable across pages */}
                {pageRows.length < ROWS_PER_PAGE &&
                  Array.from({ length: ROWS_PER_PAGE - pageRows.length }).map((_, i) => (
                    <tr key={`filler-${i}`} className={i % 2 === pageRows.length % 2 ? 'bg-white' : 'bg-[#f7f8fc]'}>
                      <td colSpan={7} className="h-[1px] border-b border-[#eef0f6]" />
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 bg-[#f7f8fc] border-t border-[#dde1ef]">
            {/* Branding */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-accent-600 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p className="text-[12px] font-bold text-accent-700 leading-none">UnifyOps</p>
                <p className="text-[10px] text-text-muted leading-none mt-0.5">unifyops.app</p>
              </div>
            </div>

            {/* Page indicator — clickable dots for manual navigation */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { setPage(i); if (!paused) startCycle(); }}
                    className={`rounded-full transition-all duration-300 ${
                      i === page
                        ? 'w-4 h-2 bg-accent-600'
                        : 'w-2 h-2 bg-[#c5ccd8] hover:bg-accent-400'
                    }`}
                  />
                ))}
              </div>
              <p className="text-[11px] text-text-muted">
                ទំព័រ — {page + 1}/{totalPages}
              </p>
            </div>

            {/* Progress bar + countdown (hidden when paused) */}
            <div className="flex flex-col items-end gap-1 min-w-[120px]">
              {paused ? (
                <p className="text-[10px] text-amber-500 font-medium">⏸ ផ្អាក · Space = បន្ត</p>
              ) : (
                <>
                  <div className="w-full h-1.5 bg-[#e2e5f0] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-500 rounded-full transition-none"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-text-muted">
                    auto · {Math.ceil((AUTO_ADVANCE_MS / 1000) * (1 - progress / 100))}វ
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="text-center text-[11px] text-text-muted mt-3 select-none">
          ← → ប្ដូរទំព័រ &nbsp;·&nbsp; Space ផ្អាក/បន្ត
        </p>
      </div>
    </div>
  );
}
