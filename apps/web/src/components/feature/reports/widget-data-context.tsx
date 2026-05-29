'use client';
import { createContext, useContext } from 'react';
import type { DataWidgetType } from '@/schemas/report';

export interface LiveWidgetEntry {
  type: DataWidgetType;
  value?: number | string;
  label?: string;
  trend?: number;
  trendLabel?: string;
  series?: { name: string; value: number; color?: string }[];
  rows?: Record<string, string | number>[];
  columns?: string[];
}

export type LiveWidgetData = Partial<Record<DataWidgetType, LiveWidgetEntry>>;

export const WidgetDataContext = createContext<LiveWidgetData | null>(null);

export function useLiveWidgetData(): LiveWidgetData | null {
  return useContext(WidgetDataContext);
}
