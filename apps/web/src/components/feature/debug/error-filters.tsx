'use client';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ErrorLogQuery, ErrorLogType, ErrorSource } from '@/schemas/error-log';

interface ErrorFiltersProps {
  filters: ErrorLogQuery;
  onChange: (filters: ErrorLogQuery) => void;
}

type SelectOption = { value: string; label: string };

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value?: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-sm border border-border bg-bg-card px-2 text-[12px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ErrorFilters({ filters, onChange }: ErrorFiltersProps) {
  const set = (patch: Partial<ErrorLogQuery>) =>
    onChange({ ...filters, ...patch, page: 1 });

  const hasFilters =
    filters.source ||
    filters.logType ||
    filters.resolved ||
    filters.search ||
    filters.from ||
    filters.to;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search errors…"
          value={filters.search ?? ''}
          onChange={(e) => set({ search: e.target.value || undefined })}
          className="w-full h-8 pl-7 pr-3 rounded-sm border border-border bg-bg-card text-[12px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <FilterSelect
        value={filters.source}
        onChange={(v) => set({ source: (v as ErrorSource) || undefined })}
        options={[
          { value: 'frontend', label: 'Frontend' },
          { value: 'backend', label: 'Backend' },
        ]}
        placeholder="All sources"
      />

      <FilterSelect
        value={filters.logType}
        onChange={(v) => set({ logType: (v as ErrorLogType) || undefined })}
        options={[
          { value: 'error', label: 'Error' },
          { value: 'warning', label: 'Warning' },
          { value: 'debug', label: 'Debug' },
          { value: 'info', label: 'Info' },
        ]}
        placeholder="All types"
      />

      <FilterSelect
        value={filters.resolved}
        onChange={(v) => set({ resolved: (v as 'true' | 'false') || undefined })}
        options={[
          { value: 'false', label: 'Unresolved' },
          { value: 'true', label: 'Resolved' },
        ]}
        placeholder="All statuses"
      />

      <input
        type="date"
        value={filters.from ?? ''}
        onChange={(e) => set({ from: e.target.value || undefined })}
        title="From date"
        className="h-8 rounded-sm border border-border bg-bg-card px-2 text-[12px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <input
        type="date"
        value={filters.to ?? ''}
        onChange={(e) => set({ to: e.target.value || undefined })}
        title="To date"
        className="h-8 rounded-sm border border-border bg-bg-card px-2 text-[12px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {hasFilters && (
        <button
          type="button"
          onClick={() => onChange({ page: 1, limit: filters.limit })}
          className="flex items-center gap-1 h-8 px-2 rounded-sm border border-border text-[12px] text-text-muted hover:bg-bg-hover hover:text-text transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
