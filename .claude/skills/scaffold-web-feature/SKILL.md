---
name: scaffold-web-feature
description: Scaffold a new feature route in a Next.js app (web/admin/space) matching Prism's App Router conventions — route-group page, colocated _components, a TanStack Query hooks file, an optional Zustand store, and Zod-validated forms wired to the API client. Use when adding a new screen/feature to apps/web, apps/admin, or apps/space.
---

# Scaffold a Next.js feature route

Add a feature under a route group that matches the existing web style (study `apps/web/src/app/(app)/issues/` and the `hooks/`, `stores/`, `schemas/` folders).

## Layout

```
apps/<app>/src/app/(app)/<feature>/
├── page.tsx                 # server or client entry for the route
└── _components/             # feature-local presentational + container parts
apps/<app>/src/hooks/use<Feature>.ts   # TanStack Query hooks (server state)
apps/<app>/src/stores/<feature>.ts     # Zustand store (UI/local state) — only if needed
```

## 1. Query hooks — `hooks/use<Feature>.ts`

Colocate all server-state access for the feature. Use the shared API client (`packages/services` once it exists; until then the app's `lib/` client) and shared types (`packages/types`).

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api'; // → packages/services after Phase 0
import type { Thing } from '@prism/types';

const KEY = ['things'] as const;

export function useThings(params?: { workspaceId?: string }) {
  return useQuery({
    queryKey: [...KEY, params],
    queryFn: () => api.get<Thing[]>('/things', { params }).then((r) => r.data),
  });
}

export function useCreateThing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Thing>) => api.post('/things', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

## 2. Page — `page.tsx`

- **web/admin:** client component that renders the container from `_components`.
- **space:** prefer a **server component** (SSR) for SEO; fetch on the server, render read-only, no client mutations.

```tsx
import { ThingList } from './_components/thing-list';

export default function ThingsPage() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">Things</h1>
      <ThingList />
    </main>
  );
}
```

## 3. Presentational parts — `_components/`

Compose from `packages/ui` primitives (from `prism-uiux`). Handle **all states**: loading (skeleton), empty, error, and content.

```tsx
'use client';
import { useThings } from '@/hooks/useThings';

export function ThingList() {
  const { data, isLoading, isError } = useThings();
  if (isLoading) return <Skeleton rows={5} />;
  if (isError) return <ErrorState />;
  if (!data?.length) return <EmptyState label="No things yet" />;
  return <ul>{data.map((t) => <li key={t.id}>{t.name}</li>)}</ul>;
}
```

## 4. Forms

Validate with Zod (reuse the schema shared with the API contract via `packages/types`). Keep form UI in `packages/ui`; keep submit wiring (mutation hook) in the feature.

## Rules

- **Never** fetch in presentational components — go through a `hooks/use*` file.
- **Never** hardcode API URLs — the client reads `NEXT_PUBLIC_API_URL`.
- Zustand only for UI/local state, never as a server-state cache.
- **space** app: SSR, read-only, and never render private fields even if present in the payload.
- Build the app after (`pnpm --filter <app> build`) and report the result.
