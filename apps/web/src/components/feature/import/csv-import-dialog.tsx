'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Papa from 'papaparse';
import { CheckCircle2 } from 'lucide-react';
import type { ImportResult, ImportRow } from '@prism/types';
import { ErrorState, Spinner, Table, TBody, THead, TRow } from '@prism/ui';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useIssueImport } from '@/hooks/use-issues';
import { useProjectsInWorkspace } from '@/hooks/use-projects';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/schemas/issue';

const MAX_ROWS = 500;

export interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Preselected when the page has a project filter applied. */
  defaultProjectId?: string;
}

type TargetField =
  | 'title'
  | 'desc'
  | 'status'
  | 'priority'
  | 'labels'
  | 'dueDate'
  | 'assigneeEmail';

const TARGET_FIELDS: { key: TargetField; label: string; required?: boolean }[] =
  [
    { key: 'title', label: 'Title', required: true },
    { key: 'desc', label: 'Description' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'labels', label: 'Labels' },
    { key: 'dueDate', label: 'Due date' },
    { key: 'assigneeEmail', label: 'Assignee email' },
  ];

// Case-insensitive fuzzy header matching (spec §4.2 step 2). One header maps
// to at most one field — first match wins; the user can override anything.
const AUTO_MAP: [TargetField, RegExp][] = [
  ['title', /^(title|name|summary)$/],
  ['desc', /^(desc|description|body)$/],
  ['status', /^(status|state|column)$/],
  ['priority', /^priority$/],
  ['labels', /^(label|labels|tags)$/],
  ['dueDate', /^(due|due date|deadline)$/],
  ['assigneeEmail', /^(assignee|email|owner)$/],
];

const normalizeHeader = (h: string) =>
  h.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

const truncate = (s: string, n = 32) =>
  s.length > n ? `${s.slice(0, n)}…` : s;

/** A normalized cell for the preview: coerced values render amber. */
interface PreviewCell {
  text: string;
  coerced: boolean;
}

interface MappedRow {
  /** null ⇒ client-rejected (no title). */
  data: ImportRow | null;
  display: Partial<Record<TargetField, PreviewCell>>;
}

const KNOWN_STATUSES = new Set<string>(ISSUE_STATUSES);
const KNOWN_PRIORITIES = new Set<string>(ISSUE_PRIORITIES);

// "In Progress" / "IN-PROGRESS" → "inprogress" before the known-set check.
const squash = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, '');

function normalizeStatus(raw: string): PreviewCell & { value: string } {
  const v = squash(raw);
  if (KNOWN_STATUSES.has(v)) return { value: v, text: v, coerced: false };
  return { value: 'todo', text: 'todo', coerced: true };
}

function normalizePriority(raw: string): PreviewCell & { value: string } {
  const v = squash(raw);
  if (KNOWN_PRIORITIES.has(v)) return { value: v, text: v, coerced: false };
  return { value: 'medium', text: 'medium', coerced: true };
}

/** Dates are read as YYYY-MM-DD; other formats are attempted (spec §4.2). */
function normalizeDate(
  raw: string,
): { value: string | undefined } & PreviewCell {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { value: t, text: t, coerced: false };
  const ms = Date.parse(t);
  if (!Number.isNaN(ms)) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    return { value: iso, text: iso, coerced: true };
  }
  return { value: undefined, text: '—', coerced: true };
}

const splitLabels = (raw: string) =>
  raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * CSV import wizard — File → Map columns → Preview → Done in one Modal
 * (templates-csv-import spec §4). papaparse client-side; 500-row hard block;
 * one request, no per-row progress in v1. Re-opening resets to step 1.
 */
export function CsvImportDialog({
  open,
  onClose,
  defaultProjectId,
}: CsvImportDialogProps) {
  const slug = useParams<{ workspaceSlug?: string }>()?.workspaceSlug ?? null;
  const { data: workspace } = useWorkspaceBySlug(slug);
  const { data: projects = [] } = useProjectsInWorkspace(workspace?.id ?? null);
  const importMutation = useIssueImport();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [fileError, setFileError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<TargetField, string>>({
    title: '',
    desc: '',
    status: '',
    priority: '',
    labels: '',
    dueDate: '',
    assigneeEmail: '',
  });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  const importing = importMutation.isPending;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Re-opening resets to Step 1 — no draft persistence (spec §4.3).
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setProjectId(defaultProjectId ?? '');
    setFileError(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({
      title: '',
      desc: '',
      status: '',
      priority: '',
      labels: '',
      dueDate: '',
      assigneeEmail: '',
    });
    setResult(null);
    setRequestFailed(false);
    setLiveMessage('');
  }, [open, defaultProjectId]);

  // Step change: announce politely and move focus to the step's first
  // interactive control (spec §4.4).
  useEffect(() => {
    if (!open) return;
    const names = { 1: 'File', 2: 'Map columns', 3: 'Preview', 4: 'Done' };
    setLiveMessage(`Step ${step} of 4, ${names[step]}`);
    const t = window.setTimeout(() => {
      bodyRef.current
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        )
        ?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [step, open]);

  // A half-acknowledged bulk write is worse than a 5-second wait: closing is
  // blocked while the import request is in flight (spec §4.2).
  const guardedClose = useCallback(() => {
    if (importing) return;
    onClose();
  }, [importing, onClose]);

  /* ── Step 1: parse ─────────────────────────────────────────────── */

  const handleFile = (file: File) => {
    setFileError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const fields = (res.meta.fields ?? []).filter((f) => f.trim() !== '');
        if (res.errors.length > 0) {
          const e = res.errors[0];
          setFileError(
            `Couldn't read this file as CSV: ${e.message}${
              typeof e.row === 'number' ? ` (row ${e.row + 1})` : ''
            }`,
          );
          return;
        }
        if (fields.length === 0) {
          setFileError('This file is empty.');
          return;
        }
        if (res.data.length === 0) {
          setFileError('This file has headers but no rows.');
          return;
        }
        if (res.data.length > MAX_ROWS) {
          setFileError(
            `This file has ${res.data.length} rows — the limit is ${MAX_ROWS} per import. Split the file and import in batches.`,
          );
          return;
        }
        setHeaders(fields);
        setRawRows(res.data);
        // Auto-map on entry to step 2 — first match wins, one header per field.
        const used = new Set<string>();
        const next = { ...mapping };
        (Object.keys(next) as TargetField[]).forEach((k) => {
          next[k] = '';
        });
        for (const [field, re] of AUTO_MAP) {
          const hit = fields.find(
            (h) => !used.has(h) && re.test(normalizeHeader(h)),
          );
          if (hit) {
            next[field] = hit;
            used.add(hit);
          }
        }
        setMapping(next);
        setStep(2);
      },
      error: (err) => {
        setFileError(`Couldn't read this file as CSV: ${err.message}`);
      },
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  /* ── Steps 2/3: mapping + normalization ────────────────────────── */

  const mappedFields = TARGET_FIELDS.filter((f) => mapping[f.key] !== '');

  const mapped: MappedRow[] = useMemo(() => {
    if (!mapping.title) return [];
    return rawRows.map((raw) => {
      const cell = (f: TargetField) =>
        mapping[f] ? (raw[mapping[f]] ?? '').trim() : '';
      const display: MappedRow['display'] = {};
      const title = cell('title');
      display.title = { text: title || '—', coerced: !title };
      const row: ImportRow = { title };

      if (mapping.desc) {
        const v = cell('desc');
        if (v) row.description = v;
        display.desc = { text: v || '', coerced: false };
      }
      if (mapping.status) {
        const v = cell('status');
        if (v) {
          const n = normalizeStatus(v);
          row.status = n.value;
          display.status = { text: n.text, coerced: n.coerced };
        } else {
          display.status = { text: '', coerced: false };
        }
      }
      if (mapping.priority) {
        const v = cell('priority');
        if (v) {
          const n = normalizePriority(v);
          row.priority = n.value;
          display.priority = { text: n.text, coerced: n.coerced };
        } else {
          display.priority = { text: '', coerced: false };
        }
      }
      if (mapping.labels) {
        const v = cell('labels');
        const labels = v ? splitLabels(v) : [];
        if (labels.length > 0) row.labels = labels;
        display.labels = { text: labels.join(', '), coerced: false };
      }
      if (mapping.dueDate) {
        const v = cell('dueDate');
        if (v) {
          const n = normalizeDate(v);
          if (n.value) row.dueDate = n.value;
          display.dueDate = { text: n.text, coerced: n.coerced };
        } else {
          display.dueDate = { text: '', coerced: false };
        }
      }
      if (mapping.assigneeEmail) {
        const v = cell('assigneeEmail');
        if (v) row.assigneeEmail = v;
        display.assigneeEmail = { text: v, coerced: false };
      }

      return { data: title ? row : null, display };
    });
  }, [rawRows, mapping]);

  const importableRows = useMemo(
    () => mapped.filter((m) => m.data !== null),
    [mapped],
  );
  const rejectedCount = mapped.length - importableRows.length;
  const projectName =
    projects.find((p) => p._id === projectId)?.name ?? 'this project';

  /* ── Step 3→4: import ──────────────────────────────────────────── */

  const runImport = () => {
    setRequestFailed(false);
    importMutation.mutate(
      {
        projectId,
        rows: importableRows.map((m) => m.data as ImportRow),
      },
      {
        onSuccess: (res) => {
          setResult(res);
          setStep(4);
        },
        onError: () => {
          setRequestFailed(true);
          setStep(4);
        },
      },
    );
  };

  /* ── Footers (step-owned) ──────────────────────────────────────── */

  const footer =
    step === 1 ? (
      <Button variant="ghost" onClick={guardedClose}>
        Cancel
      </Button>
    ) : step === 2 ? (
      <>
        <Button variant="ghost" onClick={() => setStep(1)}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={!mapping.title}
          onClick={() => setStep(3)}
        >
          Continue
        </Button>
      </>
    ) : step === 3 ? (
      <>
        <Button
          variant="ghost"
          disabled={importing}
          onClick={() => setStep(2)}
        >
          Back
        </Button>
        <Button
          variant="primary"
          disabled={importing || importableRows.length === 0}
          onClick={runImport}
        >
          {importing ? (
            <>
              <Spinner size={13} /> Importing…
            </>
          ) : (
            `Import ${importableRows.length} rows`
          )}
        </Button>
      </>
    ) : requestFailed ? (
      <>
        <Button variant="ghost" onClick={() => setStep(3)}>
          Back
        </Button>
        <Button variant="outline" onClick={guardedClose}>
          Close
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={guardedClose}>
        Done
      </Button>
    );

  return (
    <Modal
      open={open}
      onClose={guardedClose}
      title="Import work items"
      size="lg"
      footer={footer}
    >
      <span aria-live="polite" className="sr-only">
        {liveMessage}
      </span>

      <StepIndicator current={step} />

      <div
        ref={bodyRef}
        className={
          importing ? 'opacity-60 pointer-events-none' : undefined
        }
      >
        {step === 1 && (
          <div className="flex flex-col gap-3.5">
            <Field label="Project" required>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                options={projects.map((p) => ({
                  value: p._id,
                  label: p.name,
                }))}
                placeholder="Select project…"
                aria-label="Project"
              />
            </Field>

            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="block border border-dashed border-border rounded-lg py-10 text-center cursor-pointer hover:bg-bg-hover transition-colors"
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={!projectId}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
              <span className="text-[13px] text-text-sub">
                Drop a CSV here or{' '}
                <strong className="text-accent">browse</strong>
              </span>
              <span className="block text-[11px] text-text-muted mt-1">
                First row must be column headers · up to {MAX_ROWS} rows
              </span>
              {!projectId && (
                <span className="block text-[11px] text-text-muted mt-1">
                  Select a project first.
                </span>
              )}
            </label>

            {fileError && (
              <p role="alert" className="text-red text-xs">
                {fileError}
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-2.5">
            <Table>
              <THead>
                <tr>
                  <th>Field</th>
                  <th>CSV column</th>
                </tr>
              </THead>
              <TBody>
                {TARGET_FIELDS.map((f) => (
                  <TRow key={f.key}>
                    <td className="text-[13px] whitespace-nowrap">
                      {f.label}
                      {f.required && (
                        <span className="text-red ml-0.5" aria-hidden>
                          *
                        </span>
                      )}
                      {/* Visible cause for the disabled Continue (spec §4.4). */}
                      {f.required && !mapping[f.key] && (
                        <span className="ml-2 text-[11px] text-red">
                          required
                        </span>
                      )}
                    </td>
                    <td className="py-1">
                      <Select
                        size="sm"
                        value={mapping[f.key]}
                        onValueChange={(v) =>
                          setMapping((m) => ({ ...m, [f.key]: v }))
                        }
                        options={[
                          { value: '', label: '— skip —' },
                          ...headers.map((h) => ({
                            value: h,
                            label: truncate(h),
                          })),
                        ]}
                        aria-label={`CSV column for ${f.label}`}
                      />
                    </td>
                  </TRow>
                ))}
              </TBody>
            </Table>
            <p className="text-[11px] text-text-muted">
              Labels may be separated by commas or semicolons. Dates are read
              as YYYY-MM-DD (other formats are attempted). Unknown statuses
              become <em>todo</em>, unknown priorities <em>medium</em> — the
              preview shows the result.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-text-sub">
              <strong>{importableRows.length} rows</strong> will be imported
              into <strong>{projectName}</strong>.
            </p>
            {rejectedCount > 0 && (
              <p className="text-[12px] text-amber">
                {rejectedCount} row{rejectedCount === 1 ? '' : 's'} have no
                title and will be skipped.
              </p>
            )}
            <div className="max-h-[320px] overflow-y-auto">
              <Table>
                <THead>
                  <tr>
                    {mappedFields.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </THead>
                <TBody>
                  {importableRows.slice(0, 10).map((m, i) => (
                    <TRow key={i}>
                      {mappedFields.map((f) => {
                        const c = m.display[f.key];
                        return (
                          <td
                            key={f.key}
                            title={c?.text}
                            className={
                              'max-w-[180px] truncate text-[12px] ' +
                              (c?.coerced ? 'text-amber' : '')
                            }
                          >
                            {c?.text ?? ''}
                          </td>
                        );
                      })}
                    </TRow>
                  ))}
                </TBody>
              </Table>
            </div>
            {importableRows.length > 10 && (
              <p className="text-[11px] text-text-muted">
                Showing the first 10 of {importableRows.length} rows.
              </p>
            )}
          </div>
        )}

        {step === 4 && requestFailed && (
          <ErrorState
            message="Import failed — nothing was created."
            onRetry={runImport}
          />
        )}

        {step === 4 && !requestFailed && result && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="text-green w-6 h-6" aria-hidden />
              <p className="text-[14px]">
                <strong>
                  {result.created} work item{result.created === 1 ? '' : 's'}{' '}
                  created.
                </strong>
              </p>
            </div>
            {result.skipped.length > 0 && (
              <>
                <p className="text-[13px] text-text-sub">
                  {result.skipped.length} row
                  {result.skipped.length === 1 ? ' was' : 's were'} skipped:
                </p>
                <div className="max-h-[280px] overflow-y-auto">
                  <Table>
                    <caption className="sr-only">
                      Skipped rows and reasons
                    </caption>
                    <THead>
                      <tr>
                        <th>Row</th>
                        <th>Reason</th>
                      </tr>
                    </THead>
                    <TBody>
                      {result.skipped.map((s) => (
                        <TRow key={s.row}>
                          <td className="tabular-nums text-[12px]">{s.row}</td>
                          <td className="text-[12px]">{s.reason}</td>
                        </TRow>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Step indicator — local, plain text, not a new primitive ───────── */

function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ['File', 'Map columns', 'Preview', 'Done'];
  return (
    <nav aria-label="Import steps" className="mb-3.5">
      <ol className="flex items-center flex-wrap gap-1.5 text-[12px]">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="text-text-muted">
                ›
              </span>
            )}
            <span
              aria-current={current === i + 1 ? 'step' : undefined}
              className={
                current === i + 1
                  ? 'text-text font-medium'
                  : 'text-text-muted'
              }
            >
              {i + 1} {s}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
