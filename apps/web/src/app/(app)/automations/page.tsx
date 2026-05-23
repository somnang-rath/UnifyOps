'use client';
import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit2,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useAutomations, useAutomationMutations } from '@/hooks/use-automations';
import { AU_TRIGGERS, AU_ACTIONS } from '@/schemas/automation';
import type { Automation } from '@/schemas/automation';
import { relTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/* ── helpers ─────────────────────────────────────────────── */
const triggerLabel = (v: string) =>
  AU_TRIGGERS.find((t) => t.value === v)?.label ?? v;

const actionLabel = (a: Record<string, unknown>) => {
  const type = String(a.type ?? '');
  return (AU_ACTIONS.find((x) => x.value === type)?.label ?? type) || '—';
};

const TRIGGER_OPTS = AU_TRIGGERS.map((t) => ({ value: t.value, label: t.label }));
const ACTION_OPTS = AU_ACTIONS.map((a) => ({ value: a.value, label: a.label }));

/* ── form state ──────────────────────────────────────────── */
interface FormState {
  name: string;
  trigger: string;
  actionType: string;
  actionTarget: string;
  actionValue: string;
}

const emptyForm = (): FormState => ({
  name: '',
  trigger: AU_TRIGGERS[0].value,
  actionType: AU_ACTIONS[0].value,
  actionTarget: '',
  actionValue: '',
});

function formToBody(f: FormState) {
  return {
    name: f.name.trim(),
    trigger: f.trigger,
    condition: {},
    action: {
      type: f.actionType,
      target: f.actionTarget.trim() || undefined,
      value: f.actionValue.trim() || undefined,
    },
  };
}

/* ── page ────────────────────────────────────────────────── */
export default function AutomationsPage() {
  const { data: automations = [], isLoading } = useAutomations();
  const { create, update, remove } = useAutomationMutations();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [delTarget, setDelTarget] = useState<Automation | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (a: Automation) => {
    setEditing(a);
    setForm({
      name: a.name,
      trigger: a.trigger,
      actionType: String(a.action?.type ?? AU_ACTIONS[0].value),
      actionTarget: String(a.action?.target ?? ''),
      actionValue: String(a.action?.value ?? ''),
    });
    setModalOpen(true);
  };

  const handleSubmit = () => {
    const body = formToBody(form);
    if (!body.name) return;
    if (editing) {
      update.mutate({ id: editing._id, body }, { onSuccess: () => setModalOpen(false) });
    } else {
      create.mutate(body, { onSuccess: () => setModalOpen(false) });
    }
  };

  const toggleEnabled = (a: Automation) => {
    update.mutate({ id: a._id, body: { enabled: !a.enabled } });
  };

  const enabled = automations.filter((a) => a.enabled);
  const disabled = automations.filter((a) => !a.enabled);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent" />
            Automations
          </h1>
          <p className="text-[13px] text-text-muted mt-0.5">
            Create rules that trigger actions automatically
          </p>
        </div>
        <Button variant="grad" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5" /> New automation
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Total rules" value={automations.length} accent={false} />
        <StatCard label="Active" value={enabled.length} accent />
        <StatCard label="Paused" value={disabled.length} accent={false} />
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : automations.length === 0 ? (
        <EmptyState onNew={openCreate} />
      ) : (
        <div className="flex flex-col gap-2">
          {automations.map((a) => (
            <AutomationRow
              key={a._id}
              automation={a}
              expanded={expanded === a._id}
              onExpand={() => setExpanded(expanded === a._id ? null : a._id)}
              onEdit={() => openEdit(a)}
              onDelete={() => setDelTarget(a)}
              onToggle={() => toggleEnabled(a)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit automation' : 'New automation'}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="grad"
              onClick={handleSubmit}
              disabled={!form.name.trim() || create.isPending || update.isPending}
            >
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <Field label="Rule name">
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Notify on critical issue"
          />
        </Field>

        <div className="bg-bg-subtle border border-border rounded-lg p-4 flex flex-col gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-text-muted">
            Trigger — When this happens
          </p>
          <Select
            value={form.trigger}
            onValueChange={(v) => setForm((f) => ({ ...f, trigger: v }))}
            options={TRIGGER_OPTS}
          />
          {(() => {
            const meta = AU_TRIGGERS.find((t) => t.value === form.trigger);
            return meta ? (
              <p className="text-[12px] text-text-muted">{meta.desc}</p>
            ) : null;
          })()}
        </div>

        <div className="bg-bg-subtle border border-border rounded-lg p-4 flex flex-col gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[.06em] text-text-muted">
            Action — Do this
          </p>
          <Select
            value={form.actionType}
            onValueChange={(v) => setForm((f) => ({ ...f, actionType: v }))}
            options={ACTION_OPTS}
          />
          {(() => {
            const meta = AU_ACTIONS.find((a) => a.value === form.actionType);
            return meta ? (
              <p className="text-[12px] text-text-muted">{meta.desc}</p>
            ) : null;
          })()}

          {(form.actionType === 'notify' ||
            form.actionType === 'set_assignee') && (
            <Field label="Target (user email or role)">
              <Input
                value={form.actionTarget}
                onChange={(e) =>
                  setForm((f) => ({ ...f, actionTarget: e.target.value }))
                }
                placeholder="e.g. admin@demo.com or admin"
              />
            </Field>
          )}
          {(form.actionType === 'set_status' ||
            form.actionType === 'add_label' ||
            form.actionType === 'webhook') && (
            <Field
              label={
                form.actionType === 'webhook'
                  ? 'Webhook URL'
                  : form.actionType === 'set_status'
                    ? 'New status'
                    : 'Label'
              }
            >
              <Input
                value={form.actionValue}
                onChange={(e) =>
                  setForm((f) => ({ ...f, actionValue: e.target.value }))
                }
                placeholder={
                  form.actionType === 'webhook'
                    ? 'https://…'
                    : form.actionType === 'set_status'
                      ? 'todo / inprogress / done'
                      : 'label name'
                }
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Delete confirm */}
      <Confirm
        open={!!delTarget}
        title="Delete automation"
        body={`Delete "${delTarget?.name}"? This cannot be undone.`}
        danger
        onConfirm={() => {
          if (delTarget) remove.mutate(delTarget._id);
          setDelTarget(null);
        }}
        onClose={() => setDelTarget(null)}
      />
    </>
  );
}

/* ── sub-components ──────────────────────────────────────── */
function AutomationRow({
  automation: a,
  expanded,
  onExpand,
  onEdit,
  onDelete,
  onToggle,
}: {
  automation: Automation;
  expanded: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'bg-bg-card border rounded-lg transition-all duration-[var(--dur)]',
        a.enabled ? 'border-border' : 'border-border opacity-60',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Status indicator */}
        <button
          type="button"
          onClick={onToggle}
          title={a.enabled ? 'Pause automation' : 'Enable automation'}
          className="flex-shrink-0"
        >
          {a.enabled ? (
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
          ) : (
            <XCircle className="w-4.5 h-4.5 text-text-muted" />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold truncate">{a.name}</span>
            <span
              className={cn(
                'text-[10px] font-bold uppercase tracking-wider px-1.5 py-px rounded-full',
                a.enabled
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-bg-subtle text-text-muted',
              )}
            >
              {a.enabled ? 'Active' : 'Paused'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-text-muted mt-0.5">
            <span className="font-mono bg-bg-subtle px-1.5 py-px rounded text-[11px]">
              {triggerLabel(a.trigger)}
            </span>
            <span>→</span>
            <span className="font-mono bg-bg-subtle px-1.5 py-px rounded text-[11px]">
              {actionLabel(a.action)}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-4 text-[12px] text-text-muted mr-2">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {a.timesFired} runs
          </span>
          {a.lastFired && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {relTime(a.lastFired)}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
            title="Edit"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-red transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onExpand}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 transition-transform duration-200',
                expanded && 'rotate-180',
              )}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border">
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12.5px]">
            <Detail label="Trigger" value={triggerLabel(a.trigger)} />
            <Detail label="Action" value={actionLabel(a.action)} />
            {!!a.action?.target && (
              <Detail label="Target" value={String(a.action.target)} />
            )}
            {!!a.action?.value && (
              <Detail label="Value" value={String(a.action.value)} />
            )}
            <Detail label="Times fired" value={String(a.timesFired)} />
            <Detail
              label="Last fired"
              value={a.lastFired ? relTime(a.lastFired) : 'Never'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-[.06em] text-text-muted">
        {label}
      </span>
      <span className="text-[13px]">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-4 bg-bg-card border border-border rounded-lg">
      <div
        className={cn(
          'w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0',
          accent
            ? 'bg-accent/10 text-accent'
            : 'bg-bg-subtle text-text-muted',
        )}
      >
        <Zap className="w-4 h-4" />
      </div>
      <div>
        <div className="text-[20px] font-bold tracking-tight">{value}</div>
        <div className="text-[11px] text-text-muted">{label}</div>
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-bg-card border border-dashed border-border rounded-xl text-center gap-3">
      <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
        <Zap className="w-6 h-6 text-accent" />
      </div>
      <div>
        <p className="text-[15px] font-semibold">No automations yet</p>
        <p className="text-[13px] text-text-muted mt-1">
          Create your first rule to automate repetitive tasks
        </p>
      </div>
      <Button variant="grad" onClick={onNew}>
        <Plus className="w-3.5 h-3.5" /> New automation
      </Button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[72px] rounded-lg bg-bg-card border border-border animate-pulse"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}
