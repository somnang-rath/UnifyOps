import { z } from 'zod';
import { ALL_BACKUP_SCOPES } from '../schemas/backup-schedule.schema';

// ── Shared ────────────────────────────────────────────────────────────────────

const ScopesSchema = z
  .array(z.enum(ALL_BACKUP_SCOPES))
  .min(1, 'Select at least one scope')
  .default([...ALL_BACKUP_SCOPES]);

// ── Export ────────────────────────────────────────────────────────────────────

export const ExportOptionsSchema = z.object({
  scopes:   ScopesSchema,
  password: z.string().min(4, 'Password must be at least 4 characters').max(128).optional().nullable(),
  fileName: z.string().min(1).max(120).trim().default('Backup UnifyOps'),
});

export type ExportOptionsDto = z.infer<typeof ExportOptionsSchema>;

// ── Import ────────────────────────────────────────────────────────────────────

export const ImportOptionsSchema = z.object({
  /** Restore strategy: merge keeps existing data and skips duplicates; replace deletes first */
  strategy: z.enum(['merge', 'replace']).default('merge'),
  /** Which scopes from the backup file to restore (default = all scopes present in the file) */
  scopes:   z.array(z.enum(ALL_BACKUP_SCOPES)).optional(),
  password: z.string().max(128).optional().nullable(),
});

export type ImportOptionsDto = z.infer<typeof ImportOptionsSchema>;

// ── Schedule ──────────────────────────────────────────────────────────────────

export const UpsertScheduleSchema = z.object({
  enabled:      z.boolean().default(false),
  frequency:    z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  /** HH:MM 24-hour, e.g. "02:00" */
  time:         z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format').default('02:00'),
  dayOfWeek:    z.number().int().min(0).max(6).default(0),
  dayOfMonth:   z.number().int().min(1).max(31).default(1),
  timezone:     z.string().min(1).max(60).default('UTC'),
  scopes:       ScopesSchema,
  passwordMode: z.enum(['none', 'custom']).default('none'),
  fileName:     z.string().min(1).max(120).trim().default('Backup UnifyOps'),
});

export type UpsertScheduleDto = z.infer<typeof UpsertScheduleSchema>;

// ── Backup file manifest embedded inside each .prismback JSON ─────────────────

export interface BackupMeta {
  version:    '1';
  app:        'Prism';
  exportedAt: string;       // ISO timestamp
  exportedBy: string;       // user email
  fileName:   string;
  encrypted:  boolean;
  scopes:     string[];
  /** Present only when encrypted=true */
  iv?:        string;       // hex
  salt?:      string;       // hex
}

export interface BackupPayload {
  meta: BackupMeta;
  /** Raw data object when not encrypted; base64 ciphertext string when encrypted */
  data: Record<string, unknown[]> | string;
}

// ── Import result returned to client ─────────────────────────────────────────

export interface ImportResult {
  inserted: Partial<Record<string, number>>;
  skipped:  Partial<Record<string, number>>;
}
