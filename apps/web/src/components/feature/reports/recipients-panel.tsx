'use client';
import { useState, useRef, useEffect } from 'react';
import type {
  ReportRecipient,
  ReportPermissions,
  ReportDataRecipientsConfig,
  ReportPerRecipientUrlConfig,
  ReportBlocklistEntry,
} from '@/schemas/report';
import { useUsers } from '@/hooks/use-users';
import { useBlocklistMutations, useFetchCpoList, useReport, type CpoPreviewEntry } from '@/hooks/use-reports';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AtSign, Ban, Check, ChevronDown, ChevronRight, ChevronUp,
  Download, FileText, Link2, Loader2, Mail, RefreshCw, Shield,
  Trash2, UserPlus, Users, Zap,
} from 'lucide-react';

/* ── types ─────────────────────────────────────────────────────────────── */

interface Props {
  recipients:     ReportRecipient[];
  permissions:    ReportPermissions;
  /** Full config for auto-recipients-from-API-data mode (Mode A) */
  dataRecipientsConfig?: ReportDataRecipientsConfig;
  /** Per-Recipient URL mode config (Mode C) */
  perRecipientUrlConfig?: ReportPerRecipientUrlConfig;
  /** Current blocklist entries (from template) */
  blocklist?: ReportBlocklistEntry[];
  /** MongoDB _id of the saved template — needed for server-side blocklist mutations */
  templateId?: string;
  onChangeRecipients:               (r: ReportRecipient[]) => void;
  onChangePermissions:              (p: ReportPermissions) => void;
  onChangeDataRecipientsConfig?:    (c: ReportDataRecipientsConfig) => void;
  onChangePerRecipientUrlConfig?:   (c: ReportPerRecipientUrlConfig) => void;
}

type RecipientTab = 'team' | 'external';

/* ── helpers ────────────────────────────────────────────────────────────── */

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const COLORS = [
  'bg-accent-100 text-accent-700 dark:bg-accent-900/50 dark:text-accent-400',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-400',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
];
function avatarCls(s: string) {
  return COLORS[s.charCodeAt(0) % COLORS.length];
}

function Avatar({ value, external }: { value: string; external?: boolean }) {
  return (
    <div className={cn(
      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
      external
        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-400'
        : avatarCls(value),
    )}>
      {value.trim()[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2 rounded-xl border border-dashed border-border bg-bg-subtle/50">
      <div className="text-text-muted opacity-25">{icon}</div>
      <p className="text-xs text-text-muted text-center leading-relaxed">{text}</p>
    </div>
  );
}

function SectionLabel({ icon, label, count }: { icon: React.ReactNode; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-text-muted">{icon}</span>
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</span>
      {count != null && count > 0 && (
        <span className="bg-accent-100 text-accent-700 dark:bg-accent-900/50 dark:text-accent-400 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
          {count}
        </span>
      )}
    </div>
  );
}

/* ── Toggle switch ──────────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
        checked ? 'bg-accent-600' : 'bg-bg-subtle border border-border',
      )}
    >
      <span className={cn(
        'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
        checked ? 'left-[calc(100%-18px)]' : 'left-0.5',
      )} />
    </button>
  );
}

/* ── Field input ─────────────────────────────────────────────────────────── */
function FieldInput({
  label, value, placeholder, onChange, hint, optional,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide">{label}</label>
        {optional && <span className="text-[9px] text-text-muted bg-bg-subtle border border-border rounded px-1">optional</span>}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-xs px-2.5 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors placeholder:text-text-muted"
      />
      {hint && <p className="text-[10px] text-text-muted mt-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Auto-recipients section
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_DATA_RECIPIENTS_CONFIG: ReportDataRecipientsConfig = {
  enabled: false,
  emailField: '',
  nameField: '',
  dataPath: '',
  url: '',
};

function AutoRecipientsSection({
  config,
  onChange,
}: {
  config: ReportDataRecipientsConfig;
  onChange: (c: ReportDataRecipientsConfig) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const patch = (partial: Partial<ReportDataRecipientsConfig>) =>
    onChange({ ...config, ...partial });

  const hasAdvanced = !!(config.nameField || config.dataPath || config.url);

  return (
    <div className={cn(
      'rounded-2xl border transition-all duration-200 overflow-hidden',
      config.enabled
        ? 'border-accent-300 dark:border-accent-700'
        : 'border-border',
    )}>
      {/* ── Toggle header ── */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 transition-colors',
        config.enabled
          ? 'bg-accent-600 dark:bg-accent-700'
          : 'bg-bg-subtle',
      )}>
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0',
            config.enabled ? 'bg-white/20' : 'bg-bg-hover',
          )}>
            <Zap className={cn('w-4 h-4', config.enabled ? 'text-white' : 'text-text-muted')} />
          </div>
          <div>
            <p className={cn('text-xs font-semibold leading-tight', config.enabled ? 'text-white' : 'text-text')}>
              Auto-recipients from API
            </p>
            <p className={cn('text-[10px] leading-tight mt-0.5', config.enabled ? 'text-white/70' : 'text-text-muted')}>
              {config.enabled ? 'Emails extracted from JSON at send time' : 'Off — using manual list'}
            </p>
          </div>
        </div>
        <Toggle checked={config.enabled} onChange={(v) => patch({ enabled: v })} />
      </div>

      {/* ── Config fields ── */}
      {config.enabled && (
        <div className="bg-bg-card">
          {/* How it works — minimal 3-step flow */}
          <div className="flex items-center gap-0 px-4 pt-4 pb-3 border-b border-border">
            {[
              { icon: Link2,        label: 'Fetch API' },
              { icon: AtSign,       label: 'Extract emails' },
              { icon: Mail,         label: 'Send filtered PDF' },
            ].map(({ icon: Icon, label }, i, arr) => (
              <div key={label} className="flex items-center gap-0 flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-accent-100 dark:bg-accent-900/40 border border-accent-200 dark:border-accent-700 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400" />
                  </div>
                  <span className="text-[9px] font-medium text-text-muted text-center leading-tight whitespace-nowrap">{label}</span>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-border flex-shrink-0 mb-4" />
                )}
              </div>
            ))}
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* Email Field — primary, prominent */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-text">Email Field</label>
                <span className="text-[9px] font-bold text-accent-600 dark:text-accent-400 bg-accent-100 dark:bg-accent-900/40 border border-accent-200 dark:border-accent-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">required</span>
              </div>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input
                  type="text"
                  value={config.emailField}
                  onChange={(e) => patch({ emailField: e.target.value })}
                  placeholder="email"
                  className={cn(
                    'w-full text-xs pl-8 pr-3 py-2 rounded-lg border bg-bg-input focus:outline-none transition-colors font-mono',
                    config.emailField
                      ? 'border-accent-300 dark:border-accent-600 focus:border-accent-500'
                      : 'border-border focus:border-accent-400',
                  )}
                />
              </div>
              <p className="text-[10px] text-text-muted mt-1.5">
                Field name in each JSON row containing the email address.{' '}
                <span className="text-text-sub font-medium">Nested:</span>{' '}
                <code className="bg-bg-subtle border border-border rounded px-1 text-accent-600">contact.email</code>
              </p>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-dashed border-border hover:border-accent-300 hover:bg-accent-50/50 dark:hover:bg-accent-950/20 transition-all group"
            >
              <span className="text-[10px] font-semibold text-text-muted group-hover:text-text-sub transition-colors uppercase tracking-wider">
                Advanced options
                {hasAdvanced && !advancedOpen && (
                  <span className="ml-1.5 text-[9px] font-bold text-accent-600 dark:text-accent-400 bg-accent-100 dark:bg-accent-900/40 px-1.5 py-0.5 rounded-full">configured</span>
                )}
              </span>
              {advancedOpen
                ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
                : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
            </button>

            {/* Advanced fields */}
            {advancedOpen && (
              <div className="space-y-3 pl-3 border-l-2 border-accent-200 dark:border-accent-800 animate-fade-in">

                {/* Name field */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide">Name Field</label>
                    <span className="text-[9px] text-text-muted bg-bg-subtle border border-border rounded px-1">optional</span>
                  </div>
                  <input
                    type="text"
                    value={config.nameField ?? ''}
                    onChange={(e) => patch({ nameField: e.target.value })}
                    placeholder="cpo_name"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors font-mono placeholder:text-text-muted placeholder:font-sans"
                  />
                  <p className="text-[10px] text-text-muted mt-1">Used in email subject — e.g. <code className="bg-bg-subtle rounded px-1">cpo_name</code></p>
                </div>

                {/* Data path */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide">Data Path</label>
                    <span className="text-[9px] text-text-muted bg-bg-subtle border border-border rounded px-1">optional</span>
                  </div>
                  <input
                    type="text"
                    value={config.dataPath ?? ''}
                    onChange={(e) => patch({ dataPath: e.target.value })}
                    placeholder="data.cpos"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors font-mono placeholder:text-text-muted placeholder:font-sans"
                  />
                  <p className="text-[10px] text-text-muted mt-1">
                    Path to array inside response. Leave empty when root <em>is</em> the array.
                  </p>
                </div>

                {/* Custom URL */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide">Recipient URL</label>
                    <span className="text-[9px] text-text-muted bg-bg-subtle border border-border rounded px-1">optional</span>
                  </div>
                  <input
                    type="text"
                    value={config.url ?? ''}
                    onChange={(e) => patch({ url: e.target.value })}
                    placeholder="https://api.example.com/recipients"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors placeholder:text-text-muted"
                  />
                  <p className="text-[10px] text-text-muted mt-1">
                    Leave empty to reuse the data element&apos;s URL.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Per-Recipient URL section (Mode C)
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_PER_RECIPIENT_URL_CONFIG: ReportPerRecipientUrlConfig = {
  enabled: false,
  listUrl: '',
  listDataPath: '',
  idField: 'id',
  emailField: 'email',
  nameField: '',
  dataUrlTemplate: '',
};

function PerRecipientUrlSection({
  config,
  templateId,
  blocklist = [],
  onChange,
}: {
  config: ReportPerRecipientUrlConfig;
  templateId?: string;
  blocklist?: ReportBlocklistEntry[];
  onChange: (c: ReportPerRecipientUrlConfig) => void;
}) {
  const [advancedOpen, setAdvancedOpen]         = useState(false);
  const [cpoPreview, setCpoPreview]             = useState<CpoPreviewEntry[] | null>(null);
  const [cpoCount, setCpoCount]                 = useState<number | null>(null);
  const [fetchError, setFetchError]             = useState<string | null>(null);
  const fetchMutation                           = useFetchCpoList(templateId);
  const { add: blockAdd, remove: blockRemove }  = useBlocklistMutations(templateId ?? '');

  const isBlocked = (email: unknown): boolean => {
    if (!email || typeof email !== 'string') return false;
    return blocklist.some((e) => e.email === email.toLowerCase());
  };
  const toggleBlock = (email: unknown) => {
    if (!email || typeof email !== 'string' || !templateId) return;
    const entry = blocklist.find((e) => e.email === email.toLowerCase());
    if (entry) blockRemove.mutate(entry.id);
    else blockAdd.mutate({ email: email.toLowerCase() });
  };

  const patch = (partial: Partial<ReportPerRecipientUrlConfig>) =>
    onChange({ ...config, ...partial });

  const hasAdvanced = !!(config.nameField || config.listDataPath);

  const handleFetchList = () => {
    if (!config.listUrl) return;
    setFetchError(null);
    setCpoPreview(null);
    setCpoCount(null);
    fetchMutation.mutate(
      {
        listUrl:      config.listUrl,
        listDataPath: config.listDataPath || undefined,
        idField:      config.idField      || 'id',
        emailField:   config.emailField   || 'email',
        nameField:    config.nameField    || undefined,
      },
      {
        onSuccess: (data) => {
          setCpoCount(data.count);
          setCpoPreview(data.preview);
        },
        onError: (err) => {
          setFetchError((err as Error).message ?? 'Failed to fetch CPO list');
        },
      },
    );
  };

  const hasTemplateId = !!(templateId && templateId !== 'new');

  return (
    <div className={cn(
      'rounded-2xl border transition-all duration-200 overflow-hidden',
      config.enabled
        ? 'border-violet-400 dark:border-violet-600'
        : 'border-border',
    )}>
      {/* ── Toggle header ── */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 transition-colors',
        config.enabled
          ? 'bg-violet-600 dark:bg-violet-700'
          : 'bg-bg-subtle',
      )}>
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0',
            config.enabled ? 'bg-white/20' : 'bg-bg-hover',
          )}>
            <Link2 className={cn('w-4 h-4', config.enabled ? 'text-text' : 'text-text-muted')} />
          </div>
          <div>
            <p className={cn('text-xs font-semibold leading-tight', config.enabled ? 'text-text' : 'text-text')}>
              Per-CPO URL Mode
            </p>
            <p className={cn('text-[10px] leading-tight mt-0.5', config.enabled ? 'text-text' : 'text-text-muted')}>
              {config.enabled ? 'Fetches a dedicated URL per CPO at send time' : 'Off — using auto or manual mode'}
            </p>
          </div>
        </div>
        <Toggle checked={config.enabled} onChange={(v) => patch({ enabled: v })} />
      </div>

      {/* ── Config fields ── */}
      {config.enabled && (
        <div className="bg-bg-card">
          {/* How it works */}
          <div className="flex items-center gap-0 px-4 pt-4 pb-3 border-b border-border">
            {[
              { icon: Link2,   label: 'Fetch list' },
              { icon: AtSign,  label: 'Extract CPOs' },
              { icon: RefreshCw, label: 'Fetch per-CPO' },
              { icon: Mail,    label: 'Send PDF' },
            ].map(({ icon: Icon, label }, i, arr) => (
              <div key={label} className="flex items-center gap-0 flex-1 min-w-0">
                <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-700 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="text-[9px] font-medium text-text-muted text-center leading-tight whitespace-nowrap">{label}</span>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-border flex-shrink-0 mb-4" />
                )}
              </div>
            ))}
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* List URL */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-text">List URL</label>
                <span className="text-[9px] font-bold text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">required</span>
              </div>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                <input
                  type="url"
                  value={config.listUrl}
                  onChange={(e) => { patch({ listUrl: e.target.value }); setCpoPreview(null); setCpoCount(null); setFetchError(null); }}
                  placeholder="https://api.example.com/cpos"
                  className={cn(
                    'w-full text-xs pl-8 pr-3 py-2 rounded-lg border bg-bg-input focus:outline-none transition-colors',
                    config.listUrl
                      ? 'border-violet-300 dark:border-violet-600 focus:border-violet-500'
                      : 'border-border focus:border-violet-400',
                  )}
                />
              </div>
              <p className="text-[10px] text-text-muted mt-1.5">Returns the array of all CPOs (list endpoint).</p>
            </div>

            {/* ID Field + Email Field — two column */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1 block">ID Field</label>
                <input
                  type="text"
                  value={config.idField}
                  onChange={(e) => patch({ idField: e.target.value })}
                  placeholder="id"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-violet-400 transition-colors font-mono placeholder:font-sans placeholder:text-text-muted"
                />
                <p className="text-[10px] text-text-muted mt-1">Unique CPO ID field</p>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1 block">Email Field</label>
                <input
                  type="text"
                  value={config.emailField}
                  onChange={(e) => patch({ emailField: e.target.value })}
                  placeholder="email"
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-violet-400 transition-colors font-mono placeholder:font-sans placeholder:text-text-muted"
                />
                <p className="text-[10px] text-text-muted mt-1">CPO email field</p>
              </div>
            </div>

            {/* Data URL Template */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-text">Data URL Template</label>
                <span className="text-[9px] font-bold text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">required</span>
              </div>
              <input
                type="text"
                value={config.dataUrlTemplate}
                onChange={(e) => patch({ dataUrlTemplate: e.target.value })}
                placeholder="https://api.example.com/cpos/{id}"
                className={cn(
                  'w-full text-xs px-3 py-2 rounded-lg border bg-bg-input focus:outline-none transition-colors',
                  config.dataUrlTemplate && !config.dataUrlTemplate.includes('{id}')
                    ? 'border-amber-400 focus:border-amber-500'
                    : config.dataUrlTemplate
                      ? 'border-violet-300 dark:border-violet-600 focus:border-violet-500'
                      : 'border-border focus:border-violet-400',
                )}
              />
              {config.dataUrlTemplate && !config.dataUrlTemplate.includes('{id}') && (
                <p className="text-[10px] text-amber-500 mt-1 font-medium">Must contain <code className="bg-amber-50 dark:bg-amber-950/30 rounded px-1">{'{id}'}</code> placeholder</p>
              )}
              {(!config.dataUrlTemplate || config.dataUrlTemplate.includes('{id}')) && (
                <p className="text-[10px] text-text-muted mt-1">
                  <code className="bg-bg-subtle border border-border rounded px-1 text-violet-600">{'{id}'}</code> is replaced with each CPO&apos;s ID at send time.
                </p>
              )}
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-dashed border-border hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-all group"
            >
              <span className="text-[10px] font-semibold text-text-muted group-hover:text-text-sub transition-colors uppercase tracking-wider">
                Advanced options
                {hasAdvanced && !advancedOpen && (
                  <span className="ml-1.5 text-[9px] font-bold text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 rounded-full">configured</span>
                )}
              </span>
              {advancedOpen
                ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
                : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
            </button>

            {advancedOpen && (
              <div className="space-y-3 pl-3 border-l-2 border-violet-200 dark:border-violet-800 animate-fade-in">
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide">Name Field</label>
                    <span className="text-[9px] text-text-muted bg-bg-subtle border border-border rounded px-1">optional</span>
                  </div>
                  <input
                    type="text"
                    value={config.nameField}
                    onChange={(e) => patch({ nameField: e.target.value })}
                    placeholder="name"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-violet-400 transition-colors font-mono placeholder:font-sans placeholder:text-text-muted"
                  />
                  <p className="text-[10px] text-text-muted mt-1">Used in email subject — e.g. <code className="bg-bg-subtle rounded px-1">company_name</code></p>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide">List Data Path</label>
                    <span className="text-[9px] text-text-muted bg-bg-subtle border border-border rounded px-1">optional</span>
                  </div>
                  <input
                    type="text"
                    value={config.listDataPath}
                    onChange={(e) => patch({ listDataPath: e.target.value })}
                    placeholder="data.cpos"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-border bg-bg-input focus:outline-none focus:border-violet-400 transition-colors font-mono placeholder:font-sans placeholder:text-text-muted"
                  />
                  <p className="text-[10px] text-text-muted mt-1">
                    Path to array inside list response. Leave empty when root <em>is</em> the array.
                  </p>
                </div>
              </div>
            )}

            {/* Test / Fetch button */}
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchList}
                disabled={!config.listUrl || fetchMutation.isPending || !hasTemplateId}
                className="w-full gap-2 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              >
                {fetchMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
                {fetchMutation.isPending ? 'Fetching…' : !hasTemplateId ? 'Save template first to test' : 'Fetch CPO List'}
              </Button>

              {/* Error state */}
              {fetchError && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-[10px] text-red-600 dark:text-red-400 animate-fade-in">
                  {fetchError}
                </div>
              )}

              {/* Success: count badge + preview */}
              {cpoCount !== null && cpoPreview && (
                <div className="mt-3 animate-fade-in">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-700 px-2 py-0.5 rounded-full">
                      {cpoCount} CPO{cpoCount !== 1 ? 's' : ''} found
                    </span>
                    {cpoCount > 5 && (
                      <span className="text-[10px] text-text-muted">showing first 5</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {cpoPreview.map((cpo, i) => {
                      const blocked = isBlocked(cpo.email);
                      return (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors',
                            blocked
                              ? 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20'
                              : 'border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/20',
                          )}
                        >
                          <div className={cn(
                            'w-6 h-6 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0',
                            blocked
                              ? 'bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-300'
                              : 'bg-violet-200 dark:bg-violet-800 text-violet-700 dark:text-violet-300',
                          )}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn(
                                'text-[10px] font-semibold truncate',
                                blocked ? 'text-red-700 dark:text-red-300 line-through' : 'text-text',
                              )}>
                                {String(cpo.email ?? '–')}
                              </span>
                              {cpo.name != null && (
                                <span className="text-[10px] text-text-muted truncate">
                                  · {String(cpo.name)}
                                </span>
                              )}
                            </div>
                            <div className="text-[9px] text-text-muted font-mono truncate mt-0.5">
                              ID: {String(cpo.id ?? '–')}
                            </div>
                          </div>
                          {hasTemplateId && typeof cpo.email === 'string' && (
                            <button
                              type="button"
                              onClick={() => toggleBlock(cpo.email)}
                              title={blocked ? 'Remove from blocklist' : 'Add to blocklist'}
                              className={cn(
                                'flex-shrink-0 p-1 rounded-md transition-colors',
                                blocked
                                  ? 'text-red-500 hover:text-red-700 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/60'
                                  : 'text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30',
                              )}
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!hasTemplateId && <Check className="w-3 h-3 text-violet-500 flex-shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Blocklist section
   ═══════════════════════════════════════════════════════════════════════════ */

function BlocklistSection({
  blocklist,
  templateId,
}: {
  blocklist: ReportBlocklistEntry[];
  templateId: string;
}) {
  const { add, remove } = useBlocklistMutations(templateId);
  const [open, setOpen]     = useState(false);
  const [email, setEmail]   = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr]       = useState('');

  const handleAdd = () => {
    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(trimmed)) { setErr('Invalid email address'); return; }
    if (blocklist.some((e) => e.email === trimmed)) { setErr('Already in blocklist'); return; }
    setErr('');
    add.mutate({ email: trimmed, reason: reason.trim() || undefined });
    setEmail('');
    setReason('');
    setOpen(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <SectionLabel
          icon={<Ban className="w-3.5 h-3.5" />}
          label="Blocklist"
          count={blocklist.length}
        />
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] text-accent-600 hover:text-accent-700 font-semibold flex items-center gap-0.5 transition-colors"
        >
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {open ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {open && (
        <div className="mb-2 p-3 rounded-xl border border-border bg-bg-subtle/50 space-y-2 animate-fade-in">
          <div>
            <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1 block">Email</label>
            <div className="relative">
              <AtSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="cpo@example.com"
                className={cn(
                  'w-full text-xs pl-6 pr-2 py-1.5 rounded-md border bg-bg-input focus:outline-none transition-colors',
                  err ? 'border-red-400' : 'border-border focus:border-accent-400',
                )}
              />
            </div>
            {err && <p className="text-[10px] text-red-500 mt-0.5">{err}</p>}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-text-sub uppercase tracking-wide mb-1 block">
              Reason <span className="font-normal normal-case text-text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Inactive CPO, unsubscribed"
              className="w-full text-xs px-2.5 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors placeholder:text-text-muted"
            />
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={handleAdd}
            disabled={add.isPending || !email.trim()}
            className="w-full gap-1.5"
          >
            <Ban className="w-3 h-3" />
            {add.isPending ? 'Adding…' : 'Block this email'}
          </Button>
        </div>
      )}

      {/* Entries list */}
      {blocklist.length > 0 ? (
        <div className="space-y-1.5">
          {blocklist.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-red-200 bg-red-50/60 dark:border-red-800 dark:bg-red-950/20 animate-fade-in"
            >
              <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center flex-shrink-0">
                <Ban className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-red-800 dark:text-red-300 truncate">{entry.email}</div>
                {entry.reason && (
                  <div className="text-[10px] text-red-500 dark:text-red-400 truncate">{entry.reason}</div>
                )}
              </div>
              <button
                onClick={() => remove.mutate(entry.id)}
                disabled={remove.isPending}
                className="text-red-400 hover:text-red-600 transition-colors p-0.5 flex-shrink-0"
                title="Remove from blocklist"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Ban className="w-6 h-6" />}
          text={<>No blocked addresses.<br />All recipients will receive this report.</>}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main panel
   ═══════════════════════════════════════════════════════════════════════════ */

export function RecipientsPanel({
  recipients,
  permissions,
  dataRecipientsConfig,
  perRecipientUrlConfig,
  blocklist,
  templateId,
  onChangeRecipients,
  onChangePermissions,
  onChangeDataRecipientsConfig,
  onChangePerRecipientUrlConfig,
}: Props) {
  const { data: users } = useUsers();
  const { data: liveTemplate } = useReport(templateId ?? null);
  const liveBlocklist = liveTemplate?.blocklist ?? blocklist ?? [];

  const [tab, setTab]               = useState<RecipientTab>('team');
  const [addUserId, setAddUserId]   = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');

  const [justAdded, setJustAdded]   = useState<string | null>(null);
  const justAddedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (justAdded && justAddedRef.current) {
      justAddedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [justAdded]);

  const flashAdded = (key: string) => {
    setJustAdded(key);
    setTimeout(() => setJustAdded(null), 2000);
  };

  const cfg    = dataRecipientsConfig     ?? DEFAULT_DATA_RECIPIENTS_CONFIG;
  const cpoUrl = perRecipientUrlConfig    ?? DEFAULT_PER_RECIPIENT_URL_CONFIG;

  // Mode C takes priority: when enabled, grey out auto + manual
  const modeCActive = cpoUrl.enabled && !!onChangePerRecipientUrlConfig;

  const teamRecipients     = recipients.filter((r) => r.userId);
  const externalRecipients = recipients.filter((r) => r.email);

  const addTeamMember = () => {
    if (!addUserId || recipients.some((r) => r.userId === addUserId)) return;
    onChangeRecipients([
      ...recipients,
      { userId: addUserId, canDownload: true, formats: [...permissions.allowedFormats] },
    ]);
    flashAdded(addUserId);
    setAddUserId('');
  };

  const addExternalEmail = () => {
    const email = emailInput.trim().toLowerCase();
    if (!isValidEmail(email)) { setEmailError('Invalid email address'); return; }
    if (recipients.some((r) => r.email === email)) { setEmailError('Already added'); return; }
    setEmailError('');
    onChangeRecipients([
      ...recipients,
      { email, canDownload: true, formats: [...permissions.allowedFormats] },
    ]);
    flashAdded(email);
    setEmailInput('');
  };

  const removeByUserId = (userId: string) =>
    onChangeRecipients(recipients.filter((r) => r.userId !== userId));
  const removeByEmail = (email: string) =>
    onChangeRecipients(recipients.filter((r) => r.email !== email));

  const userName   = (id: string) => users?.find((u) => u._id === id)?.name ?? id;
  const available  = (users ?? []).filter((u) => !recipients.some((r) => r.userId === u._id));

  return (
    <div className="space-y-5">

      {/* ── Permissions ────────────────────────────────────────────────── */}
      <div>
        <SectionLabel icon={<Shield className="w-3.5 h-3.5" />} label="Permissions" />
        <div className="p-3 rounded-xl border border-border bg-bg-subtle/50 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs text-text-sub">Allow download</span>
            </div>
            <Toggle
              checked={permissions.allowDownload}
              onChange={(v) => onChangePermissions({ ...permissions, allowDownload: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs text-text-sub">Formats</span>
            </div>
            <div className="flex items-center gap-1">
              {(['pdf', 'xlsx'] as const).map((fmt) => {
                const active = permissions.allowedFormats.includes(fmt);
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? permissions.allowedFormats.filter((f) => f !== fmt)
                        : [...permissions.allowedFormats, fmt];
                      if (next.length === 0) return;
                      onChangePermissions({ ...permissions, allowedFormats: next });
                    }}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wide transition-colors',
                      active
                        ? 'bg-accent-100 text-accent-700 border-accent-300 dark:bg-accent-900/50 dark:text-accent-400 dark:border-accent-700'
                        : 'bg-bg-card text-text-muted border-border hover:border-accent-300',
                    )}
                  >{fmt}</button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Per-CPO URL mode (Mode C) — shown first, highest priority ─── */}
      {onChangePerRecipientUrlConfig && (
        <div>
          <SectionLabel icon={<Link2 className="w-3.5 h-3.5" />} label="Per-CPO URL" />
          <PerRecipientUrlSection
            config={cpoUrl}
            templateId={templateId}
            blocklist={liveBlocklist}
            onChange={onChangePerRecipientUrlConfig}
          />
        </div>
      )}

      {/* ── Auto-recipients from API data (Mode A) — greyed when Mode C on ── */}
      {onChangeDataRecipientsConfig && (
        <div className={cn('transition-opacity', modeCActive ? 'opacity-40 pointer-events-none select-none' : '')}>
          <SectionLabel icon={<Zap className="w-3.5 h-3.5" />} label="Auto-recipients" />
          <AutoRecipientsSection config={cfg} onChange={onChangeDataRecipientsConfig} />
          {modeCActive && (
            <p className="text-[10px] text-text-muted mt-1.5 text-center">Overridden by Per-CPO URL Mode</p>
          )}
        </div>
      )}

      {/* ── Manual recipients (shown always; greyed when auto-mode or Mode C on) ── */}
      <div className={cn('transition-opacity', (cfg.enabled && onChangeDataRecipientsConfig) || modeCActive ? 'opacity-40 pointer-events-none select-none' : '')}>
        <div className="flex items-center gap-1.5 mb-2">
          <Mail className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Manual Recipients
          </span>
          {recipients.length > 0 && (
            <span className="bg-accent-100 text-accent-700 dark:bg-accent-900/50 dark:text-accent-400 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
              {recipients.length}
            </span>
          )}
          {(modeCActive || (cfg.enabled && onChangeDataRecipientsConfig)) && (
            <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
              {modeCActive ? 'Overridden by Per-CPO URL' : 'Overridden by auto-mode'}
            </span>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-0.5 bg-bg-subtle border border-border rounded-lg p-0.5 mb-3">
          {(['team', 'external'] as RecipientTab[]).map((t) => {
            const count = t === 'team' ? teamRecipients.length : externalRecipients.length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all',
                  tab === t
                    ? 'bg-bg-card text-text shadow-sm'
                    : 'text-text-muted hover:text-text',
                )}
              >
                {t === 'team' ? <Users className="w-3 h-3 flex-shrink-0" /> : <AtSign className="w-3 h-3 flex-shrink-0" />}
                {t === 'team' ? 'Team' : 'External'}
                {count > 0 && (
                  <span className={cn(
                    'text-[9px] px-1 rounded-full font-bold',
                    t === 'team'
                      ? 'bg-accent-100 text-accent-600 dark:bg-accent-900/50 dark:text-accent-400'
                      : 'bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-400',
                  )}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Team tab ─────────────────────────────── */}
        {tab === 'team' && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-accent-400 transition-colors"
              >
                <option value="">Select team member…</option>
                {available.map((u) => (
                  <option key={u._id} value={u._id}>{u.name}</option>
                ))}
              </select>
              <Button size="sm" variant="primary" onClick={addTeamMember} disabled={!addUserId} className="gap-1 flex-shrink-0">
                <UserPlus className="w-3 h-3" />
              </Button>
            </div>

            {teamRecipients.length > 0 ? (
              <div className="space-y-1.5">
                {teamRecipients.map((r) => {
                  const name  = userName(r.userId!);
                  const isNew = justAdded === r.userId;
                  return (
                    <div
                      key={r.userId}
                      ref={isNew ? justAddedRef : null}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-300 animate-fade-in',
                        isNew
                          ? 'border-accent-400 bg-accent-50 dark:bg-accent-950/30 shadow-sm'
                          : 'border-border bg-bg-subtle',
                      )}
                    >
                      <Avatar value={name} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{name}</div>
                        <div className="text-[10px] text-text-muted">Team member · PDF report</div>
                      </div>
                      {isNew && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-accent-600 dark:text-accent-400 bg-accent-100 dark:bg-accent-900/40 px-2 py-0.5 rounded-full flex-shrink-0">
                          <Check className="w-2.5 h-2.5" /> Added
                        </span>
                      )}
                      <button onClick={() => removeByUserId(r.userId!)} className="text-text-muted hover:text-red-500 transition-colors p-0.5 flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<Users className="w-7 h-7" />} text="No team members added." />
            )}
          </div>
        )}

        {/* ── External tab ─────────────────────────── */}
        {tab === 'external' && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <div className="flex-1 relative">
                <AtSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => { setEmailInput(e.target.value); setEmailError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && addExternalEmail()}
                  placeholder="customer@example.com"
                  className={cn(
                    'w-full text-xs pl-6 pr-2 py-1.5 rounded-md border bg-bg-input focus:outline-none transition-colors',
                    emailError ? 'border-red-400 focus:border-red-400' : 'border-border focus:border-accent-400',
                  )}
                />
              </div>
              <Button size="sm" variant="primary" onClick={addExternalEmail} disabled={!emailInput.trim()} className="gap-1 flex-shrink-0">
                <UserPlus className="w-3 h-3" />
              </Button>
            </div>
            {emailError && <p className="text-[10px] text-red-500 px-1">{emailError}</p>}

            {externalRecipients.length > 0 ? (
              <div className="space-y-1.5">
                {externalRecipients.map((r) => {
                  const isNew = justAdded === r.email;
                  return (
                    <div
                      key={r.email}
                      ref={isNew ? justAddedRef : null}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-300 animate-fade-in',
                        isNew
                          ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30 shadow-sm'
                          : 'border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/20',
                      )}
                    >
                      <Avatar value={r.email!} external />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate text-violet-800 dark:text-violet-300">{r.email}</div>
                        <div className="text-[10px] text-violet-500 dark:text-violet-400">External recipient</div>
                      </div>
                      {isNew && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 rounded-full flex-shrink-0">
                          <Check className="w-2.5 h-2.5" /> Added
                        </span>
                      )}
                      <button onClick={() => removeByEmail(r.email!)} className="text-violet-400 hover:text-red-500 transition-colors p-0.5 flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<AtSign className="w-7 h-7" />}
                text={<>Type a customer email above<br />and press Enter or click +</>}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Blocklist ──────────────────────────────────────────────────── */}
      {templateId && (
        <div className="border-t border-border pt-4">
          <BlocklistSection
            blocklist={liveBlocklist}
            templateId={templateId}
          />
        </div>
      )}
    </div>
  );
}
