'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardOverview } from '@/schemas/dashboard';

export const useDashboard = () =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api.get<DashboardOverview>('/dashboard').then((r) => r.data),
  });
