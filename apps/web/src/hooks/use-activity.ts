'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ActivityActor {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
}

export interface ActivityItem {
  _id: string;
  actorId: ActivityActor;
  projectId?: string;
  entityType: string;
  entityId: string;
  action: string;
  title: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

interface Params {
  projectId?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export const useActivity = (params: Params = {}) =>
  useQuery({
    queryKey: ['activity', params],
    queryFn: () =>
      api
        .get<ActivityItem[]>('/activity', { params })
        .then((r) => r.data),
    enabled: Object.values(params).some(Boolean),
    placeholderData: (prev) => prev,
  });
