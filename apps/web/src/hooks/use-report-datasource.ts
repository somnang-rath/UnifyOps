'use client';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type DatasourceColumn = { key: string; type: string };

export type DetectedArray = {
  path: string;
  count: number;
  columns: DatasourceColumn[];
};

export type FetchDatasourceResult = {
  data: unknown;
  detected: DetectedArray[];
};

export type FetchDatasourceInput = {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
};

export function useFetchDatasource() {
  return useMutation<FetchDatasourceResult, Error, FetchDatasourceInput>({
    mutationFn: (payload) =>
      api.post<FetchDatasourceResult>('/reports/fetch-datasource', payload).then((r) => r.data),
  });
}

/** Walk a nested object using a dot-separated path and return the array found there.
 *  When a mid-path segment resolves to an array, flat-maps the remaining path
 *  across every item and merges parent (non-array) fields into each child row —
 *  enabling paths like "charger_locations.chargers" where each charger row
 *  also carries location_id, location_name, city, etc. */
export function extractArrayAtPath(
  data: unknown,
  path: string,
): Record<string, unknown>[] {
  if (!path) {
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }
  const parts = path.split('.');
  let current: unknown = data;
  for (let i = 0; i < parts.length; i++) {
    if (Array.isArray(current)) {
      const unnestKey = parts[i];
      const remainingPath = parts.slice(i).join('.');
      return (current as Record<string, unknown>[]).flatMap((item) => {
        const childRows = extractArrayAtPath(item, remainingPath);
        const parentFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (k !== unnestKey && !Array.isArray(v)) parentFields[k] = v;
        }
        return childRows.map((child) => ({ ...parentFields, ...child }));
      });
    }
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[parts[i]];
    } else {
      return [];
    }
  }
  return Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
}
