'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Skeleton, ErrorState } from '@prism/ui';
import {
  useConfig,
  useUpdateConfig,
  type ConfigEntry,
} from '@/hooks/useInstance';
import { Card, inputCls } from './ui';

type FieldType = 'text' | 'password' | 'toggle' | 'textarea' | 'select';

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  category: ConfigEntry['category'];
  /** For `select`: the allowed options. */
  options?: { value: string; label: string }[];
  /** Value used when the key is unset (for `select`, keeps UI in sync with the
   *  server-side default). Defaults to the first option. */
  default?: string;
  /** For `textarea`: number of visible rows (default 4). */
  rows?: number;
}

/**
 * Renders a form for a set of instance-config keys, loads current values,
 * and saves changed entries. Secret (password) fields are write-only:
 * blank means "keep existing", so we never round-trip a masked value.
 */
export function ConfigForm({ fields }: { fields: ConfigField[] }) {
  const { data: rows, isLoading, isError, refetch } = useConfig();
  const update = useUpdateConfig();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const current = useMemo(() => {
    const map: Record<string, { value: string | null; isSet: boolean }> = {};
    for (const r of rows ?? []) map[r.key] = { value: r.value, isSet: r.isSet };
    return map;
  }, [rows]);

  useEffect(() => {
    if (!rows) return;
    const init: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === 'password') {
        init[f.key] = '';
      } else {
        const fallback =
          f.type === 'toggle'
            ? 'false'
            : f.type === 'select'
              ? (f.default ?? f.options?.[0]?.value ?? '')
              : '';
        init[f.key] = current[f.key]?.value ?? fallback;
      }
    }
    setValues(init);
  }, [rows, fields, current]);

  if (isLoading) return <Card><Skeleton rows={fields.length} /></Card>;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  function set(key: string, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setSaved(false);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const entries: ConfigEntry[] = [];
    for (const f of fields) {
      const v = values[f.key] ?? '';
      // Skip untouched secrets (blank = keep existing).
      if (f.type === 'password' && v === '') continue;
      entries.push({
        key: f.key,
        value: v === '' ? null : v,
        category: f.category,
        isEncrypted: f.type === 'password',
      });
    }
    if (entries.length === 0) return;
    await update.mutateAsync(entries);
    setSaved(true);
  }

  return (
    <Card>
      <form onSubmit={onSave} className="space-y-5">
        {fields.map((f) => (
          <div key={f.key}>
            {f.type === 'toggle' ? (
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={values[f.key] === 'true'}
                  onChange={(e) => set(f.key, e.target.checked ? 'true' : 'false')}
                  className="h-4 w-4 rounded border-line accent-brand"
                />
                <span className="text-sm font-medium text-fg">{f.label}</span>
              </label>
            ) : f.type === 'select' ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-fg-muted">{f.label}</span>
                <select
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={inputCls}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : f.type === 'textarea' ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-fg-muted">{f.label}</span>
                <textarea
                  value={values[f.key] ?? ''}
                  rows={f.rows ?? 4}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={inputCls}
                />
              </label>
            ) : (
              <label className="block space-y-1">
                <span className="text-sm font-medium text-fg-muted">{f.label}</span>
                <input
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={values[f.key] ?? ''}
                  placeholder={
                    f.type === 'password' && current[f.key]?.isSet
                      ? '•••••••• (set — leave blank to keep)'
                      : undefined
                  }
                  onChange={(e) => set(f.key, e.target.value)}
                  className={inputCls}
                />
              </label>
            )}
            {f.help && <p className="mt-1 text-xs text-fg-subtle">{f.help}</p>}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {saved && (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Saved
            </span>
          )}
          {update.isError && (
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              Save failed
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
