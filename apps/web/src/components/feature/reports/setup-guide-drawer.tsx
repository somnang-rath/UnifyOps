'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ReportTemplate } from '@/schemas/report';
import {
  ArrowRight, BarChart2, CheckCircle2, ChevronDown, ChevronRight,
  Circle, FileText, Filter, GaugeCircle, Heading1,
  LayoutTemplate, Mail, Play, Send, Table2, Type, X, Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  id: number;
  title: string;
  titleKh: string;
  done: (t: ReportTemplate) => boolean;
  content: React.ReactNode;
}

// ── Step content ──────────────────────────────────────────────────────────────

function StepCard({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border bg-bg-subtle">
      <div className="w-7 h-7 rounded-lg bg-bg-card border border-border flex items-center justify-center flex-shrink-0 text-accent-600">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold text-text">{label}</p>
        <p className="text-[10px] text-text-muted leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="font-mono text-[10px] bg-bg-subtle border border-border rounded px-1.5 py-0.5 text-accent-700 dark:text-accent-400">
      {children}
    </code>
  );
}

function Arrow() {
  return <ArrowRight className="w-3 h-3 text-text-muted flex-shrink-0" />;
}

const STEP_1_CONTENT = (
  <div className="space-y-3">
    <p className="text-[11px] text-text-sub leading-relaxed">
      Click an element in the <strong>left sidebar</strong> to add it to the canvas.
      Design <em>once</em> — the same template generates a personalized PDF per recipient.
    </p>

    <div className="space-y-1.5">
      <StepCard icon={<Heading1 className="w-3.5 h-3.5" />} label="Heading" sub={'Report title — e.g. "Monthly Report for {name}"'} />
      <StepCard icon={<Type className="w-3.5 h-3.5" />}     label="Text"    sub="Dynamic values from API — e.g. total sales, status" />
      <StepCard icon={<Table2 className="w-3.5 h-3.5" />}   label="Table"   sub="Rows filtered per recipient automatically" />
      <StepCard icon={<BarChart2 className="w-3.5 h-3.5" />} label="Chart"  sub="Bar / line / pie from API data" />
      <StepCard icon={<GaugeCircle className="w-3.5 h-3.5" />} label="Progress" sub="Shows a value as a fill bar (e.g. completion %)" />
    </div>

    <div className="flex items-center gap-1.5 text-[10px] text-text-muted bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-2">
      <LayoutTemplate className="w-3 h-3 text-amber-500 flex-shrink-0" />
      Tip: Add a Heading + Text + Table to get started fast
    </div>
  </div>
);

const STEP_2_CONTENT = (
  <div className="space-y-3">
    <p className="text-[11px] text-text-sub leading-relaxed">
      Select an element on the canvas → open the <strong>Data Source</strong> tab in the right panel → enter your API URL.
    </p>

    {/* Flow diagram */}
    <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-medium">
      <span className="px-2 py-1 rounded-md bg-accent-50 dark:bg-accent-950/30 border border-accent-200 dark:border-accent-700 text-accent-700 dark:text-accent-400">Click element</span>
      <Arrow />
      <span className="px-2 py-1 rounded-md bg-bg-subtle border border-border text-text-sub">Data Source tab</span>
      <Arrow />
      <span className="px-2 py-1 rounded-md bg-bg-subtle border border-border text-text-sub">Enter URL</span>
      <Arrow />
      <span className="px-2 py-1 rounded-md bg-bg-subtle border border-border text-text-sub">Fetch Data</span>
      <Arrow />
      <span className="px-2 py-1 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400">Apply</span>
    </div>

    {/* Per element type */}
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-bg-subtle p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Type className="w-3.5 h-3.5 text-accent-600" />
          <span className="text-[11px] font-semibold text-text">Text / Heading</span>
        </div>
        <p className="text-[10px] text-text-muted leading-relaxed">
          Use <strong>template tokens</strong> to insert dynamic values:
        </p>
        <div className="flex flex-wrap gap-1 mt-1">
          {['{name}', '{email}', '{total}', '{value}', '{status}'].map((t) => (
            <Code key={t}>{t}</Code>
          ))}
        </div>
        <p className="text-[10px] text-text-muted mt-1">
          Example: <Code>{'Report for {name} — Total: {total}'}</Code>
        </p>
      </div>

      <div className="rounded-xl border border-border bg-bg-subtle p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Table2 className="w-3.5 h-3.5 text-accent-600" />
          <span className="text-[11px] font-semibold text-text">Table / Chart / Progress</span>
        </div>
        <p className="text-[10px] text-text-muted leading-relaxed">
          Set API URL + Data Path → pick columns → rows auto-filter per recipient when sending.
        </p>
        <div className="flex items-center gap-1 text-[10px] text-text-muted">
          <span>Data Path example:</span> <Code>data</Code> <span>or</span> <Code>items.rows</Code>
        </div>
      </div>
    </div>
  </div>
);

const STEP_3_CONTENT = (
  <div className="space-y-3">
    <p className="text-[11px] text-text-sub leading-relaxed">
      Open the <strong>Recipients</strong> tab → enable <em>Auto-recipients</em> → set the field that holds the email address in each API row.
    </p>

    {/* Visual config */}
    <div className="rounded-xl border border-border bg-bg-subtle p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-accent-600 flex items-center justify-center flex-shrink-0">
          <Zap className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-semibold text-text">Auto-recipients from API</span>
        <span className="ml-auto text-[9px] font-bold text-accent-600 uppercase tracking-wide">Toggle ON</span>
      </div>

      <div className="space-y-2 pl-2 border-l-2 border-accent-200 dark:border-accent-800">
        <div>
          <p className="text-[10px] font-semibold text-text-sub mb-0.5">Email Field <span className="text-red-500">*</span></p>
          <Code>email</Code>
          <p className="text-[9px] text-text-muted mt-0.5">dot-notation — e.g. <Code>contact.email</Code></p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-text-sub mb-0.5">Name Field <span className="text-text-muted">(optional)</span></p>
          <Code>name</Code>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-text-sub mb-0.5">URL <span className="text-text-muted">(optional — uses datasource URL by default)</span></p>
          <Code>http://localhost:5000/api/cpo</Code>
        </div>
      </div>
    </div>

    {/* What happens */}
    <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-3 space-y-1.5">
      <p className="text-[10px] font-semibold text-green-700 dark:text-green-400">What happens when you Send:</p>
      <div className="space-y-1 text-[10px] text-green-700/80 dark:text-green-400/80">
        <div className="flex items-start gap-1.5">
          <span className="flex-shrink-0 font-bold mt-0.5">1.</span>
          <span>Fetch API → extract every unique email from <Code>email</Code> field</span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="flex-shrink-0 font-bold mt-0.5">2.</span>
          <span>For each email: filter rows where <Code>email === recipient</Code></span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="flex-shrink-0 font-bold mt-0.5">3.</span>
          <span>Render template with <em>only that person's data</em> → PDF</span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="flex-shrink-0 font-bold mt-0.5">4.</span>
          <span>Email the PDF to that recipient</span>
        </div>
      </div>
    </div>
  </div>
);

const STEP_4_CONTENT = (
  <div className="space-y-3">
    <p className="text-[11px] text-text-sub leading-relaxed">
      Before sending to everyone, preview one recipient's PDF to verify the data is correct.
    </p>

    <div className="space-y-2">
      {/* Filter preview */}
      <div className="rounded-xl border border-border bg-bg-subtle p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-accent-600" />
          <span className="text-[11px] font-semibold text-text">Step 4a — Preview one recipient</span>
        </div>
        <p className="text-[10px] text-text-muted">Click <strong>Filter</strong> in the top bar:</p>
        <div className="space-y-1 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-text-muted w-16 flex-shrink-0">Field:</span>
            <Code>email</Code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-muted w-16 flex-shrink-0">Value:</span>
            <Code>cpo1@demo.com</Code>
          </div>
        </div>
        <p className="text-[9px] text-text-muted">Browser opens PDF with <em>only that person's filtered rows</em></p>
      </div>

      {/* Save */}
      <div className="rounded-xl border border-border bg-bg-subtle p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-accent-600" />
          <span className="text-[11px] font-semibold text-text">Step 4b — Save the template</span>
        </div>
        <p className="text-[10px] text-text-muted">Click <strong>Save</strong> in the top bar before sending.</p>
      </div>

      {/* Send */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">Step 4c — Send to all recipients</span>
        </div>
        <p className="text-[10px] text-blue-700/80 dark:text-blue-400/80 leading-relaxed">
          Go to <strong>History</strong> page → click <strong>Send Now ⚡</strong>.<br />
          Watch the counters update live as each email is dispatched.
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 font-semibold">✓ Sent</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 font-semibold">✗ Failed</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">⊘ Blocked</span>
        </div>
      </div>
    </div>
  </div>
);

// ── Step definitions ──────────────────────────────────────────────────────────

function buildSteps(): Step[] {
  return [
    {
      id: 1,
      title: 'Add elements to the canvas',
      titleKh: 'បន្ថែម elements ទៅ canvas',
      done: (t) => (t.elements?.length ?? 0) > 0,
      content: STEP_1_CONTENT,
    },
    {
      id: 2,
      title: 'Bind data to each element',
      titleKh: 'ភ្ជាប់ data ទៅ element',
      done: (t) =>
        (t.elements ?? []).some((el) => {
          const p = el.props as Record<string, unknown>;
          return !!(p?.dataSource || p?.textDataSource);
        }),
      content: STEP_2_CONTENT,
    },
    {
      id: 3,
      title: 'Configure auto-recipients',
      titleKh: 'កំណត់ auto-recipients',
      done: (t) => !!(t.dataRecipientsConfig?.enabled && t.dataRecipientsConfig?.emailField),
      content: STEP_3_CONTENT,
    },
    {
      id: 4,
      title: 'Preview then Send',
      titleKh: 'Preview ហើយ Send',
      done: () => false, // always shows — user's final action
      content: STEP_4_CONTENT,
    },
  ];
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  template: ReportTemplate;
  onClose: () => void;
}

export function SetupGuideDrawer({ template, onClose }: Props) {
  const steps = buildSteps();
  const [expanded, setExpanded] = useState<number>(
    // auto-open the first incomplete step
    steps.find((s) => !s.done(template))?.id ?? 4,
  );

  const completedCount = steps.filter((s) => s.done(template)).length;

  return (
    <div className="flex flex-col h-full w-72 bg-bg-card border-l border-border flex-shrink-0 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Play className="w-3.5 h-3.5 text-accent-600" />
            <span className="text-xs font-bold text-text">Setup Guide</span>
          </div>
          <p className="text-[10px] text-text-muted mt-0.5">
            {completedCount} of {steps.length} steps done
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-bg-subtle flex-shrink-0">
        <div
          className="h-full bg-accent-600 transition-all duration-500"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-2">
        {steps.map((step) => {
          const done     = step.done(template);
          const open     = expanded === step.id;
          const isActive = !done && steps.find((s) => !s.done(template))?.id === step.id;

          return (
            <div
              key={step.id}
              className={cn(
                'rounded-xl border transition-all',
                done
                  ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10'
                  : isActive
                  ? 'border-accent-300 dark:border-accent-700 bg-accent-50/50 dark:bg-accent-950/10'
                  : 'border-border bg-bg-card',
              )}
            >
              {/* Step header */}
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                onClick={() => setExpanded(open ? -1 : step.id)}
              >
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {done ? (
                    <CheckCircle2 className="w-4.5 h-4.5 text-green-500" />
                  ) : isActive ? (
                    <div className="w-[18px] h-[18px] rounded-full bg-accent-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                      {step.id}
                    </div>
                  ) : (
                    <Circle className="w-[18px] h-[18px] text-border fill-bg-subtle flex-shrink-0" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-xs font-semibold leading-tight',
                    done ? 'text-green-700 dark:text-green-400 line-through opacity-70'
                    : isActive ? 'text-accent-700 dark:text-accent-400'
                    : 'text-text-sub',
                  )}>
                    {step.title}
                  </p>
                  <p className="text-[9px] text-text-muted truncate">{step.titleKh}</p>
                </div>

                {open
                  ? <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  : <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                }
              </button>

              {/* Step body */}
              {open && (
                <div className="px-3 pb-3 pt-0 border-t border-border/60">
                  <div className="pt-2.5">
                    {step.content}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* All done banner */}
        {completedCount >= 3 && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-start gap-2.5 mt-1">
            <Mail className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Ready to send!</p>
              <p className="text-[10px] text-blue-600/80 dark:text-blue-400/70 leading-relaxed mt-0.5">
                Save the template, go to <strong>History</strong>, click <strong>Send Now ⚡</strong>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
